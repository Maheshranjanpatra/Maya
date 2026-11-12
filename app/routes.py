import json
import logging
from datetime import date, datetime, timedelta

from flask import Blueprint, Response, jsonify, request

from .db import get_db, one, rows
from .scheduler import plan_day, plan_tasks, plan_week, replan as adaptive_replan
from .services.ai.factory import available_providers, get_provider
from .xp import award_pomodoro, award_task, profile, reverse_task_award

bp = Blueprint("api", __name__, url_prefix="/api")
logger = logging.getLogger(__name__)

TASK_TYPES = {
    "read",
    "notes",
    "practice",
    "pastpaper",
    "revise",
    "mocktest",
    "lab",
    "assignment",
}
EXAM_TYPES = {"midterm", "final", "quiz", "practical"}


def ok(data=None):
    return jsonify(ok=True, data=data)


def bad(message, status=400):
    return jsonify(ok=False, error=message), status


def _settings():
    settings = one("SELECT * FROM settings WHERE id=1") or {}
    settings["study_days"] = json.loads(settings.get("study_days") or "[0,1,2,3,4,5,6]")
    return settings


def _blackouts():
    return [item["date"] for item in rows("SELECT date FROM blackout")]


def _task_rows(query, params=()):
    tasks = rows(query, params)
    if not tasks:
        return tasks
    task_ids = [task["id"] for task in tasks]
    placeholders = ",".join("?" for _ in task_ids)
    dependencies = rows(
        "SELECT task_id,prereq_task_id FROM task_dependency "
        f"WHERE task_id IN ({placeholders})",
        task_ids,
    )
    by_task = {}
    for dependency in dependencies:
        by_task.setdefault(dependency["task_id"], []).append(
            dependency["prereq_task_id"]
        )
    for task in tasks:
        task["prereq_task_ids"] = by_task.get(task["id"], [])
        task["is_due_revision"] = bool(
            task.get("is_revision")
            and task.get("scheduled_date")
            and task["scheduled_date"] <= date.today().isoformat()
        )
    return tasks


def _plan_data():
    return (
        rows("SELECT * FROM subject WHERE archived=0"),
        rows("SELECT * FROM exam ORDER BY exam_date"),
        _task_rows(
            "SELECT t.*,s.exam_weight,s.name subject_name,s.color subject_color,"
            "u.id AS unit_id "
            "FROM task t JOIN subject s ON s.id=t.subject_id "
            "LEFT JOIN topic tp ON tp.id=t.topic_id "
            "LEFT JOIN unit u ON u.id=tp.unit_id "
            "WHERE t.status IN ('pending','missed') AND s.archived=0"
        ),
        _settings(),
        _blackouts(),
    )


def _create_review_tasks(task):
    if task["type"] != "read" or not task.get("topic_id"):
        return
    existing = one(
        "SELECT id FROM task WHERE topic_id=? AND is_revision=1 LIMIT 1",
        (task["topic_id"],),
    )
    if existing:
        return

    topic = one("SELECT name FROM topic WHERE id=?", (task["topic_id"],))
    if not topic:
        return
    db = get_db()
    for interval in (1, 3, 7):
        due = (date.today() + timedelta(days=interval)).isoformat()
        db.execute(
            "INSERT INTO task(topic_id,subject_id,type,title,est_minutes,scheduled_date,"
            "due_date,is_revision,created_by) VALUES(?,?,?,?,?,?,?,?,?)",
            (
                task["topic_id"],
                task["subject_id"],
                "revise",
                f"Review: {topic['name']}",
                15,
                due,
                due,
                1,
                "system",
            ),
        )
    db.execute(
        "INSERT OR IGNORE INTO review_item(topic_id,next_review) VALUES(?,?)",
        (task["topic_id"], (date.today() + timedelta(days=1)).isoformat()),
    )
    db.commit()


def _set_task_status(task, status):
    db = get_db()
    if status == "done" and task["status"] != "done":
        completed_at = datetime.now().replace(microsecond=0).isoformat()
        db.execute(
            "UPDATE task SET status='done',completed_at=? WHERE id=?",
            (completed_at, task["id"]),
        )
        db.commit()
        award_task(task)
        _create_review_tasks(task)
    elif status != "done" and task["status"] == "done":
        db.execute(
            "UPDATE task SET status=?,completed_at=NULL WHERE id=?",
            (status, task["id"]),
        )
        db.commit()
        reverse_task_award(task["id"])
    else:
        db.execute(
            "UPDATE task SET status=?,completed_at=CASE WHEN ?='done' THEN completed_at ELSE NULL END WHERE id=?",
            (status, status, task["id"]),
        )
        db.commit()


