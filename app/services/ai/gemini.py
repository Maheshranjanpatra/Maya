import asyncio
import json
import re
import time

from pydantic import ValidationError

from .base import AIProvider, AIProviderError

MAX_RETRIES = 2
RETRY_DELAYS_SECONDS = (0.25, 0.5)


def _is_transient(error):
    status = getattr(error, "status_code", None) or getattr(error, "code", None)
    if status in {429, 500, 502, 503, 504}:
        return True
    detail = str(error).lower()
    return any(
        marker in detail
        for marker in (
            "429",
            "500",
            "502",
            "503",
            "504",
            "resource_exhausted",
            "temporarily unavailable",
            "service unavailable",
        )
    )


def _request_error(error):
    detail = " ".join(str(error).split())
    lowered = detail.lower()
    if any(value in lowered for value in ("429", "resource_exhausted", "quota")):
        message = (
            "The selected model's API quota or rate limit was reached. "
            "Check your provider's usage limits or try again later."
        )
    elif any(
        value in lowered
        for value in ("401", "403", "api_key_invalid", "api key not valid")
    ):
        message = (
            "The AI provider rejected this API key or its permissions. "
            "Check that the key is valid and enabled for the selected model."
        )
    elif any(value in lowered for value in ("404", "not_found", "model not found")):
        message = (
            "The selected model was not found or is unavailable to this API key. "
            "Choose another model in Settings."
        )
    elif (
        "timed out" in lowered
        or "deadline exceeded" in lowered
        or "request timeout" in lowered
        or error.__class__.__name__.lower() in {"timeout", "timeoutexception", "readtimeout", "connecttimeout"}
    ):
        message = "The AI request timed out. Try again."
    else:
        detail = re.sub(r"AIza[0-9A-Za-z_-]{20,}", "[redacted API key]", detail)
        detail = re.sub(r"(?i)(key=)[^&\s]+", r"\1[redacted]", detail)
        message = "AI provider request failed. Check the API key and selected model."
        if detail:
            message += f" Details: {detail[:240]}"
    return AIProviderError(message)


class GeminiProvider(AIProvider):
    name = "Gemini"
    supports_vision = True

    def __init__(self, key, model, timeout=60):
        import google.generativeai as genai

        genai.configure(api_key=key)
        self.model = genai.GenerativeModel(model)
        self.timeout = max(1, int(timeout))

    async def _generate(self, prompt, media_bytes=None, media_mime_type=None, json_mode=False):
        def call():
            parts = [prompt]
            if media_bytes:
                parts.append(
                    {
                        "mime_type": media_mime_type or "application/octet-stream",
                        "data": media_bytes,
                    }
                )
            config = (
                {"response_mime_type": "application/json", "temperature": 0.1}
                if json_mode
                else None
            )
            for attempt in range(MAX_RETRIES + 1):
                try:
                    response = self.model.generate_content(
                        parts,
                        generation_config=config,
                        request_options={"timeout": self.timeout},
                    )
                    if not response.text:
                        raise AIProviderError("Gemini returned an empty response.")
                    return response.text
                except AIProviderError:
                    raise
                except Exception as error:
                    if attempt == MAX_RETRIES or not _is_transient(error):
                        raise
                    time.sleep(RETRY_DELAYS_SECONDS[attempt])

        return await asyncio.to_thread(call)

    async def complete_json(
        self,
        system,
        user,
        schema,
        image_bytes=None,
        image_mime_type=None,
    ):
        try:
            raw = await self._generate(
                f"{system}\n{user}",
                image_bytes,
                image_mime_type,
                json_mode=True,
            )
        except AIProviderError:
            raise
        except Exception as error:
            raise _request_error(error) from error

        try:
            data = json.loads(raw)
            return schema.model_validate(data) if schema else data
        except (json.JSONDecodeError, ValidationError) as error:
            raise AIProviderError(
                "Gemini returned data that did not match the expected JSON structure. "
                "Try clearer input or a sharper scan."
            ) from error

    async def complete_text(
        self, system, user, image_bytes=None, image_mime_type=None
    ):
        try:
            return await self._generate(
                f"{system}\n{user}", image_bytes, image_mime_type
            )
        except AIProviderError:
            raise
        except Exception as error:
            raise _request_error(error) from error
