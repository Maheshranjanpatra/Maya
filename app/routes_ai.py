import asyncio
import json
import logging
import re
import threading
from datetime import date
from functools import wraps

from flask import Blueprint, jsonify, request

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
provider_lock = threading.Lock()

MAX_IMPORTANCE_TOPICS = 300
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


def ai_errors(action):
    """Turn provider and unexpected failures into JSON errors, never an HTML 500."""

    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            try:
                return view(*args, **kwargs)
            except ValueError as error:
                return _error(str(error))
            except AIProviderError as error:
                logger.warning("%s failed: %s", action, error)
                return _error(str(error), 503)
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
    media_bytes = media_type = None
    extracted_text = ""
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

    with provider_lock:
        provider = get_provider(api_key, _ai_model())
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


@ai_bp.post("/ai/quickadd")
@ai_errors("Quick add")
def quickadd():
    api_key = _api_key()
    if not api_key:
        return _error("Add your API key in Settings to use quick add.", 503)
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return _error("Describe the task or exam you want to add.")
    subjects = data.get("subjects", [])
    today = str(data.get("today", ""))
    if not DATE_PATTERN.match(today):
        today = date.today().isoformat()
    prompt = QUICKADD_PROMPT.replace("{TODAY_ISO}", today).replace(
        "{SUBJECTS}", json.dumps(subjects)
    )
    with provider_lock:
        provider = get_provider(api_key, _ai_model())
        result = asyncio.run(provider.complete_json(prompt, text, None))
    return jsonify(ok=True, data=result)


@ai_bp.post("/ai/explain")
@ai_errors("Topic explanation")
def explain():
    data = request.get_json(silent=True) or {}
    topic = data.get("topic") or {}
    if not topic.get("name"):
        return _error("Topic not found.", 404)
    api_key = _api_key()
    if not api_key:
        return _error("Add a key to use topic explanations.", 503)
    with provider_lock:
        provider = get_provider(api_key, _ai_model())
        text = asyncio.run(
            provider.complete_text(
                EXPLAIN_PROMPT, f"Topic: {topic['name']}\nNotes: {topic.get('notes', '')}"
            )
        )
    return jsonify(ok=True, data={"text": text})


@ai_bp.post("/ai/flashcards")
@ai_errors("Flashcard creation")
def flashcards():
    data = request.get_json(silent=True) or {}
    topic = data.get("topic") or {}
    if not topic.get("name"):
        return _error("Topic not found.", 404)
    api_key = _api_key()
    if not api_key:
        return _error("Add a key to create flashcards.", 503)
    with provider_lock:
        provider = get_provider(api_key, _ai_model())
        result = asyncio.run(
            provider.complete_json(
                FLASHCARDS_PROMPT,
                f"Topic: {topic['name']}\nNotes: {topic.get('notes', '')}",
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
    lines = [f"Subject: {str(raw['name']).strip()[:120]}"]
    known = set()
    for unit in raw.get("units") or []:
        if not isinstance(unit, dict):
            continue
        lines.append(f"\nUnit: {str(unit.get('name', '')).strip()[:200]}")
        for topic in unit.get("topics") or []:
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
            subtopics = [str(item).strip()[:100] for item in (topic.get("subtopics") or [])[:8]]
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
    if not known:
        raise ValueError("This subject has no topics to analyze yet.")
    return "\n".join(lines), known


@ai_bp.post("/ai/important")
@ai_errors("Important-topic analysis")
def important_topics():
    api_key = _api_key()
    if not api_key:
        return _error("Add your API key in Settings to find important topics.", 503)
    data = request.get_json(silent=True) or {}
    outline, known_ids = _clean_subject(data.get("subject"))
    prompt_input = f"BEGIN SYLLABUS DATA\n{outline}\nEND SYLLABUS DATA"
    with provider_lock:
        provider = get_provider(api_key, _ai_model())
        result = asyncio.run(provider.complete_json(IMPORTANCE_PROMPT, prompt_input, ImportanceResult))
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
