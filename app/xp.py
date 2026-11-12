from datetime import date, datetime, timedelta

from .db import get_db, one, rows

TASK_POINTS = {
    "read": 10,
    "notes": 10,
    "practice": 15,
    "pastpaper": 20,
    "revise": 15,
    "mocktest": 30,
    "lab": 20,
    "assignment": 20,
}

BADGES = (
    "first_task",
    "streak_7",
    "streak_30",
    "streak_100",
    "first_subject_100",
    "first_exam",
    "exams_10",
    "tasks_100",
    "tasks_500",
    "level_10",
    "perfect_week",
    "night_owl",
)


def _activity_dates():
    return [
        date.fromisoformat(row["day"])
        for row in rows(
            "SELECT DISTINCT date(completed_at) AS day FROM task "
            "WHERE status='done' AND completed_at IS NOT NULL ORDER BY day DESC"
        )
    ]


def _streak_counts(days):
    if not days:
        return 0, 0

    today = date.today()
    current = 0
    expected = today if days[0] == today else today - timedelta(days=1)
    if days[0] != expected:
        return 0, _best_streak(days)

    for day in days:
        if day != expected:
            break
        current += 1
        expected -= timedelta(days=1)
    return current, _best_streak(days)


def _best_streak(days):
    best = current = 0
    previous = None
    for day in sorted(days):
        current = current + 1 if previous and day == previous + timedelta(days=1) else 1
        best = max(best, current)
        previous = day
    return best


def _level_for_xp(total):
    level = 1
    while 50 * level * (level - 1) <= total:
        level += 1
    level -= 1
    start = 50 * (level - 1) * level
    return level, total - start, 100 * level


def _title(level):
    tiers = (
        (4, "Novice"),
        (7, "Apprentice"),
        (10, "Scholar"),
        (15, "Adept"),
        (20, "Expert"),
        (30, "Master"),
        (float("inf"), "Sage"),
    )
    return next(title for threshold, title in tiers if level < threshold)


def _unlock_badges():
    db = get_db()
    task_count = one(
        "SELECT COUNT(*) AS count FROM xp_event "
        "WHERE reason='Task completed' AND amount>0"
    )["count"]
    exam_count = one("SELECT COUNT(*) AS count FROM exam")["count"]
    current_streak, best_streak = _streak_counts(_activity_dates())
    level = profile(include_badges=False)["level"]
    checks = {
        "first_task": task_count >= 1,
        "streak_7": best_streak >= 7,
        "streak_30": best_streak >= 30,
        "streak_100": best_streak >= 100,
        "first_exam": exam_count >= 1,
        "exams_10": exam_count >= 10,
        "tasks_100": task_count >= 100,
        "tasks_500": task_count >= 500,
        "level_10": level >= 10,
        "night_owl": bool(
            one(
                "SELECT id FROM xp_event WHERE reason='Task completed' "
                "AND amount>0 AND strftime('%H',created_at) >= '22' LIMIT 1"
            )
        ),
        "perfect_week": all(
            (date.today() - timedelta(days=offset)) in _activity_dates()
            for offset in range(7)
        ),
    }
    checks["first_subject_100"] = bool(
        one(
            "SELECT s.id FROM subject s JOIN task t ON t.subject_id=s.id "
            "GROUP BY s.id HAVING SUM(CASE WHEN t.status!='done' THEN 1 ELSE 0 END)=0 "
            "LIMIT 1"
        )
    )
    for badge in BADGES:
        if checks.get(badge):
            db.execute("INSERT OR IGNORE INTO badge(key) VALUES(?)", (badge,))
    db.commit()


