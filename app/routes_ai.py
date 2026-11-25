import asyncio
import json
import logging
import re
import threading
import time
from collections import deque
from datetime import date
from functools import wraps

from flask import Blueprint, current_app, jsonify, request

from .ai_parser import Extraction, ImportanceResult
from .services.ai.base import AIProviderError
from .services.ai.factory import DEFAULT_MODEL, get_provider
from .services.ai.prompts import (
    EXPLAIN_PROMPT,
    FLASHCARDS_PROMPT,
    IMPORTANCE_PROMPT,
    QUICKADD_PROMPT,
    SYLLABUS_EXTRACT_PROMPT,
)
from .utils.extract_text import extract_upload

ai_bp = Blueprint("ai", __name__, url_prefix="/api")
logger = logging.getLogger(__name__)
rate_limit_lock = threading.Lock()
request_times = {}

MAX_IMPORTANCE_TOPICS = 300
MAX_EXTRACTED_TOPICS = 2_000
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _error(message, status=400):
    return jsonify(ok=False, error=message), status


def _api_key():
    return (
        request.headers.get("X-AI-Api-Key")
        or request.headers.get("X-Gemini-Api-Key", "")
    ).strip()


def _ai_model():
    return request.headers.get("X-AI-Model", DEFAULT_MODEL).strip() or DEFAULT_MODEL


def _json_object():
    data = request.get_json(silent=True)
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ValueError("Request body must be a JSON object.")
    return data


def _rate_limit_exceeded():
    now = time.monotonic()
    client = request.remote_addr or "unknown"
    limit = max(1, int(current_app.config["AI_REQUESTS_PER_MINUTE"]))
    with rate_limit_lock:
        for key, timestamps in list(request_times.items()):
            while timestamps and now - timestamps[0] >= 60:
                timestamps.popleft()
            if not timestamps:
                del request_times[key]
        timestamps = request_times.setdefault(client, deque())
        if len(timestamps) >= limit:
            return True
        timestamps.append(now)
        return False


def _run_ai(awaitable):
    return asyncio.run(
        asyncio.wait_for(
            awaitable,
            timeout=max(1, int(current_app.config["AI_TIMEOUT_SECONDS"])),
        )
    )


def ai_errors(action):
    """Turn provider and unexpected failures into JSON errors, never an HTML 500."""

    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            if _rate_limit_exceeded():
                return _error("Too many AI requests. Wait a minute and try again.", 429)
            try:
                return view(*args, **kwargs)
            except ValueError as error:
                return _error(str(error))
            except asyncio.TimeoutError:
                return _error("The AI request timed out. Try again.", 504)
            except AIProviderError as error:
                logger.warning("%s failed: %s", action, error)
                status = 504 if "timed out" in str(error).lower() else 503
                return _error(str(error), status)
            except Exception:
                logger.exception("Unexpected error during %s", action)
                return _error(f"{action} failed. Check your API key and selected model.", 503)

        return wrapper

    return decorator


