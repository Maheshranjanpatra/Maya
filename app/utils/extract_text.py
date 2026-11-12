import io
def extract_text(filename,data,provider=None):
    ext=filename.lower().rsplit('.',1)[-1]
    if ext=='txt':return data.decode('utf-8',errors='replace')
    if ext=='docx':
        from docx import Document
        doc=Document(io.BytesIO(data));return '\n'.join(p.text for p in doc.paragraphs)
    if ext=='pdf':
        from pypdf import PdfReader
        reader=PdfReader(io.BytesIO(data));text='\n'.join(p.extract_text() or '' for p in reader.pages)
        if len(text.strip())>=100:return text
        try:
            from pdf2image import convert_from_bytes
            import pytesseract
            return '\n'.join(pytesseract.image_to_string(im) for im in convert_from_bytes(data))
        except Exception as e:raise ValueError('Scanned PDF OCR needs Poppler and Tesseract: '+str(e))
    if ext in ('jpg','jpeg','png'):
        from PIL import Image
        import pytesseract
        return pytesseract.image_to_string(Image.open(io.BytesIO(data)))
    raise ValueError('Supported files: TXT, PDF, DOCX, JPG and PNG')