def award_task(task):
    db = get_db()
    existing = one(
        "SELECT amount FROM xp_event WHERE ref_id=? AND reason='Task completed' "
        "AND amount>0 LIMIT 1",
        (task["id"],),
    )
    if existing:
        return 0

    streak, _ = _streak_counts(_activity_dates())
    base = TASK_POINTS.get(task["type"], 10)
    amount = base + round(base * min(streak, 10) * 0.05)
    db.execute(
        "INSERT INTO xp_event(amount,reason,ref_id,created_at) VALUES(?,?,?,?)",
        (
            amount,
            "Task completed",
            task["id"],
            datetime.now().replace(microsecond=0).isoformat(),
        ),
    )

    today = date.today().isoformat()
    if not one(
        "SELECT id FROM xp_event WHERE reason='Streak day' AND amount>0 "
        "AND date(created_at)=?",
        (today,),
    ):
        db.execute(
            "INSERT INTO xp_event(amount,reason,ref_id,created_at) VALUES(?,?,?,?)",
            (
                5,
                "Streak day",
                today,
                datetime.now().replace(microsecond=0).isoformat(),
            ),
        )
    db.commit()
    _unlock_badges()
    return amount


def reverse_task_award(task_id):
    award = one(
        "SELECT amount FROM xp_event WHERE ref_id=? AND reason='Task completed' "
        "AND amount>0 LIMIT 1",
        (task_id,),
    )
    if award and not one(
        "SELECT id FROM xp_event WHERE ref_id=? AND reason='Task unchecked' LIMIT 1",
        (task_id,),
    ):
        get_db().execute(
            "INSERT INTO xp_event(amount,reason,ref_id,created_at) VALUES(?,?,?,?)",
            (
                -award["amount"],
                "Task unchecked",
                task_id,
                datetime.now().replace(microsecond=0).isoformat(),
            ),
        )
        get_db().commit()
    task_event = one(
        "SELECT date(created_at) AS day FROM xp_event "
        "WHERE ref_id=? AND reason='Task completed' AND amount>0 LIMIT 1",
        (task_id,),
    )
    if task_event and not one(
        "SELECT id FROM task WHERE status='done' AND date(completed_at)=? LIMIT 1",
        (task_event["day"],),
    ):
        streak_award = one(
            "SELECT amount FROM xp_event WHERE reason='Streak day' AND ref_id=? "
            "AND amount>0 LIMIT 1",
            (task_event["day"],),
        )
        reversed_streak = one(
            "SELECT id FROM xp_event WHERE reason='Streak day reversed' AND ref_id=? "
            "LIMIT 1",
            (task_event["day"],),
        )
        if streak_award and not reversed_streak:
            get_db().execute(
                "INSERT INTO xp_event(amount,reason,ref_id,created_at) VALUES(?,?,?,?)",
                (
                    -streak_award["amount"],
                    "Streak day reversed",
                    task_event["day"],
                    datetime.now().replace(microsecond=0).isoformat(),
                ),
            )
            get_db().commit()


def award_pomodoro(task_session_id, minutes):
    amount = max(1, int(minutes) // 5)
    get_db().execute(
        "INSERT INTO xp_event(amount,reason,ref_id,created_at) VALUES(?,?,?,?)",
        (
            amount,
            "Pomodoro completed",
            task_session_id,
            datetime.now().replace(microsecond=0).isoformat(),
        ),
    )
    get_db().commit()
    _unlock_badges()
    return amount


def profile(include_badges=True):
    total = int(one("SELECT COALESCE(SUM(amount),0) AS total FROM xp_event")["total"])
    level, into, next_level = _level_for_xp(max(0, total))
    current_streak, best_streak = _streak_counts(_activity_dates())
    task_count = one("SELECT COUNT(*) AS count FROM task WHERE status='done'")["count"]
    minutes = one(
        "SELECT COALESCE(SUM(minutes),0) AS minutes FROM task_session"
    )["minutes"]
    result = {
        "level": level,
        "xp_total": total,
        "xp_into_level": into,
        "xp_for_next": next_level,
        "title": _title(level),
        "streak": current_streak,
        "streak_best": best_streak,
        "tasks_completed": task_count,
        "minutes_studied": minutes,
    }
    if include_badges:
        result["badges"] = rows("SELECT key,earned_at FROM badge ORDER BY earned_at")
    return result