@ai_bp.post("/upload")
@ai_errors("Syllabus extraction")
def upload():
    api_key = _api_key()
    if not api_key:
        return _error("Add your API key in Settings to use syllabus extraction.", 503)

    file = request.files.get("file")
    pasted_text = request.form.get("pasted_text", "").strip()
    if len(pasted_text) > current_app.config["MAX_PASTED_TEXT_CHARS"]:
        return _error(
            f"Pasted syllabus text must be {current_app.config['MAX_PASTED_TEXT_CHARS']:,} characters or fewer."
        )
    media_bytes = media_type = None
    extracted_text = ""
    if file:
        file_bytes = file.read(current_app.config["MAX_AI_FILE_BYTES"] + 1)
        if len(file_bytes) > current_app.config["MAX_AI_FILE_BYTES"]:
            return _error("Syllabus files must be 12 MB or smaller.")
        extracted_text, media_bytes, media_type = extract_upload(
            file.filename or "", file_bytes
        )
    if not extracted_text.strip() and not media_bytes and not pasted_text:
        return _error("Choose a syllabus file or paste syllabus text.")

    subject_name = request.form.get("subject_name", "").strip()
    context = f"Suggested subject name: {subject_name or 'infer from syllabus'}\n"
    context += extracted_text
    if pasted_text:
        context += f"\n\nAdditional syllabus text:\n{pasted_text}"
    if len(context) > current_app.config["MAX_AI_INPUT_CHARS"]:
        return _error(
            f"Combined syllabus content must be {current_app.config['MAX_AI_INPUT_CHARS']:,} characters or fewer."
        )

    provider = get_provider(api_key, _ai_model(), timeout=current_app.config["AI_TIMEOUT_SECONDS"])
    extraction = _run_ai(
        provider.complete_json(
            SYLLABUS_EXTRACT_PROMPT,
            context,
            Extraction,
            image_bytes=media_bytes,
            image_mime_type=media_type,
        )
    )
    extraction_data = extraction.model_dump()
    topic_count = sum(
        len(unit.get("topics", []))
        + sum(len(topic.get("subtopics", [])) for topic in unit.get("topics", []))
        for subject in extraction_data.get("subjects", [])
        for unit in subject.get("units", [])
    )
    if topic_count > MAX_EXTRACTED_TOPICS:
        return _error(
            f"The extracted syllabus contains more than {MAX_EXTRACTED_TOPICS:,} topics. Split it into smaller uploads."
        )
    return jsonify(
        ok=True,
        data={"extraction": extraction_data, "warnings": extraction_data.get("warnings", [])},
    )


@ai_bp.post("/ai/quickadd")
@ai_errors("Quick add")
def quickadd():
    api_key = _api_key()
    if not api_key:
        return _error("Add your API key in Settings to use quick add.", 503)
    data = _json_object()
    text = data.get("text", "")
    if not isinstance(text, str):
        return _error("Describe the task or exam you want to add.")
    text = text.strip()
    if not text:
        return _error("Describe the task or exam you want to add.")
    if len(text) > 1_000:
        return _error("Quick-add text must be 1,000 characters or fewer.")
    subjects = data.get("subjects", [])
    if not isinstance(subjects, list) or len(subjects) > 12 or any(
        not isinstance(subject, str) or len(subject) > 120 for subject in subjects
    ):
        return _error("Subject list is invalid.")
    today = str(data.get("today", ""))
    if not DATE_PATTERN.match(today):
        today = date.today().isoformat()
    prompt = QUICKADD_PROMPT.replace("{TODAY_ISO}", today).replace(
        "{SUBJECTS}", json.dumps(subjects)
    )
    provider = get_provider(api_key, _ai_model(), timeout=current_app.config["AI_TIMEOUT_SECONDS"])
    result = _run_ai(provider.complete_json(prompt, text, None))
    return jsonify(ok=True, data=result)


@ai_bp.post("/ai/explain")
@ai_errors("Topic explanation")
def explain():
    data = _json_object()
    topic = data.get("topic")
    if not isinstance(topic, dict):
        return _error("Topic not found.", 404)
    name = topic.get("name")
    notes = topic.get("notes", "")
    if not isinstance(name, str) or not name.strip():
        return _error("Topic not found.", 404)
    if not isinstance(notes, str) or len(name) > 200 or len(notes) > current_app.config["MAX_EXPLAIN_NOTES_CHARS"]:
        return _error("Topic name or notes exceed the supported size.")
    api_key = _api_key()
    if not api_key:
        return _error("Add a key to use topic explanations.", 503)
    provider = get_provider(api_key, _ai_model(), timeout=current_app.config["AI_TIMEOUT_SECONDS"])
    text = _run_ai(
        provider.complete_text(
            EXPLAIN_PROMPT, f"Topic: {name}\nNotes: {notes}"
        )
    )
    return jsonify(ok=True, data={"text": text})