@bp.get("/subjects")
def subjects():
    active_count = one("SELECT COUNT(*) AS count FROM subject WHERE archived=0")["count"]
    result = rows(
        "SELECT s.*,(SELECT COUNT(*) FROM topic t JOIN unit u ON u.id=t.unit_id "
        "WHERE u.subject_id=s.id) AS topic_count,"
        "(SELECT COUNT(*) FROM unit u WHERE u.subject_id=s.id) AS unit_count "
        "FROM subject s ORDER BY s.archived,s.name"
    )
    return ok(
        {
            "subjects": result,
            "active_count": active_count,
            "soft_cap_warning": active_count >= 10,
            "limit": 12,
        }
    )


@bp.post("/subjects")
def add_subject():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return bad("Subject name is required.")
    if one("SELECT id FROM subject WHERE archived=0") and one(
        "SELECT COUNT(*) AS count FROM subject WHERE archived=0"
    )["count"] >= 12:
        return bad("Maya supports up to 12 active subjects. Archive one first.", 409)
    try:
        cursor = get_db().execute(
            "INSERT INTO subject(name,code,credits,exam_weight) VALUES(?,?,?,?)",
            (name, data.get("code"), data.get("credits"), data.get("exam_weight", 100)),
        )
        get_db().commit()
    except Exception as error:
        get_db().rollback()
        if "UNIQUE constraint failed" in str(error):
            return bad("A subject with that name already exists.", 409)
        raise
    count = one("SELECT COUNT(*) AS count FROM subject WHERE archived=0")["count"]
    return ok(
        {
            "id": cursor.lastrowid,
            "active_count": count,
            "soft_cap_warning": count >= 10,
        }
    )


@bp.patch("/subjects/<int:subject_id>")
def edit_subject(subject_id):
    if not one("SELECT id FROM subject WHERE id=?", (subject_id,)):
        return bad("Subject not found.", 404)
    data = request.get_json(silent=True) or {}
    allowed = {"name", "color", "archived", "credits", "exam_weight", "code"}
    values = {key: value for key, value in data.items() if key in allowed}
    if not values:
        return bad("No editable subject fields were provided.")
    if "name" in values and not str(values["name"]).strip():
        return bad("Subject name cannot be empty.")
    if values.get("archived") == 0:
        active = one(
            "SELECT COUNT(*) AS count FROM subject WHERE archived=0"
        )["count"]
        if active >= 12:
            return bad("Archive or remove an active subject before restoring this one.", 409)
    sets = ",".join(f"{key}=?" for key in values)
    get_db().execute(
        f"UPDATE subject SET {sets} WHERE id=?",
        (*values.values(), subject_id),
    )
    get_db().commit()
    return ok({"updated": True})


@bp.delete("/subjects/<int:subject_id>")
def delete_subject(subject_id):
    subject = one("SELECT archived FROM subject WHERE id=?", (subject_id,))
    if not subject:
        return bad("Subject not found.", 404)
    if not subject["archived"]:
        return bad("Archive the subject before deleting it.", 409)
    get_db().execute("DELETE FROM subject WHERE id=?", (subject_id,))
    get_db().commit()
    return ok({})


@bp.get("/subjects/<int:subject_id>/detail")
def subject_detail(subject_id):
    subject = one("SELECT * FROM subject WHERE id=?", (subject_id,))
    if not subject:
        return bad("Subject not found.", 404)
    units = rows(
        "SELECT * FROM unit WHERE subject_id=? ORDER BY order_index,id",
        (subject_id,),
    )
    for unit in units:
        topics = rows(
            "SELECT * FROM topic WHERE unit_id=? ORDER BY parent_topic_id IS NOT NULL,id",
            (unit["id"],),
        )
        for topic in topics:
            topic["prereqs"] = [
                item["prereq_topic_id"]
                for item in rows(
                    "SELECT prereq_topic_id FROM prereq WHERE topic_id=?",
                    (topic["id"],),
                )
            ]
        unit["topics"] = topics
    return ok({"subject": subject, "units": units})


