from collections import defaultdict
from datetime import date, timedelta
import json

from .dag_engine import topological_order


def _as_date(value, fallback):
    if not value:
        return fallback
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return fallback


def _study_dates(start, end, settings, blackouts):
    study_days = settings.get("study_days", list(range(7)))
    if isinstance(study_days, str):
        import json

        study_days = json.loads(study_days)
    blocked = {
        _as_date(value, start)
        for value in blackouts
    }
    current = start
    while current <= end:
        if current.weekday() in study_days and current not in blocked:
            yield current
        current += timedelta(days=1)


def plan_tasks(start_date, exams, tasks, settings, blackouts=()):
    """Assign pending tasks backward from their next exam or explicit due date."""
    start = _as_date(start_date, date.today())
    exam_by_subject = defaultdict(list)
    for exam in exams:
        exam_date = _as_date(exam.get("exam_date"), start)
        if exam_date >= start:
            exam_by_subject[exam["subject_id"]].append(exam)
    for subject_exams in exam_by_subject.values():
        subject_exams.sort(key=lambda exam: _as_date(exam.get("exam_date"), start))

    pending = []
    for task in tasks:
        if task.get("status", "pending") not in {"pending", "missed"}:
            continue
        task = dict(task)
        upcoming = exam_by_subject.get(task.get("subject_id"), [])
        if task.get("unit_id"):
            topic_exams = []
            for candidate in upcoming:
                scope = candidate.get("scope_unit_ids") or "[]"
                if isinstance(scope, str):
                    try:
                        scope = json.loads(scope)
                    except json.JSONDecodeError:
                        scope = []
                if not scope or task["unit_id"] in scope:
                    topic_exams.append(candidate)
            upcoming = topic_exams
        exam = upcoming[0] if upcoming else None
        if exam:
            task["exam_weight"] = (
                float(task.get("exam_weight") or 1)
                * float(exam.get("weightage") or 100)
                / 100
            )
        exam_deadline = (
            _as_date(exam.get("exam_date"), start) - timedelta(days=1)
            if exam
            else start + timedelta(days=27)
        )
        due = _as_date(task.get("due_date"), exam_deadline)
        task["_deadline"] = min(due, exam_deadline)
        task["priority_score"] = float(task.get("priority_score") or 0)
        task["prereqs"] = task.get("prereq_task_ids", [])
        pending.append(task)

    if not pending:
        return {
            "days": [],
            "unscheduled": [],
            "crunch": False,
            "explanation": "",
            "buffered_capacity_minutes": 0,
        }

    order, warnings = topological_order(pending)
    by_id = {task["id"]: task for task in pending}
    pending = [by_id[task_id] for task_id in order]
    reverse_order = list(reversed(pending))
    latest = max(task["_deadline"] for task in pending)

    daily_capacity = max(0, int(settings.get("daily_capacity_minutes", 120)))
    buffer_pct = min(50, max(0, int(settings.get("buffer_pct", 15))))
    capacity = daily_capacity * (100 - buffer_pct) // 100
    available_days = list(_study_dates(start, latest, settings, blackouts))
    day_load = defaultdict(int)
    assigned = {}
    subject_load = defaultdict(int)
    subject_weight = defaultdict(float)
    for task in pending:
        subject_weight[task.get("subject_id")] = max(
            subject_weight[task.get("subject_id")],
            float(task.get("exam_weight") or 1),
        )

    for day in reversed(available_days):
        remaining_capacity = capacity
        while remaining_capacity > 0:
            candidates = [
                task
                for task in reverse_order
                if task["id"] not in assigned
                and task["_deadline"] >= day
                and int(task.get("est_minutes") or 0) <= remaining_capacity
                and all(dependent in assigned for dependent in _dependents(task["id"], pending))
            ]
            if not candidates:
                break

            def subject_score(task):
                sid = task.get("subject_id")
                weight = subject_weight[sid]
                return (
                    -weight / (1 + subject_load[sid]),
                    -task["priority_score"],
                    str(task["id"]),
                )

            task = min(candidates, key=subject_score)
            minutes = max(1, int(task.get("est_minutes") or 0))
            assigned[task["id"]] = day
            subject_load[task.get("subject_id")] += minutes
            day_load[day] += minutes
            remaining_capacity -= minutes

    by_day = defaultdict(list)
    for task in pending:
        if task["id"] in assigned:
            task["scheduled_date"] = assigned[task["id"]].isoformat()
            by_day[assigned[task["id"]]].append(task)

    day_rows = [
        {
            "date": day.isoformat(),
            "capacity_minutes": capacity,
            "minutes_planned": day_load[day],
            "tasks": sorted(
                by_day[day],
                key=lambda task: (-task["priority_score"], str(task["id"])),
            ),
        }
        for day in sorted(by_day)
    ]
    unscheduled = [
        {
            "id": task["id"],
            "title": task["title"],
            "subject_id": task.get("subject_id"),
            "est_minutes": task.get("est_minutes", 0),
            "deadline": task["_deadline"].isoformat(),
        }
        for task in pending
        if task["id"] not in assigned
    ]

    available_minutes = len(available_days) * capacity
    required_minutes = sum(int(task.get("est_minutes") or 0) for task in pending)
    crunch = bool(unscheduled or required_minutes > available_minutes)
    explanation = ""
    if crunch:
        explanation = (
            f"There is more work than the available study time before your exams. "
            f"Maya scheduled {len(assigned)} of {len(pending)} tasks and kept "
            f"{len(unscheduled)} unscheduled so nothing is silently dropped."
        )
    if warnings:
        explanation = " ".join([explanation, *warnings]).strip()

    return {
        "days": day_rows,
        "unscheduled": unscheduled,
        "crunch": crunch,
        "explanation": explanation,
        "buffered_capacity_minutes": capacity,
    }


