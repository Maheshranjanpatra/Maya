def get_provider(key):
    key = (key or "").strip()
    if not key:
        return None

    from .gemini import GeminiProvider

    return GeminiProvider(key, "gemini-2.0-flash")