@bp.post("/subjects/<int:subject_id>/units")
def add_unit(subject_id):
    if not one("SELECT id FROM subject WHERE id=?", (subject_id,)):
        return bad("Subject not found.", 404)
    name = ((request.get_json(silent=True) or {}).get("name") or "").strip()
    if not name:
        return bad("Unit name is required.")
    order = one(
        "SELECT COALESCE(MAX(order_index),0)+1 AS next_order FROM unit WHERE subject_id=?",
        (subject_id,),
    )["next_order"]
    cursor = get_db().execute(
        "INSERT INTO unit(subject_id,name,order_index) VALUES(?,?,?)",
        (subject_id, name, order),
    )
    get_db().commit()
    return ok({"id": cursor.lastrowid})


@bp.post("/units/<int:unit_id>/topics")
def add_topic(unit_id):
    unit = one("SELECT id,subject_id FROM unit WHERE id=?", (unit_id,))
    if not unit:
        return bad("Unit not found.", 404)
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return bad("Topic name is required.")
    try:
        minutes = int(data.get("est_minutes", 60))
        difficulty = int(data.get("difficulty", 3))
        marks = float(data.get("marks", 0))
    except (TypeError, ValueError):
        return bad("Topic estimates, difficulty, and marks must be numbers.")
    if not 5 <= minutes <= 3600 or not 1 <= difficulty <= 5 or marks < 0:
        return bad("Check the topic estimate, difficulty, and marks.")
    cursor = get_db().execute(
        "INSERT INTO topic(unit_id,parent_topic_id,name,difficulty,marks,est_minutes,"
        "confidence,notes) VALUES(?,?,?,?,?,?,?,?)",
        (
            unit_id,
            data.get("parent_topic_id"),
            name,
            difficulty,
            marks,
            minutes,
            1.0,
            data.get("notes", ""),
        ),
    )
    get_db().execute(
        "INSERT INTO task(topic_id,subject_id,type,title,est_minutes,created_by) "
        "VALUES(?,?,? ,?,?, 'manual')",
        (
            cursor.lastrowid,
            unit["subject_id"],
            "read",
            f"Read: {name}",
            max(15, minutes),
        ),
    )
    get_db().commit()
    return ok({"id": cursor.lastrowid})


@bp.patch("/topics/<int:topic_id>")
def edit_topic(topic_id):
    if not one("SELECT id FROM topic WHERE id=?", (topic_id,)):
        return bad("Topic not found.", 404)
    data = request.get_json(silent=True) or {}
    allowed = {"name", "difficulty", "marks", "est_minutes", "notes"}
    values = {key: value for key, value in data.items() if key in allowed}
    if "name" in values and not str(values["name"]).strip():
        return bad("Topic name cannot be empty.")
    if "difficulty" in values:
        try:
            values["difficulty"] = int(values["difficulty"])
        except (ValueError, TypeError):
            return bad("Difficulty must be a whole number from 1 to 5.")
        if values["difficulty"] not in range(1, 6):
            return bad("Difficulty must be a whole number from 1 to 5.")
    if "marks" in values:
        try:
            values["marks"] = max(0, float(values["marks"]))
        except (ValueError, TypeError):
            return bad("Marks must be a non-negative number.")
    if "est_minutes" in values:
        try:
            values["est_minutes"] = int(values["est_minutes"])
        except (ValueError, TypeError):
            return bad("Estimated minutes must be a number.")
        if not 5 <= values["est_minutes"] <= 3600:
            return bad("Estimated minutes must be between 5 and 3600.")
    if values:
        fields = ",".join(f"{key}=?" for key in values)
        get_db().execute(
            f"UPDATE topic SET {fields} WHERE id=?",
            (*values.values(), topic_id),
        )
        get_db().commit()
    return ok({})


@bp.get("/exams")
def exams():
    exams = rows(
        "SELECT e.*,s.name AS subject_name,s.color AS subject_color FROM exam e "
        "JOIN subject s ON s.id=e.subject_id ORDER BY e.exam_date"
    )
    settings = _settings()
    capacity = int(settings.get("daily_capacity_minutes", 120)) * (
        100 - int(settings.get("buffer_pct", 15))
    ) // 100
    for exam in exams:
        exam_day = date.fromisoformat(exam["exam_date"])
        exam["days_remaining"] = (exam_day - date.today()).days
        remaining = one(
            "SELECT COALESCE(SUM(est_minutes),0) AS minutes FROM task "
            "WHERE subject_id=? AND status='pending'",
            (exam["subject_id"],),
        )["minutes"]
        usable_days = max(0, exam["days_remaining"])
        available = usable_days * capacity
        exam["remaining_minutes"] = remaining
        exam["risk"] = (
            "crunch"
            if remaining > available
            else "tight"
            if remaining > available * 0.8
            else "comfortable"
        )
    return ok(exams)