def _dependents(task_id, tasks):
    return [
        task["id"]
        for task in tasks
        if task_id in task.get("prereq_task_ids", [])
    ]


def plan_week(start_date, subjects, exams, tasks, settings, blackouts):
    start = _as_date(start_date, date.today())
    plan = plan_tasks(start, exams, tasks, settings, blackouts)
    by_date = {day["date"]: day for day in plan["days"]}
    result = []
    for offset in range(7):
        day = (start + timedelta(days=offset)).isoformat()
        entry = by_date.get(
            day,
            {
                "date": day,
                "capacity_minutes": plan["buffered_capacity_minutes"],
                "minutes_planned": 0,
                "tasks": [],
            },
        )
        result.append(entry)
    return {
        "days": result,
        "crunch": plan["crunch"],
        "explanation": plan["explanation"],
        "unscheduled": plan["unscheduled"],
    }


def plan_day(day, subjects, exams, tasks, settings, blackouts):
    week = plan_week(day, subjects, exams, tasks, settings, blackouts)
    first = week["days"][0]
    return {
        "date": first["date"],
        "capacity_minutes": int(settings.get("daily_capacity_minutes", 120)),
        "planned_minutes": first["minutes_planned"],
        "groups": [],
        "tasks": first["tasks"],
        "crunch": week["crunch"],
        "explanation": week["explanation"],
    }


def replan(today, tasks, settings, exams=(), blackouts=()):
    plan = plan_tasks(today, exams, tasks, settings, blackouts)
    moved_dates = {
        task["id"]: task["scheduled_date"]
        for day in plan["days"]
        for task in day["tasks"]
    }
    moved = sum(
        1
        for task in tasks
        if task.get("status") == "pending"
        and task.get("scheduled_date")
        and task["scheduled_date"] < str(today)
        and task["id"] in moved_dates
    )
    return {
        "moved": moved,
        "schedule": moved_dates,
        "crunch": plan["crunch"],
        "explanation": plan["explanation"],
        "unscheduled": plan["unscheduled"],
    }
