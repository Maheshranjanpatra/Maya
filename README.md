# Maya — Study Tracker

Maya is a local-first study and priority tracker for university students.
It turns syllabus material into topics, plans study tasks, and tracks progress.

## Setup
1. Install Python 3.11 or newer.
2. Create and activate a virtual environment: `python -m venv .venv`.
3. Install packages: `pip install -r requirements.txt`.
4. Copy `.env.example` to `.env`.
5. Add either `GEMINI_API_KEY` or `GROQ_API_KEY`; both have free tiers and auto-detection supports either single key.
6. Run `python run.py` and open `http://localhost:8000`.

## Troubleshooting
- No AI key: add a Gemini or Groq key; manual subject/task features remain available.
- OCR fails: install Tesseract and Poppler on your operating system.
- Port in use: set `PORT=8001` before running.
- Reset database: stop Maya and remove `data/maya.db`.