@bp.post("/exams")
def add_exam():
    data = request.get_json(silent=True) or {}
    if not data.get("subject_id") or not data.get("exam_date"):
        return bad("Subject and exam date are required.")
    if not one("SELECT id FROM subject WHERE id=? AND archived=0", (data["subject_id"],)):
        return bad("Choose an active subject.", 404)
    try:
        exam_date = date.fromisoformat(data["exam_date"])
    except (ValueError, TypeError):
        return bad("Exam date must be a valid ISO date.")
    exam_type = data.get("exam_type", "final")
    if exam_type not in EXAM_TYPES:
        return bad("Choose midterm, final, quiz, or practical.")
    try:
        weightage = float(data.get("weightage", 100))
    except (TypeError, ValueError):
        return bad("Weightage must be a number.")
    if not 0 <= weightage <= 100:
        return bad("Weightage must be between 0 and 100.")
    cursor = get_db().execute(
        "INSERT INTO exam(subject_id,exam_date,exam_type,weightage,scope_unit_ids) "
        "VALUES(?,?,?,?,?)",
        (
            data["subject_id"],
            exam_date.isoformat(),
            exam_type,
            weightage,
            json.dumps(data.get("scope_unit_ids", [])),
        ),
    )
    get_db().commit()
    return ok({"id": cursor.lastrowid})


@bp.patch("/exams/<int:exam_id>")
def edit_exam(exam_id):
    if not one("SELECT id FROM exam WHERE id=?", (exam_id,)):
        return bad("Exam not found.", 404)
    data = request.get_json(silent=True) or {}
    allowed = {"exam_date", "exam_type", "weightage", "scope_unit_ids"}
    values = {key: value for key, value in data.items() if key in allowed}
    if "exam_date" in values:
        try:
            values["exam_date"] = date.fromisoformat(values["exam_date"]).isoformat()
        except (ValueError, TypeError):
            return bad("Exam date must be a valid ISO date.")
    if "exam_type" in values and values["exam_type"] not in EXAM_TYPES:
        return bad("Choose midterm, final, quiz, or practical.")
    if "scope_unit_ids" in values:
        values["scope_unit_ids"] = json.dumps(values["scope_unit_ids"])
    if values:
        fields = ",".join(f"{key}=?" for key in values)
        get_db().execute(
            f"UPDATE exam SET {fields} WHERE id=?",
            (*values.values(), exam_id),
        )
        get_db().commit()
    return ok({})


@bp.delete("/exams/<int:exam_id>")
def delete_exam(exam_id):
    get_db().execute("DELETE FROM exam WHERE id=?", (exam_id,))
    get_db().commit()
    return ok({})


@bp.get("/tasks")
def tasks():
    filters = []
    params = []
    if request.args.get("date"):
        filters.append("t.scheduled_date=?")
        params.append(request.args["date"])
    if request.args.get("status"):
        filters.append("t.status=?")
        params.append(request.args["status"])
    if request.args.get("subject_id"):
        filters.append("t.subject_id=?")
        params.append(request.args["subject_id"])
    if request.args.get("q"):
        filters.append("(t.title LIKE ? OR p.name LIKE ? OR s.name LIKE ?)")
        search = f"%{request.args['q'].strip()}%"
        params.extend([search, search, search])
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    return ok(
        _task_rows(
            "SELECT t.*,p.name AS topic_name,s.name AS subject_name,"
            "s.color AS subject_color FROM task t "
            "LEFT JOIN topic p ON p.id=t.topic_id "
            "JOIN subject s ON s.id=t.subject_id "
            f"{where} ORDER BY CASE WHEN t.is_revision=1 AND t.scheduled_date<=? "
            "AND t.status='pending' THEN 0 ELSE 1 END,"
            "COALESCE(t.scheduled_date,t.due_date,'9999-12-31'),"
            "t.priority_score DESC,t.id",
            (*params, date.today().isoformat()),
        )
    )


@bp.get("/tasks/all")
def all_tasks():
    return ok(
        _task_rows(
            "SELECT t.*,s.name AS subject_name,s.color AS subject_color "
            "FROM task t JOIN subject s ON s.id=t.subject_id ORDER BY t.id DESC"
        )
    )


