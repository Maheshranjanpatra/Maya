import os


class Config:
    MAX_CONTENT_LENGTH = int(os.getenv("MAX_UPLOAD_MB", "20")) * 1024 * 1024
    HOST = os.getenv("MAYA_HOST", "127.0.0.1")
    SSL_CERT = os.getenv("MAYA_SSL_CERT")
    SSL_KEY = os.getenv("MAYA_SSL_KEY")
    AI_REQUESTS_PER_MINUTE = int(os.getenv("AI_REQUESTS_PER_MINUTE", "10"))
    AI_TIMEOUT_SECONDS = int(os.getenv("AI_TIMEOUT_SECONDS", "60"))
    MAX_PASTED_TEXT_CHARS = 150_000
    MAX_AI_INPUT_CHARS = 250_000
    MAX_AI_FILE_BYTES = 12 * 1024 * 1024
    MAX_EXPLAIN_NOTES_CHARS = 20_000
