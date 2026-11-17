from io import BytesIO

import pytest
from pydantic import ValidationError

from app import create_app
from app.ai_parser import Extraction, ImportanceResult
from app.ics_export import calendar_text
from app.utils.extract_text import extract_upload


@pytest.fixture()
def app():
    application = create_app({"TESTING": True, "MAX_CONTENT_LENGTH": 1024})
    yield application


@pytest.fixture()
def client(app):
    return app.test_client()


def test_home_page_serves_application_shell(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"Maya" in response.data
    assert b"/static/js/app.js" in response.data


def test_service_worker_is_served_from_root_scope(client):
    response = client.get("/service-worker.js")
    assert response.status_code == 200
    assert response.headers["Service-Worker-Allowed"] == "/"
    assert b"addEventListener('fetch'" in response.data


def test_upload_without_api_key_is_rejected(client):
    response = client.post("/api/upload")
    assert response.status_code == 503
    assert response.is_json
    assert response.json["ok"] is False
    assert "API key" in response.json["error"]


def test_quickadd_without_api_key_is_rejected(client):
    response = client.post("/api/ai/quickadd", json={"text": "Study calculus"})
    assert response.status_code == 503
    assert response.json["ok"] is False


def test_explain_requires_a_topic_before_provider_call(client):
    response = client.post("/api/ai/explain", json={}, headers={"X-AI-Api-Key": "test"})
    assert response.status_code == 404
    assert response.json["ok"] is False


def test_flashcards_requires_a_topic_before_provider_call(client):
    response = client.post("/api/ai/flashcards", json={}, headers={"X-AI-Api-Key": "test"})
    assert response.status_code == 404
    assert response.json["ok"] is False


def test_important_topics_without_api_key_is_rejected(client):
    response = client.post("/api/ai/important", json={"subject": {"name": "Maths"}})
    assert response.status_code == 503
    assert response.json["ok"] is False


def test_unsupported_upload_extension_returns_json_error(client):
    response = client.post(
        "/api/upload",
        headers={"X-AI-Api-Key": "test"},
        data={"file": (BytesIO(b"payload"), "syllabus.exe")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.is_json
    assert "Supported files" in response.json["error"]


def test_upload_size_limit_returns_json_413(app):
    app.config["MAX_CONTENT_LENGTH"] = 32
    response = app.test_client().post(
        "/api/upload",
        data={"file": (BytesIO(b"x" * 256), "syllabus.txt")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 413
    assert response.is_json
    assert response.json["ok"] is False


def test_text_upload_extracts_utf8_text():
    text, media, mime = extract_upload("syllabus.TXT", "Calculus — limits".encode())
    assert text == "Calculus — limits"
    assert media is None
    assert mime is None


def test_text_upload_replaces_invalid_utf8_instead_of_crashing():
    text, media, mime = extract_upload("notes.txt", b"valid\xfftext")
    assert "valid" in text and "text" in text
    assert media is None
    assert mime is None


def test_unknown_extension_is_rejected():
    with pytest.raises(ValueError, match="Supported files"):
        extract_upload("syllabus.doc", b"not a docx")


def test_extraction_schema_rejects_empty_subject_list():
    with pytest.raises(ValidationError):
        Extraction.model_validate({"subjects": []})


def test_extraction_schema_rejects_invalid_topic_difficulty():
    payload = {
        "subjects": [{
            "name": "Mathematics",
            "units": [{
                "name": "Calculus",
                "topics": [{"name": "Limits", "difficulty": 9}]
            }]
        }]
    }
    with pytest.raises(ValidationError):
        Extraction.model_validate(payload)


def test_importance_schema_rejects_out_of_range_score():
    with pytest.raises(ValidationError):
        ImportanceResult.model_validate({"topics": [{"topic_id": 1, "score": 8}]})


def test_ics_export_includes_only_scheduled_tasks_and_exams():
    output = calendar_text(
        [
            {"id": 1, "title": "Read limits", "scheduled_date": "2026-11-20"},
            {"id": 2, "title": "Unscheduled", "scheduled_date": None},
        ],
        [{"id": 3, "exam_date": "2026-11-25", "subject_name": "Maths", "exam_type": "final"}],
    )
    assert "UID:maya-task-1@local" in output
    assert "UID:maya-task-2@local" not in output
    assert "UID:maya-exam-3@local" in output
    assert "DTSTART;VALUE=DATE:20261120" in output
    assert output.endswith("END:VCALENDAR\r\n")


def test_ics_export_escapes_ical_text_delimiters():
    output = calendar_text(
        [{"id": 7, "title": "Limits, continuity;\nrevision", "scheduled_date": "2026-11-20"}]
    )
    assert r"SUMMARY:Limits\, continuity\;\nrevision" in output