@bp.post("/tasks")
def add_task():
    data = request.get_json(silent=True) or {}
    subject_id = data.get("subject_id")
    title = (data.get("title") or "").strip()
    task_type = data.get("type", "read")
    if not subject_id or not title:
        return bad("Task title and subject are required.")
    if task_type not in TASK_TYPES:
        return bad("Choose a supported task type.")
    try:
        minutes = int(data.get("est_minutes", 30))
    except (TypeError, ValueError):
        return bad("Task estimate must be in minutes.")
    if not 5 <= minutes <= 600:
        return bad("Task estimates must be between 5 and 600 minutes.")
    cursor = get_db().execute(
        "INSERT INTO task(topic_id,subject_id,type,title,est_minutes,due_date,"
        "scheduled_date,created_by) VALUES(?,?,?,?,?,?,?,'manual')",
        (
            data.get("topic_id"),
            subject_id,
            task_type,
            title,
            minutes,
            data.get("due_date"),
            data.get("scheduled_date"),
        ),
    )
    get_db().commit()
    return ok({"id": cursor.lastrowid})


@bp.post("/tasks/generate/<int:subject_id>")
def generate_tasks(subject_id):
    subject = one("SELECT id FROM subject WHERE id=?", (subject_id,))
    if not subject:
        return bad("Subject not found.", 404)
    topics = rows(
        "SELECT t.* FROM topic t JOIN unit u ON u.id=t.unit_id "
        "WHERE u.subject_id=? ORDER BY u.order_index,t.id",
        (subject_id,),
    )
    tasks = [
        {
            "topic_id": topic["id"],
            "subject_id": subject_id,
            "type": "read",
            "title": f"Read: {topic['name']}",
            "est_minutes": max(15, int(topic["est_minutes"])),
            "status": "pending",
        }
        for topic in topics
    ]
    return ok({"tasks": tasks})


@bp.post("/tasks/commit")
def commit_tasks():
    data = request.get_json(silent=True) or {}
    task_items = data.get("tasks", [])
    if not isinstance(task_items, list):
        return bad("Tasks must be provided as a list.")
    db = get_db()
    created = []
    try:
        for task in task_items:
            title = (task.get("title") or "").strip()
            task_type = task.get("type", "read")
            if not title or task_type not in TASK_TYPES:
                continue
            if not one("SELECT id FROM subject WHERE id=?", (task.get("subject_id"),)):
                continue
            minutes = max(5, min(600, int(task.get("est_minutes", 30))))
            cursor = db.execute(
                "INSERT INTO task(topic_id,subject_id,type,title,est_minutes,scheduled_date,"
                "due_date,created_by) VALUES(?,?,?,?,?,?,?,'manual')",
                (
                    task.get("topic_id"),
                    task["subject_id"],
                    task_type,
                    title,
                    minutes,
                    task.get("scheduled_date"),
                    task.get("due_date"),
                ),
            )
            created.append((cursor.lastrowid, task.get("prereq_task_ids", [])))
        for task_id, prereq_ids in created:
            for prereq_id in prereq_ids:
                db.execute(
                    "INSERT OR IGNORE INTO task_dependency(task_id,prereq_task_id) "
                    "VALUES(?,?)",
                    (task_id, prereq_id),
                )
        db.commit()
    except (TypeError, ValueError):
        db.rollback()
        return bad("Task data contains an invalid estimate or dependency.")
    return ok({"created": len(created)})


@bp.patch("/tasks/<int:task_id>")
def patch_task(task_id):
    data = request.get_json(silent=True) or {}
    task = one("SELECT * FROM task WHERE id=?", (task_id,))
    if not task:
        return bad("Task not found.", 404)

    if "status" in data:
        if data["status"] not in {"pending", "done", "skipped", "missed"}:
            return bad("Task status is invalid.")
        _set_task_status(task, data["status"])

    allowed = {"scheduled_date", "actual_minutes", "est_minutes"}
    values = {key: value for key, value in data.items() if key in allowed}
    for field in ("actual_minutes", "est_minutes"):
        if field in values:
            try:
                values[field] = max(0, int(values[field]))
            except (TypeError, ValueError):
                return bad(f"{field.replace('_', ' ').capitalize()} must be a number.")
    if values:
        updates = ",".join(f"{key}=?" for key in values)
        get_db().execute(
            f"UPDATE task SET {updates} WHERE id=?",
            (*values.values(), task_id),
        )
        get_db().commit()
    return ok(one("SELECT * FROM task WHERE id=?", (task_id,)))


