def test_app_serves_without_creating_a_database(maya, tmp_path):
    app, client = maya

    assert client.get("/").status_code == 200
    assert client.get("/api/subjects").status_code == 404
    assert "DATABASE_PATH" not in app.config


def test_ai_endpoint_requires_a_user_provided_key(maya):
    _, client = maya

    response = client.post("/api/upload", data={"pasted_text": "Unit one: cells"})

    assert response.status_code == 503
    assert "Gemini API key" in response.get_json()["error"]
