from calendar import monthrange
from datetime import date, timedelta

from .db import one, rows
from .xp import profile


def overview():
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    last_week_start = week_start - timedelta(days=7)
    subjects = rows(
        "SELECT s.id,s.name,s.color,s.exam_weight,"
        "COUNT(t.id) AS task_count,"
        "SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) AS completed_tasks,"
        "COALESCE(SUM(tp.marks),0) AS total_marks,"
        "COALESCE(SUM(CASE WHEN t.status='done' THEN tp.marks ELSE 0 END),0) "
        "AS completed_marks "
        "FROM subject s LEFT JOIN task t ON t.subject_id=s.id "
        "LEFT JOIN topic tp ON tp.id=t.topic_id "
        "WHERE s.archived=0 GROUP BY s.id ORDER BY s.name"
    )
    for subject in subjects:
        subject["coverage"] = (
            round(100 * subject["completed_tasks"] / subject["task_count"])
            if subject["task_count"]
            else 0
        )
        subject["mastery"] = (
            round(100 * subject["completed_marks"] / subject["total_marks"])
            if subject["total_marks"]
            else subject["coverage"]
        )
        actual = one(
            "SELECT COALESCE(SUM(ts.minutes),0) AS minutes FROM task_session ts "
            "JOIN task t ON t.id=ts.task_id WHERE t.subject_id=?",
            (subject["id"],),
        )
        subject["actual_minutes"] = actual["minutes"]
        subject["estimated_minutes"] = one(
            "SELECT COALESCE(SUM(est_minutes),0) AS minutes FROM task "
            "WHERE subject_id=?",
            (subject["id"],),
        )["minutes"]

    weekly_minutes = one(
        "SELECT COALESCE(SUM(minutes),0) AS minutes FROM task_session "
        "WHERE date(started_at)>=?",
        (week_start.isoformat(),),
    )["minutes"]
    previous_minutes = one(
        "SELECT COALESCE(SUM(minutes),0) AS minutes FROM task_session "
        "WHERE date(started_at)>=? AND date(started_at)<?",
        (last_week_start.isoformat(), week_start.isoformat()),
    )["minutes"]
    recent_hours = rows(
        "SELECT strftime('%H',started_at) AS hour,COUNT(*) AS sessions "
        "FROM task_session WHERE date(started_at)>=date('now','-30 days') "
        "GROUP BY hour ORDER BY sessions DESC LIMIT 1"
    )
    weak_topics = rows(
        "SELECT t.id,t.name,t.difficulty,s.name AS subject_name,"
        "COALESCE(AVG(CASE WHEN task.status='done' THEN 1.0 ELSE 0.0 END),0) "
        "AS completion FROM topic t JOIN unit u ON u.id=t.unit_id "
        "JOIN subject s ON s.id=u.subject_id LEFT JOIN task ON task.topic_id=t.id "
        "WHERE s.archived=0 GROUP BY t.id ORDER BY t.difficulty DESC,completion "
        "LIMIT 8"
    )
    return {
        **profile(),
        "subjects": subjects,
        "total_minutes_this_week": weekly_minutes,
        "total_minutes_last_week": previous_minutes,
        "weak_topics": weak_topics,
        "time_of_day_peak": recent_hours[0]["hour"] if recent_hours else None,
    }