@bp.post("/tasks/<int:task_id>/skip")
def skip_task(task_id):
    task = one("SELECT * FROM task WHERE id=?", (task_id,))
    if not task:
        return bad("Task not found.", 404)
    data = request.get_json(silent=True) or {}
    reason = (data.get("reason") or "").strip()
    _set_task_status(task, "skipped")
    get_db().execute("UPDATE task SET skip_reason=? WHERE id=?", (reason, task_id))
    get_db().commit()
    return ok({})


@bp.post("/tasks/<int:task_id>/snooze")
def snooze_task(task_id):
    task = one("SELECT scheduled_date FROM task WHERE id=?", (task_id,))
    if not task:
        return bad("Task not found.", 404)
    data = request.get_json(silent=True) or {}
    try:
        days = max(1, min(30, int(data.get("days", 1))))
    except (TypeError, ValueError):
        return bad("Snooze duration must be a number of days.")
    base = date.fromisoformat(task["scheduled_date"]) if task["scheduled_date"] else date.today()
    new_date = (base + timedelta(days=days)).isoformat()
    get_db().execute(
        "UPDATE task SET scheduled_date=?,status='pending' WHERE id=?",
        (new_date, task_id),
    )
    get_db().commit()
    return ok({"scheduled_date": new_date})


@bp.post("/tasks/bulk")
def bulk_edit_tasks():
    data = request.get_json(silent=True) or {}
    task_ids = data.get("task_ids", [])
    if not isinstance(task_ids, list) or not task_ids:
        return bad("Select at least one task.")
    updates = {}
    if "scheduled_date" in data:
        updates["scheduled_date"] = data["scheduled_date"]
    if "est_minutes" in data:
        try:
            updates["est_minutes"] = max(5, min(600, int(data["est_minutes"])))
        except (ValueError, TypeError):
            return bad("Task estimate must be between 5 and 600 minutes.")
    if "status" in data and data["status"] in {"pending", "done", "skipped"}:
        updates["status"] = data["status"]
    if not updates:
        return bad("No valid bulk changes were provided.")
    for task_id in task_ids:
        task = one("SELECT * FROM task WHERE id=?", (task_id,))
        if not task:
            continue
        if "status" in updates:
            _set_task_status(task, updates["status"])
        other = {key: value for key, value in updates.items() if key != "status"}
        if other:
            sql = ",".join(f"{key}=?" for key in other)
            get_db().execute(
                f"UPDATE task SET {sql} WHERE id=?",
                (*other.values(), task_id),
            )
    get_db().commit()
    return ok({"updated": len(task_ids)})


@bp.post("/tasks/<int:task_id>/session")
def log_task_session(task_id):
    task = one("SELECT id,actual_minutes FROM task WHERE id=?", (task_id,))
    if not task:
        return bad("Task not found.", 404)
    data = request.get_json(silent=True) or {}
    try:
        minutes = int(data.get("minutes", 25))
    except (TypeError, ValueError):
        return bad("Session duration must be in minutes.")
    if not 1 <= minutes <= 240:
        return bad("Session duration must be between 1 and 240 minutes.")
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    db = get_db()
    cursor = db.execute(
        "INSERT INTO task_session(task_id,started_at,ended_at,minutes) VALUES(?,?,?,?)",
        (task_id, data.get("started_at", now), now, minutes),
    )
    db.execute(
        "UPDATE task SET actual_minutes=actual_minutes+? WHERE id=?",
        (minutes, task_id),
    )
    db.commit()
    xp = award_pomodoro(cursor.lastrowid, minutes) if data.get("completed", True) else 0
    return ok({"minutes": minutes, "xp_awarded": xp})


@bp.get("/plan/today")
def today():
    subjects, exams, tasks, settings, blackouts = _plan_data()
    result = plan_day(date.today().isoformat(), subjects, exams, tasks, settings, blackouts)
    return ok(result)


@bp.get("/plan/week")
def week():
    requested_start = request.args.get("start", date.today().isoformat())
    try:
        start = date.fromisoformat(requested_start)
    except ValueError:
        return bad("Plan start must be a valid ISO date.")
    subjects, exams, tasks, settings, blackouts = _plan_data()
    return ok(plan_week(start.isoformat(), subjects, exams, tasks, settings, blackouts))


