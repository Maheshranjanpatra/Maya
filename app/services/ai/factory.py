import os


def _api_key():
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if key:
        return key

    try:
        from ...db import one

        settings = one("SELECT gemini_api_key FROM settings WHERE id=1")
        return (settings or {}).get("gemini_api_key", "").strip()
    except RuntimeError:
        return ""


def available_providers():
    return ["Gemini"] if _api_key() else []


def get_provider():
    key = _api_key()
    if not key:
        return None

    from .gemini import GeminiProvider

    return GeminiProvider(key, "gemini-2.0-flash")
