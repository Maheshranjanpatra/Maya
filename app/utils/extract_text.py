from io import BytesIO
from zipfile import BadZipFile, ZipFile

from PIL import Image, UnidentifiedImageError

SUPPORTED_TYPES = {
    "txt": "text/plain",
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
}
MAX_EXTRACTED_TEXT_CHARS = 250_000
MAX_PDF_PAGES = 200
MAX_DOCX_ENTRIES = 2_000
MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000


def extract_upload(filename, data):
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    mime_type = SUPPORTED_TYPES.get(extension)
    if not mime_type:
        raise ValueError("Supported files: PDF, DOCX, TXT, JPG and PNG.")
    if not data:
        raise ValueError("The selected file is empty.")

    if extension == "txt":
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError("Text files must use UTF-8 encoding.") from error
        if "\0" in text:
            raise ValueError("The selected text file contains invalid binary data.")
        if len(text) > MAX_EXTRACTED_TEXT_CHARS:
            raise ValueError("Text files must contain 250,000 characters or fewer.")
        return text, None, None
    if extension == "docx":
        from docx import Document

        try:
            with ZipFile(BytesIO(data)) as archive:
                entries = archive.infolist()
                if (
                    len(entries) > MAX_DOCX_ENTRIES
                    or sum(entry.file_size for entry in entries) > MAX_DOCX_UNCOMPRESSED_BYTES
                    or "[Content_Types].xml" not in archive.namelist()
                    or "word/document.xml" not in archive.namelist()
                    or archive.testzip() is not None
                ):
                    raise ValueError("The DOCX file is invalid or too large to process.")
            document = Document(BytesIO(data))
        except (BadZipFile, KeyError, OSError) as error:
            raise ValueError("The selected DOCX file is invalid or damaged.") from error
        paragraphs = []
        size = 0
        for paragraph in document.paragraphs:
            size += len(paragraph.text)
            if size > MAX_EXTRACTED_TEXT_CHARS:
                raise ValueError("DOCX files must contain 250,000 characters or fewer.")
            paragraphs.append(paragraph.text)
        return "\n".join(paragraphs), None, None
    if extension == "pdf":
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError

        if not data.startswith(b"%PDF-"):
            raise ValueError("The selected PDF file is invalid or damaged.")
        try:
            reader = PdfReader(BytesIO(data))
            if len(reader.pages) > MAX_PDF_PAGES:
                raise ValueError("PDF files must contain 200 pages or fewer.")
            paragraphs = []
            size = 0
            for page in reader.pages:
                page_text = page.extract_text() or ""
                size += len(page_text)
                if size > MAX_EXTRACTED_TEXT_CHARS:
                    raise ValueError("PDF files must contain 250,000 extracted characters or fewer.")
                paragraphs.append(page_text)
            text = "\n".join(paragraphs)
        except (PdfReadError, OSError) as error:
            raise ValueError("The selected PDF file is invalid or damaged.") from error
        if text.strip():
            return text, None, None

    if extension in {"jpg", "jpeg", "png"}:
        expected_format = "PNG" if extension == "png" else "JPEG"
        try:
            with Image.open(BytesIO(data)) as image:
                if image.format != expected_format:
                    raise ValueError("The file extension does not match the image content.")
                if image.width * image.height > MAX_IMAGE_PIXELS:
                    raise ValueError("Images must be 25 megapixels or smaller.")
                image.verify()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
            raise ValueError("The selected image is invalid or too large to process.") from error
    return "", data, mime_type


def extract_text(filename, data, provider=None):
    text, media, _ = extract_upload(filename, data)
    if media:
        raise ValueError("This file requires Gemini vision; use extract_upload.")
    return text