@bp.post("/plan/replan")
def replan():
    subjects, exams, tasks, settings, blackouts = _plan_data()
    result = adaptive_replan(date.today().isoformat(), tasks, settings, exams, blackouts)
    db = get_db()
    today_key = date.today().isoformat()
    db.execute(
        "UPDATE task SET status='missed',scheduled_date=NULL "
        "WHERE status='pending' AND scheduled_date<?",
        (today_key,),
    )
    db.execute(
        "UPDATE task SET scheduled_date=NULL WHERE status IN ('pending','missed')"
    )
    for task_id, scheduled_date in result["schedule"].items():
        db.execute(
            "UPDATE task SET scheduled_date=?,status='pending' "
            "WHERE id=? AND status IN ('pending','missed')",
            (scheduled_date, task_id),
        )
    db.commit()
    return ok(
        {
            "moved": result["moved"],
            "crunch": result["crunch"],
            "explanation": result["explanation"],
            "unscheduled": result["unscheduled"],
        }
    )


@bp.get("/reviews/queue")
def review_queue():
    return ok(
        rows(
            "SELECT r.*,t.name AS topic_name,s.name AS subject_name,t.notes AS back "
            "FROM review_item r JOIN topic t ON t.id=r.topic_id "
            "JOIN unit u ON u.id=t.unit_id JOIN subject s ON s.id=u.subject_id "
            "WHERE next_review<=? ORDER BY next_review",
            (date.today().isoformat(),),
        )
    )


