from io import BytesIO

import pytest
from PIL import Image

from app.utils.extract_text import extract_upload


def test_text_upload_requires_utf8():
    with pytest.raises(ValueError, match="UTF-8"):
        extract_upload("notes.txt", b"\xff\xfe")


def test_pdf_upload_requires_pdf_signature():
    with pytest.raises(ValueError, match="PDF file is invalid"):
        extract_upload("notes.pdf", b"not a PDF")


def test_docx_upload_requires_valid_office_archive():
    with pytest.raises(ValueError, match="DOCX file is invalid"):
        extract_upload("notes.docx", b"not a DOCX")


def test_image_extension_must_match_image_content():
    data = BytesIO()
    Image.new("RGB", (1, 1)).save(data, format="PNG")

    with pytest.raises(ValueError, match="extension does not match"):
        extract_upload("image.jpg", data.getvalue())


def test_valid_image_is_returned_with_verified_mime_type():
    data = BytesIO()
    Image.new("RGB", (1, 1)).save(data, format="PNG")

    text, media, mime_type = extract_upload("image.png", data.getvalue())

    assert text == ""
    assert media == data.getvalue()
    assert mime_type == "image/png"
