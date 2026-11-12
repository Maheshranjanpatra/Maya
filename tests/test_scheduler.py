from datetime import date, timedelta

from app.scheduler import plan_tasks


def _day(value):
    return date.fromisoformat(value)


def test_backward_plan_respects_exam_capacity_blackouts_and_dependencies():
    today = date.today()
    exam_day = today + timedelta(days=8)
    blackout = (today + timedelta(days=2)).isoformat()
    tasks = [
        {
            "id": 1,
            "subject_id": 1,
            "title": "Prerequisite",
            "est_minutes": 60,
            "status": "pending",
            "prereq_task_ids": [],
        },
        {
            "id": 2,
            "subject_id": 1,
            "title": "Dependent",
            "est_minutes": 60,
            "status": "pending",
            "prereq_task_ids": [1],
        },
    ]

    plan = plan_tasks(
        today.isoformat(),
        [{"subject_id": 1, "exam_date": exam_day.isoformat(), "weightage": 100}],
        tasks,
        {"daily_capacity_minutes": 120, "buffer_pct": 15, "study_days": list(range(7))},
        [blackout],
    )
    scheduled = {
        task["id"]: _day(task["scheduled_date"])
        for day in plan["days"]
        for task in day["tasks"]
    }

    assert set(scheduled) == {1, 2}
    assert scheduled[1] < scheduled[2]
    assert all(day["date"] != blackout for day in plan["days"])
    assert all(day["minutes_planned"] <= 102 for day in plan["days"])
    assert all(_day(task["scheduled_date"]) < exam_day for day in plan["days"] for task in day["tasks"])


def test_crunch_mode_explains_work_that_cannot_fit():
    today = date.today()
    tasks = [
        {
            "id": 1,
            "subject_id": 1,
            "title": "Large assignment",
            "est_minutes": 240,
            "status": "pending",
            "prereq_task_ids": [],
        }
    ]

    plan = plan_tasks(
        today.isoformat(),
        [{"subject_id": 1, "exam_date": (today + timedelta(days=1)).isoformat()}],
        tasks,
        {"daily_capacity_minutes": 120, "buffer_pct": 15, "study_days": list(range(7))},
    )

    assert plan["crunch"]
    assert len(plan["unscheduled"]) == 1
    assert "kept 1 unscheduled" in plan["explanation"]
