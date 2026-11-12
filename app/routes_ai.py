import asyncio
import json
import logging

from flask import Blueprint, jsonify, request
from pydantic import ValidationError

from .ai_parser import Extraction
from .dag_engine import topological_order_with_edges
from .db import get_db, one, rows
from .services.ai.base import AIProviderError
from .services.ai.factory import get_provider
from .services.ai.prompts import (
    EXPLAIN_PROMPT,
    FLASHCARDS_PROMPT,
    QUICKADD_PROMPT,
    SYLLABUS_EXTRACT_PROMPT,
)
from .utils.extract_text import extract_upload

ai_bp = Blueprint("ai", __name__, url_prefix="/api")
logger = logging.getLogger(__name__)


def _error(message, status=400):
    return jsonify(ok=False, error=message), status


def _normalise(value):
    return "".join(character.lower() for character in value if character.isalnum())


def _insert_tasks(db, subject_id, units, topic_ids, prerequisites, priorities):
    read_tasks = {}
    unit_reads = {}

    for unit_index, unit in enumerate(units):
        unit_reads[unit_index] = []
        for topic in unit["topics"]:
            topic_id = topic_ids[_normalise(topic["name"])]
            minutes = max(15, round(float(topic.get("est_hours", 1)) * 60 / 5) * 5)
            cursor = db.execute(
                "INSERT INTO task(topic_id,subject_id,type,title,est_minutes,priority_score,created_by) "
                "VALUES(?,?,?,?,?,?,'ai')",
                (
                    topic_id,
                    subject_id,
                    "read",
                    f"Read: {topic['name']}",
                    minutes,
                    priorities.get(topic_id, 0),
                ),
            )
            task_id = cursor.lastrowid
            read_tasks[topic_id] = task_id
            unit_reads[unit_index].append(task_id)

    for topic_id, prerequisite_ids in prerequisites.items():
        task_id = read_tasks.get(topic_id)
        if not task_id:
            continue
        for prerequisite in prerequisite_ids:
            prerequisite_task = read_tasks.get(prerequisite)
            if prerequisite_task:
                db.execute(
                    "INSERT OR IGNORE INTO task_dependency(task_id,prereq_task_id) "
                    "VALUES(?,?)",
                    (task_id, prerequisite_task),
                )

    for unit_index, unit in enumerate(units):
        topic_names = [_normalise(topic["name"]) for topic in unit["topics"]]
        if not topic_names:
            continue
        total_hours = sum(float(topic.get("est_hours", 1)) for topic in unit["topics"])
        unit_priority = max(
            (priorities.get(topic_ids[_normalise(topic["name"])], 0) for topic in unit["topics"]),
            default=0,
        )
        notes_cursor = db.execute(
            "INSERT INTO task(subject_id,type,title,est_minutes,priority_score,created_by) "
            "VALUES(?,?,?,?,?,'ai')",
            (
                subject_id,
                "notes",
                f"Make notes: {unit['name']}",
                max(15, round(total_hours * 18 / 5) * 5),
                unit_priority,
            ),
        )
        notes_id = notes_cursor.lastrowid
        for read_id in unit_reads[unit_index]:
            db.execute(
                "INSERT OR IGNORE INTO task_dependency(task_id,prereq_task_id) "
                "VALUES(?,?)",
                (notes_id, read_id),
            )

        if any(int(topic.get("difficulty", 3)) >= 3 for topic in unit["topics"]):
            practice_cursor = db.execute(
                "INSERT INTO task(subject_id,type,title,est_minutes,priority_score,created_by) "
                "VALUES(?,?,?,?,?,'ai')",
                (
                    subject_id,
                    "practice",
                    f"Practice: {unit['name']}",
                    max(15, round(total_hours * 30 / 5) * 5),
                    unit_priority,
                ),
            )
            db.execute(
                "INSERT INTO task_dependency(task_id,prereq_task_id) VALUES(?,?)",
                (practice_cursor.lastrowid, notes_id),
            )