@bp.post("/reviews/<int:review_id>/grade")
def grade_review(review_id):
    data = request.get_json(silent=True) or {}
    try:
        quality = int(data.get("quality", 3))
    except (TypeError, ValueError):
        return bad("Choose a review grade from 0 to 5.")
    quality = max(0, min(5, quality))
    review = one("SELECT * FROM review_item WHERE id=?", (review_id,))
    if not review:
        return bad("Review not found.", 404)

    ease = max(1.3, review["ease"] + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    interval = 1 if quality < 3 else (
        1 if review["reps"] == 0 else
        6 if review["reps"] == 1 else
        max(1, round(review["interval_days"] * ease))
    )
    next_review = (date.today() + timedelta(days=interval)).isoformat()
    get_db().execute(
        "UPDATE review_item SET ease=?,interval_days=?,next_review=?,reps=reps+1 "
        "WHERE id=?",
        (ease, interval, next_review, review_id),
    )
    get_db().commit()
    return ok({"next_review": next_review, "interval_days": interval, "ease": ease})


@bp.get("/profile")
def get_profile():
    return ok(profile())


@bp.get("/blackouts")
def list_blackouts():
    return ok(rows("SELECT * FROM blackout ORDER BY date"))


@bp.post("/blackouts")
def add_blackout():
    data = request.get_json(silent=True) or {}
    try:
        day = date.fromisoformat(data.get("date", "")).isoformat()
    except (ValueError, TypeError):
        return bad("Choose a valid blackout date.")
    reason = (data.get("reason") or "").strip()[:200]
    try:
        cursor = get_db().execute(
            "INSERT INTO blackout(date,reason) VALUES(?,?)",
            (day, reason),
        )
        get_db().commit()
    except Exception as error:
        get_db().rollback()
        if "UNIQUE constraint failed" in str(error):
            return bad("That blackout date already exists.", 409)
        raise
    return ok({"id": cursor.lastrowid})


@bp.delete("/blackouts/<int:blackout_id>")
def delete_blackout(blackout_id):
    get_db().execute("DELETE FROM blackout WHERE id=?", (blackout_id,))
    get_db().commit()
    return ok({})


@bp.get("/settings")
def settings():
    current = _settings()
    provider = get_provider()
    return ok(
        {
            "settings": {
                key: value
                for key, value in current.items()
                if key not in {"web_lock_key", "gemini_api_key"}
            },
            "web_lock_enabled": bool(current.get("web_lock_key")),
            "gemini_key_set": bool(current.get("gemini_api_key")),
            "active_provider": provider.name if provider else None,
            "providers_available": available_providers(),
        }
    )


@bp.patch("/settings")
def patch_settings():
    data = request.get_json(silent=True) or {}
    allowed = {
        "daily_capacity_minutes",
        "study_days",
        "buffer_pct",
        "theme",
        "web_lock_key",
        "gemini_api_key",
        "daily_goal",
        "weekly_goal",
    }
    values = {key: value for key, value in data.items() if key in allowed}
    for key in ("daily_capacity_minutes", "buffer_pct", "daily_goal", "weekly_goal"):
        if key in values:
            try:
                values[key] = int(values[key])
            except (TypeError, ValueError):
                return bad(f"{key.replace('_', ' ').capitalize()} must be a number.")
    if "daily_capacity_minutes" in values and not 15 <= values["daily_capacity_minutes"] <= 720:
        return bad("Daily capacity must be between 15 and 720 minutes.")
    if "buffer_pct" in values and not 0 <= values["buffer_pct"] <= 50:
        return bad("Catch-up buffer must be between 0 and 50 percent.")
    if "study_days" in values:
        if not isinstance(values["study_days"], list) or any(
            day not in range(7) for day in values["study_days"]
        ):
            return bad("Study days must be a list of weekdays from 0 to 6.")
        values["study_days"] = json.dumps(sorted(set(values["study_days"])))
    if "theme" in values and values["theme"] not in {"light", "dark", "auto"}:
        return bad("Theme must be light, dark, or auto.")
    if not values:
        return bad("No valid settings were provided.")
    fields = ",".join(f"{field}=?" for field in values)
    get_db().execute(
        f"UPDATE settings SET {fields} WHERE id=1",
        tuple(values.values()),
    )
    get_db().commit()
    return ok({})


@bp.get("/export/ics")
def export_ics():
    from .ics_export import calendar_text

    tasks = rows("SELECT * FROM task WHERE status!='skipped'")
    exams = rows("SELECT * FROM exam")
    return Response(
        calendar_text(tasks, exams),
        mimetype="text/calendar",
        headers={"Content-Disposition": "attachment; filename=maya.ics"},
    )


BACKUP_TABLES = (
    "subject",
    "unit",
    "topic",
    "prereq",
    "task",
    "task_dependency",
    "exam",
    "blackout",
    "review_item",
    "task_session",
    "xp_event",
    "badge",
    "flashcard",
    "settings",
)


@bp.get("/export/backup")
def export_backup():
    backup = {
        "format": "maya-backup",
        "version": 1,
        "tables": {table: rows(f"SELECT * FROM {table}") for table in BACKUP_TABLES},
    }
    for setting in backup["tables"]["settings"]:
        setting.pop("web_lock_key", None)
        setting.pop("gemini_api_key", None)
    return Response(
        json.dumps(backup, ensure_ascii=False),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=maya-backup.json"},
    )


@bp.post("/import/backup")
def import_backup():
    backup = request.get_json(silent=True)
    if (
        not isinstance(backup, dict)
        or backup.get("format") != "maya-backup"
        or backup.get("version") != 1
        or not isinstance(backup.get("tables"), dict)
    ):
        return bad("This is not a supported Maya backup.")
    tables = backup["tables"]
    if any(not isinstance(tables.get(table, []), list) for table in BACKUP_TABLES):
        return bad("Backup table data is invalid.")

    db = get_db()
    current_settings = one("SELECT * FROM settings WHERE id=1") or {}
    try:
        db.execute("PRAGMA defer_foreign_keys=ON")
        for table in reversed(BACKUP_TABLES[:-1]):
            db.execute(f"DELETE FROM {table}")
        db.execute("DELETE FROM settings WHERE id=1")

        for table in BACKUP_TABLES:
            records = tables.get(table, [])
            if table == "settings":
                records = [
                    {
                        **record,
                        "web_lock_key": current_settings.get("web_lock_key", ""),
                        "gemini_api_key": current_settings.get("gemini_api_key", ""),
                    }
                    for record in records
                ]
            for record in records:
                if not isinstance(record, dict):
                    raise ValueError(f"Invalid record in {table}.")
                columns = {
                    row["name"] for row in db.execute(f"PRAGMA table_info({table})")
                }
                values = {key: value for key, value in record.items() if key in columns}
                if not values:
                    continue
                names = ",".join(values)
                placeholders = ",".join("?" for _ in values)
                db.execute(
                    f"INSERT INTO {table}({names}) VALUES({placeholders})",
                    tuple(values.values()),
                )
        db.commit()
    except (ValueError, TypeError, Exception) as error:
        db.rollback()
        logger.exception("Maya backup restore failed")
        return bad(f"Backup restore failed: {error}", 400)
    return ok({"restored": True})
