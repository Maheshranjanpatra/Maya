import asyncio
import json

from pydantic import ValidationError

from .base import AIProvider, AIProviderError


class GeminiProvider(AIProvider):
    name = "Gemini"
    supports_vision = True

    def __init__(self, key, model):
        import google.generativeai as genai

        genai.configure(api_key=key)
        self.model = genai.GenerativeModel(model)

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
            response = self.model.generate_content(
                parts, generation_config=config
            )
            if not response.text:
                raise AIProviderError("Gemini returned an empty response.")
            return response.text

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
            raise AIProviderError(
                "Gemini request failed. Check your API key, model access, and quota."
            ) from error

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
        except Exception as error:
            raise AIProviderError("Gemini request failed.") from error
