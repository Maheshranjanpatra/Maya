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

    def get_provider(key, model):
        requested.update(key=key, model=model)
        return Provider()

    monkeypatch.setattr("app.routes_ai.get_provider", get_provider)
    response = client.post(
        "/api/upload",
        headers={"X-AI-Api-Key": "test-key", "X-AI-Model": "gemini-2.5-flash"},
        data={"pasted_text": "Unit one: cells"},
    )

    assert response.status_code == 200
    assert requested == {"key": "test-key", "model": "gemini-2.5-flash"}
