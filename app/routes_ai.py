import asyncio
import json
import logging
import threading
from datetime import date

from flask import Blueprint, jsonify, request

from .ai_parser import Extraction
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
provider_lock = threading.Lock()


def _error(message, status=400):
    return jsonify(ok=False, error=message), status


def _api_key():
    return request.headers.get("X-Gemini-Api-Key", "").strip()


@ai_bp.post("/upload")
def upload():
    api_key = _api_key()
    if not api_key:
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

        with provider_lock:
            provider = get_provider(api_key)
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
        logger.exception("Gemini syllabus extraction failed: %s", error)
        return _error(str(error), 503)
    except Exception:
        logger.exception("Unexpected error during syllabus extraction")
        return _error("Syllabus extraction failed. Check the file and Gemini API key.", 503)


@ai_bp.post("/ai/quickadd")
def quickadd():
    api_key = _api_key()
    if not api_key:
        return _error("Add your Gemini API key in Settings to use quick add.", 503)
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return _error("Describe the task or exam you want to add.")
    subjects = data.get("subjects", [])
    prompt = QUICKADD_PROMPT.replace("{TODAY_ISO}", date.today().isoformat()).replace(
        "{SUBJECTS}", json.dumps(subjects)
    )
    try:
        with provider_lock:
            provider = get_provider(api_key)
            result = asyncio.run(provider.complete_json(prompt, text, None))
        return jsonify(ok=True, data=result)
    except AIProviderError as error:
        return _error(str(error), 503)


@ai_bp.post("/ai/explain")
def explain():
    data = request.get_json(silent=True) or {}
    topic = data.get("topic") or {}
    if not topic.get("name"):
        return _error("Topic not found.", 404)
    api_key = _api_key()
    if not api_key:
        return _error("Add a key to use topic explanations.", 503)
    try:
        with provider_lock:
            provider = get_provider(api_key)
            text = asyncio.run(
                provider.complete_text(
                    EXPLAIN_PROMPT, f"Topic: {topic['name']}\nNotes: {topic.get('notes', '')}"
                )
            )
        return jsonify(ok=True, data={"text": text})
    except AIProviderError as error:
        return _error(str(error), 503)


@ai_bp.post("/ai/flashcards")
def flashcards():
    data = request.get_json(silent=True) or {}
    topic = data.get("topic") or {}
    if not topic.get("name"):
        return _error("Topic not found.", 404)
    api_key = _api_key()
    if not api_key:
        return _error("Add a key to create flashcards.", 503)
    try:
        with provider_lock:
            provider = get_provider(api_key)
            result = asyncio.run(
                provider.complete_json(
                    FLASHCARDS_PROMPT,
                    f"Topic: {topic['name']}\nNotes: {topic.get('notes', '')}",
                    None,
                )
            )
        cards = result.get("cards", []) if isinstance(result, dict) else []
        if not cards:
            return _error("Gemini returned no flashcards. Add notes and try again.", 503)
        return jsonify(ok=True, data=cards)
    except AIProviderError as error:
        return _error(str(error), 503)
