DEFAULT_MODEL = "gemini-3.6-flash"


def get_provider(key, model=DEFAULT_MODEL, timeout=60):
    key = (key or "").strip()
    if not key:
        return None

    from .gemini import GeminiProvider

    return GeminiProvider(key, model or DEFAULT_MODEL, timeout=timeout)
