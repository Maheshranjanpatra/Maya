import asyncio
from types import SimpleNamespace


def test_app_serves_without_creating_a_database(maya, tmp_path):
    app, client = maya

    assert client.get("/").status_code == 200
    assert client.get("/api/subjects").status_code == 404
    assert "DATABASE_PATH" not in app.config


def test_ai_endpoint_requires_a_user_provided_key(maya):
    _, client = maya

    response = client.post("/api/upload", data={"pasted_text": "Unit one: cells"})

    assert response.status_code == 503
    assert "API key" in response.get_json()["error"]


def test_upload_uses_the_generic_api_key_and_selected_model(maya, monkeypatch):
    _, client = maya
    requested = {}

    class Provider:
        async def complete_json(self, *_args, **_kwargs):
            return SimpleNamespace(model_dump=lambda: {"subjects": []}, warnings=[])

    def get_provider(key, model, timeout):
        requested.update(key=key, model=model, timeout=timeout)
        return Provider()

    monkeypatch.setattr("app.routes_ai.get_provider", get_provider)
    response = client.post(
        "/api/upload",
        headers={"X-AI-Api-Key": "test-key", "X-AI-Model": "gemini-2.5-flash"},
        data={"pasted_text": "Unit one: cells"},
    )

    assert response.status_code == 200
    assert requested == {"key": "test-key", "model": "gemini-2.5-flash", "timeout": 60}


def test_upload_rejects_oversized_pasted_text_before_calling_provider(maya, monkeypatch):
    app, client = maya
    app.config["MAX_PASTED_TEXT_CHARS"] = 3
    monkeypatch.setattr(
        "app.routes_ai.get_provider",
        lambda *_args: (_ for _ in ()).throw(AssertionError("Provider should not be called")),
    )

    response = client.post(
        "/api/upload",
        headers={"X-AI-Api-Key": "test-key"},
        data={"pasted_text": "too long"},
    )

    assert response.status_code == 400
    assert "3 characters or fewer" in response.get_json()["error"]


def test_ai_requests_are_rate_limited_per_client(maya, monkeypatch):
    app, client = maya
    app.config["AI_REQUESTS_PER_MINUTE"] = 1
    monkeypatch.setattr("app.routes_ai.request_times", {})

    first = client.post("/api/upload", data={"pasted_text": "Unit one"})
    second = client.post("/api/upload", data={"pasted_text": "Unit one"})

    assert first.status_code == 503
    assert second.status_code == 429


def test_ai_provider_call_times_out(maya, monkeypatch):
    app, client = maya
    app.config["AI_TIMEOUT_SECONDS"] = 1

    class Provider:
        async def complete_json(self, *_args, **_kwargs):
            await asyncio.Event().wait()

    monkeypatch.setattr("app.routes_ai.get_provider", lambda *_args, **_kwargs: Provider())

    response = client.post(
        "/api/upload",
        headers={"X-AI-Api-Key": "test-key"},
        data={"pasted_text": "Unit one: cells"},
    )

    assert response.status_code == 504
    assert "timed out" in response.get_json()["error"]
