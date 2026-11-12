import pytest

from app import create_app


@pytest.fixture
def maya(tmp_path, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    app = create_app(
        {
            "TESTING": True,
            "DATABASE_PATH": str(tmp_path / "maya-test.db"),
        }
    )
    return app, app.test_client()