@ai_bp.post("/ai/flashcards")
@ai_errors("Flashcard creation")
def flashcards():
    data = _json_object()
    topic = data.get("topic")
    if not isinstance(topic, dict):
        return _error("Topic not found.", 404)
    name = topic.get("name")
    notes = topic.get("notes", "")
    if not isinstance(name, str) or not name.strip():
        return _error("Topic not found.", 404)
    if not isinstance(notes, str) or len(name) > 200 or len(notes) > current_app.config["MAX_EXPLAIN_NOTES_CHARS"]:
        return _error("Topic name or notes exceed the supported size.")
    api_key = _api_key()
    if not api_key:
        return _error("Add a key to create flashcards.", 503)
    provider = get_provider(api_key, _ai_model(), timeout=current_app.config["AI_TIMEOUT_SECONDS"])
    result = _run_ai(
        provider.complete_json(
            FLASHCARDS_PROMPT,
            f"Topic: {name}\nNotes: {notes}",
            None,
        )
    )
    cards = result.get("cards", []) if isinstance(result, dict) else []
    if not cards:
        return _error("The AI returned no flashcards. Add notes and try again.", 503)
    return jsonify(ok=True, data=cards)


def _clean_subject(raw):
    """Validate the subject outline sent by the browser and return (text, known_ids)."""
    if not isinstance(raw, dict) or not str(raw.get("name", "")).strip():
        raise ValueError("Choose a subject to analyze.")
    units = raw.get("units") or []
    if not isinstance(units, list) or len(units) > 100:
        raise ValueError("This subject has too many units to analyze at once.")
    lines = [f"Subject: {str(raw['name']).strip()[:120]}"]
    known = set()
    for unit in units:
        if not isinstance(unit, dict):
            continue
        lines.append(f"\nUnit: {str(unit.get('name', '')).strip()[:200]}")
        topics = unit.get("topics") or []
        if not isinstance(topics, list):
            raise ValueError("This subject contains invalid topic data.")
        for topic in topics:
            if not isinstance(topic, dict):
                continue
            try:
                topic_id = int(topic.get("id"))
            except (TypeError, ValueError):
                continue
            name = str(topic.get("name", "")).strip()[:200]
            if not name:
                continue
            known.add(topic_id)
            raw_subtopics = topic.get("subtopics") or []
            if not isinstance(raw_subtopics, list) or any(
                not isinstance(item, str) for item in raw_subtopics
            ):
                raise ValueError("This subject contains invalid subtopic data.")
            subtopics = [item.strip()[:100] for item in raw_subtopics[:8]]
            lines.append(
                f"- topic_id={topic_id} | {name} | marks={topic.get('marks', 0)} "
                f"| difficulty={topic.get('difficulty', 3)} "
                f"| minutes={topic.get('est_minutes', 60)}"
                + (f" | subtopics: {', '.join(subtopics)}" if subtopics else "")
            )
            if len(known) > MAX_IMPORTANCE_TOPICS:
                raise ValueError(
                    f"This subject has more than {MAX_IMPORTANCE_TOPICS} topics. "
                    "Split it into smaller subjects first."
                )
    if len("\n".join(lines)) > 100_000:
        raise ValueError("This subject outline is too large to analyze. Split it into smaller subjects first.")
    if not known:
        raise ValueError("This subject has no topics to analyze yet.")
    return "\n".join(lines), known


@ai_bp.post("/ai/important")
@ai_errors("Important-topic analysis")
def important_topics():
    api_key = _api_key()
    if not api_key:
        return _error("Add your API key in Settings to find important topics.", 503)
    data = _json_object()
    outline, known_ids = _clean_subject(data.get("subject"))
    prompt_input = f"BEGIN SYLLABUS DATA\n{outline}\nEND SYLLABUS DATA"
    provider = get_provider(api_key, _ai_model(), timeout=current_app.config["AI_TIMEOUT_SECONDS"])
    result = _run_ai(provider.complete_json(IMPORTANCE_PROMPT, prompt_input, ImportanceResult))
    seen = {}
    for item in result.topics:
        if item.topic_id in known_ids and item.topic_id not in seen:
            seen[item.topic_id] = {
                "topic_id": item.topic_id,
                "score": item.score,
                "reason": " ".join(item.reason.split())[:200],
            }
    if not seen:
        raise AIProviderError("The AI did not return usable ratings. Try again.")
    return jsonify(ok=True, data={"topics": list(seen.values())})
