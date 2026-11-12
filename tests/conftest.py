import pytest

from app import create_app


@pytest.fixture
def maya():
    app = create_app({"TESTING": True})
    return app, app.test_client()