def _commit_subject(db, subject):
    cursor = db.execute(
        "INSERT INTO subject(name,code,credits) VALUES(?,?,?)",
        (subject.name.strip(), subject.code, subject.credits),
    )
    subject_id = cursor.lastrowid
    topic_ids = {}
    units = []

    for unit in sorted(subject.units, key=lambda item: item.order):
        unit_cursor = db.execute(
            "INSERT INTO unit(subject_id,name,order_index) VALUES(?,?,?)",
            (subject_id, unit.name.strip(), unit.order),
        )
        unit_row = {"name": unit.name.strip(), "id": unit_cursor.lastrowid, "topics": []}
        units.append(unit_row)
        for topic in unit.topics:
            topic_cursor = db.execute(
                "INSERT INTO topic(unit_id,name,difficulty,marks,est_minutes,confidence) "
                "VALUES(?,?,?,?,?,?)",
                (
                    unit_cursor.lastrowid,
                    topic.name.strip(),
                    topic.difficulty,
                    topic.marks,
                    max(15, round(topic.est_hours * 60)),
                    topic.confidence,
                ),
            )
            topic_id = topic_cursor.lastrowid
            topic_ids[_normalise(topic.name)] = topic_id
            unit_row["topics"].append(
                {
                    "name": topic.name,
                    "id": topic_id,
                    "difficulty": topic.difficulty,
                    "marks": topic.marks,
                    "est_hours": topic.est_hours,
                    "prerequisites": topic.prerequisites,
                    "subtopics": topic.subtopics,
                }
            )
            for subtopic in topic.subtopics:
                subtopic_cursor = db.execute(
                    "INSERT INTO topic(unit_id,parent_topic_id,name,difficulty,marks,est_minutes,confidence) "
                    "VALUES(?,?,?,?,?,?,?)",
                    (
                        unit_cursor.lastrowid,
                        topic_id,
                        subtopic.strip(),
                        topic.difficulty,
                        0,
                        max(15, round(topic.est_hours * 30)),
                        topic.confidence,
                    ),
                )
                topic_ids[_normalise(subtopic)] = subtopic_cursor.lastrowid
                unit_row["topics"].append(
                    {
                        "name": subtopic.strip(),
                        "id": subtopic_cursor.lastrowid,
                        "difficulty": topic.difficulty,
                        "marks": 0,
                        "est_hours": topic.est_hours / 2,
                        "prerequisites": [],
                        "subtopics": [],
                    }
                )

    graph_topics = []
    for unit in units:
        for topic in unit["topics"]:
            prerequisite_ids = []
            for prerequisite_name in topic["prerequisites"]:
                prerequisite_id = topic_ids.get(_normalise(prerequisite_name))
                if prerequisite_id and prerequisite_id != topic["id"]:
                    prerequisite_ids.append(prerequisite_id)
            graph_topics.append(
                {
                    "id": topic["id"],
                    "marks": topic["marks"],
                    "est_minutes": max(15, round(float(topic["est_hours"]) * 60)),
                    "prereqs": prerequisite_ids,
                }
            )

    _, warnings, prerequisite_map, priorities = topological_order_with_edges(graph_topics)
    for topic_id, prerequisite_ids in prerequisite_map.items():
        for prerequisite_id in prerequisite_ids:
            db.execute(
                "INSERT OR IGNORE INTO prereq(topic_id,prereq_topic_id) VALUES(?,?)",
                (topic_id, prerequisite_id),
            )
    _insert_tasks(db, subject_id, units, topic_ids, prerequisite_map, priorities)
    return subject_id, warnings


@ai_bp.post("/upload")
def upload():
    provider = get_provider()
    if not provider:
        return _error("Add your Gemini API key in Settings to use syllabus extraction.", 503)

    file = request.files.get("file")
    pasted_text = request.form.get("pasted_text", "").strip()
    media_bytes = media_type = None
    extracted_text = ""
    try:
        if file:
            extracted_text, media_bytes, media_type = extract_upload(
                file.filename or "", file.read()
            )
        if not extracted_text.strip() and not media_bytes and not pasted_text:
            return _error("Choose a syllabus file or paste syllabus text.")

        subject_name = request.form.get("subject_name", "").strip()
        context = f"Suggested subject name: {subject_name or 'infer from syllabus'}\n"
        context += extracted_text
        if pasted_text:
            context += f"\n\nAdditional syllabus text:\n{pasted_text}"

        extraction = asyncio.run(
            provider.complete_json(
                SYLLABUS_EXTRACT_PROMPT,
                context,
                Extraction,
                image_bytes=media_bytes,
                image_mime_type=media_type,
            )
        )
        return jsonify(
            ok=True,
            data={"extraction": extraction.model_dump(), "warnings": extraction.warnings},
        )
    except ValueError as error:
        return _error(str(error))
    except AIProviderError as error:
        logger.warning("Gemini syllabus extraction failed: %s", error)
        return _error(str(error), 503)
    except Exception:
        logger.exception("Unexpected error during syllabus extraction")
        return _error("Syllabus extraction failed. Check the file and Gemini API key.", 503)