def heatmap(days=84):
    today = date.today()
    start = today - timedelta(days=days - 1)
    activity = rows(
        "SELECT date(created_at) AS day,COALESCE(SUM(amount),0) AS xp "
        "FROM xp_event WHERE date(created_at)>=? GROUP BY date(created_at)",
        (start.isoformat(),),
    )
    sessions = rows(
        "SELECT date(started_at) AS day,COALESCE(SUM(minutes),0) AS minutes "
        "FROM task_session WHERE date(started_at)>=? GROUP BY date(started_at)",
        (start.isoformat(),),
    )
    tasks = rows(
        "SELECT date(completed_at) AS day,COUNT(*) AS count FROM task "
        "WHERE status='done' AND completed_at IS NOT NULL AND date(completed_at)>=? "
        "GROUP BY date(completed_at)",
        (start.isoformat(),),
    )
    xp_by_day = {item["day"]: item["xp"] for item in activity}
    minutes_by_day = {item["day"]: item["minutes"] for item in sessions}
    tasks_by_day = {item["day"]: item["count"] for item in tasks}
    return [
        {
            "date": (start + timedelta(days=index)).isoformat(),
            "xp": xp_by_day.get((start + timedelta(days=index)).isoformat(), 0),
            "minutes": minutes_by_day.get(
                (start + timedelta(days=index)).isoformat(), 0
            ),
            "tasks": tasks_by_day.get((start + timedelta(days=index)).isoformat(), 0),
        }
        for index in range(days)
    ]


def calendar_month(month=None):
    if month:
        try:
            year, month_number = (int(value) for value in month.split("-", 1))
            first = date(year, month_number, 1)
        except (ValueError, TypeError):
            raise ValueError("Month must use YYYY-MM format.")
    else:
        today = date.today()
        first = date(today.year, today.month, 1)
    count = monthrange(first.year, first.month)[1]
    start = first.isoformat()
    end = (first + timedelta(days=count)).isoformat()
    data = rows(
        "SELECT day,COUNT(DISTINCT task_id) AS task_count,"
        "COUNT(DISTINCT exam_id) AS exam_count,COALESCE(SUM(xp),0) AS xp "
        "FROM ("
        "SELECT scheduled_date AS day,id AS task_id,NULL AS exam_id,0 AS xp "
        "FROM task WHERE scheduled_date>=? AND scheduled_date<? AND status!='skipped' "
        "UNION ALL SELECT exam_date,NULL,id,0 FROM exam "
        "WHERE exam_date>=? AND exam_date<? "
        "UNION ALL SELECT date(created_at),NULL,NULL,amount FROM xp_event "
        "WHERE date(created_at)>=? AND date(created_at)<?"
        ") GROUP BY day",
        (start, end, start, end, start, end),
    )
    by_day = {item["day"]: item for item in data}
    return [
        {
            "date": (first + timedelta(days=index)).isoformat(),
            "task_count": by_day.get(
                (first + timedelta(days=index)).isoformat(), {}
            ).get("task_count", 0),
            "exam_count": by_day.get(
                (first + timedelta(days=index)).isoformat(), {}
            ).get("exam_count", 0),
            "xp": by_day.get((first + timedelta(days=index)).isoformat(), {}).get(
                "xp", 0
            ),
        }
        for index in range(count)
    ]


def exam_risks():
    today = date.today()
    settings = one(
        "SELECT daily_capacity_minutes,buffer_pct FROM settings WHERE id=1"
    ) or {"daily_capacity_minutes": 120, "buffer_pct": 15}
    daily = int(settings["daily_capacity_minutes"]) * (
        100 - int(settings["buffer_pct"])
    ) // 100
    result = rows(
        "SELECT e.*,s.name AS subject_name FROM exam e "
        "JOIN subject s ON s.id=e.subject_id WHERE s.archived=0 "
        "ORDER BY e.exam_date"
    )
    for exam in result:
        days = (date.fromisoformat(exam["exam_date"]) - today).days
        remaining = one(
            "SELECT COALESCE(SUM(est_minutes),0) AS minutes FROM task "
            "WHERE subject_id=? AND status='pending'",
            (exam["subject_id"],),
        )["minutes"]
        capacity = max(0, days) * daily
        exam["days_remaining"] = days
        exam["remaining_minutes"] = remaining
        exam["risk"] = (
            "crunch"
            if remaining > capacity
            else "tight"
            if remaining > capacity * 0.8
            else "comfortable"
        )
    return result
