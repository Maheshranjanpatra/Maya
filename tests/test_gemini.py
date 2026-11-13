import asyncio
from types import SimpleNamespace

import google.generativeai as genai
import pytest

from app.services.ai.base import AIProviderError
from app.services.ai.factory import get_provider
from app.services.ai.gemini import GeminiProvider


def test_provider_uses_supported_gemini_model(monkeypatch):
    models = []
    monkeypatch.setattr(genai, "configure", lambda **_kwargs: None)
    monkeypatch.setattr(
        genai,
        "GenerativeModel",
        lambda name: models.append(name) or SimpleNamespace(name=name),
    )

    provider = get_provider("test-key")

    assert provider.model.name == "gemini-3.6-flash"
    assert models == ["gemini-3.6-flash"]


def test_provider_uses_the_selected_model(monkeypatch):
    models = []
    monkeypatch.setattr(genai, "configure", lambda **_kwargs: None)
    monkeypatch.setattr(
        genai,
        "GenerativeModel",
        lambda name: models.append(name) or SimpleNamespace(name=name),
    )

    provider = get_provider("test-key", "gemini-2.5-flash")

    assert provider.model.name == "gemini-2.5-flash"
    assert models == ["gemini-2.5-flash"]


def test_json_request_failure_is_not_reported_as_invalid_syllabus():
    provider = object.__new__(GeminiProvider)

    async def fail_request(*_args, **_kwargs):
        raise RuntimeError("model endpoint unavailable")

    provider._generate = fail_request

    with pytest.raises(AIProviderError, match="AI provider request failed") as error:
        asyncio.run(provider.complete_json("prompt", "syllabus", None))

    assert isinstance(error.value.__cause__, RuntimeError)
    assert "model endpoint unavailable" in str(error.value)


@pytest.mark.parametrize(
    ("failure", "message"),
    [
        (RuntimeError("429 RESOURCE_EXHAUSTED quota"), "quota or rate limit"),
        (RuntimeError("404 model not found"), "selected model"),
        (RuntimeError("403 API_KEY_INVALID"), "rejected this API key"),
    ],
)
def test_request_failures_explain_common_provider_errors(failure, message):
    provider = object.__new__(GeminiProvider)

    async def fail_request(*_args, **_kwargs):
        raise failure

    provider._generate = fail_request

    with pytest.raises(AIProviderError, match=message):
        asyncio.run(provider.complete_json("prompt", "syllabus", None))


def test_invalid_json_has_a_response_format_error():
    provider = object.__new__(GeminiProvider)

    async def invalid_response(*_args, **_kwargs):
        return "not JSON"

    provider._generate = invalid_response

    with pytest.raises(AIProviderError, match="expected JSON structure"):
        asyncio.run(provider.complete_json("prompt", "syllabus", None))