@ai_bp.post("/extract/commit")
def commit():
    try:
        extraction = Extraction.model_validate(
            (request.get_json(silent=True) or {}).get("extraction", {})
        )
    except ValidationError as error:
        return _error(f"Review data is invalid: {error.errors()[0]['msg']}")

    active_count = one("SELECT COUNT(*) AS count FROM subject WHERE archived=0")["count"]
    if active_count + len(extraction.subjects) > 12:
        return _error("Maya supports up to 12 active subjects. Archive one first.", 409)

    db = get_db()
    try:
        committed = [_commit_subject(db, subject) for subject in extraction.subjects]
        subject_ids = [subject_id for subject_id, _ in committed]
        warnings = [warning for _, items in committed for warning in items]
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to save reviewed syllabus")
        return _error("Could not save this syllabus. No changes were committed.", 500)

    return jsonify(
        ok=True,
        data={
            "subject_ids": subject_ids,
            "active_subjects": active_count + len(subject_ids),
            "soft_cap_warning": active_count + len(subject_ids) >= 10,
            "warnings": warnings,
        },
    )


@ai_bp.post("/ai/quickadd")
def quickadd():
    provider = get_provider()
    if not provider:
        return _error("Add your Gemini API key in Settings to use quick add.", 503)
    text = ((request.get_json(silent=True) or {}).get("text") or "").strip()
    if not text:
        return _error("Describe the task or exam you want to add.")
    from datetime import date

    subjects = [item["name"] for item in rows("SELECT name FROM subject WHERE archived=0")]
    prompt = QUICKADD_PROMPT.replace("{TODAY_ISO}", date.today().isoformat()).replace(
        "{SUBJECTS}", json.dumps(subjects)
    )
    try:
        result = asyncio.run(provider.complete_json(prompt, text, None))
        return jsonify(ok=True, data=result)
    except AIProviderError as error:
        return _error(str(error), 503)


@ai_bp.post("/ai/explain")
def explain():
    data = request.get_json(silent=True) or {}
    topic = one("SELECT name,notes FROM topic WHERE id=?", (data.get("topic_id"),))
    if not topic:
        return _error("Topic not found.", 404)
    provider = get_provider()
    if not provider:
        return _error("Add your Gemini API key in Settings to use topic explanations.", 503)
    try:
        text = asyncio.run(
            provider.complete_text(
                EXPLAIN_PROMPT, f"Topic: {topic['name']}\nNotes: {topic['notes'] or ''}"
            )
        )
        return jsonify(ok=True, data={"text": text})
    except AIProviderError as error:
        return _error(str(error), 503)


@ai_bp.post("/ai/flashcards")
def flashcards():
    data = request.get_json(silent=True) or {}
    topic_id = data.get("topic_id")
    topic = one("SELECT name,notes FROM topic WHERE id=?", (topic_id,))
    if not topic:
        return _error("Topic not found.", 404)

    cached = rows("SELECT front,back FROM flashcard WHERE topic_id=? ORDER BY id", (topic_id,))
    if cached:
        return jsonify(ok=True, data=cached)

    provider = get_provider()
    if not provider:
        return _error("Add your Gemini API key in Settings to create flashcards.", 503)
    try:
        result = asyncio.run(
            provider.complete_json(
                FLASHCARDS_PROMPT,
                f"Topic: {topic['name']}\nNotes: {topic['notes'] or ''}",
                None,
            )
        )
        cards = result.get("cards", []) if isinstance(result, dict) else []
        if not cards:
            return _error("Gemini returned no flashcards. Add notes and try again.", 503)
        db = get_db()
        for card in cards:
            if card.get("front") and card.get("back"):
                db.execute(
                    "INSERT INTO flashcard(topic_id,front,back) VALUES(?,?,?)",
                    (topic_id, card["front"], card["back"]),
                )
        db.commit()
        return jsonify(ok=True, data=cards)
    except AIProviderError as error:
        return _error(str(error), 503)
