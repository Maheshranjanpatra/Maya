from io import BytesIO


SUPPORTED_TYPES = {
    "txt": "text/plain",
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
}


def extract_upload(filename, data):
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    mime_type = SUPPORTED_TYPES.get(extension)
    if not mime_type:
        raise ValueError("Supported files: PDF, DOCX, TXT, JPG and PNG.")

    if extension == "txt":
        return data.decode("utf-8", errors="replace"), None, None
    if extension == "docx":
        from docx import Document

        document = Document(BytesIO(data))
        return "\n".join(paragraph.text for paragraph in document.paragraphs), None, None
    if extension == "pdf":
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(data))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        if text.strip():
            return text, None, None

    return "", data, mime_type


def extract_text(filename, data, provider=None):
    text, media, _ = extract_upload(filename, data)
    if media:
        raise ValueError("This file requires Gemini vision; use extract_upload.")
    return text
