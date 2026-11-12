# Maya

Maya is a local-first study planner for university students. It turns a
syllabus into editable subjects, topics, and study tasks; schedules work around
exams; and tracks study progress without accounts or cloud storage.

## Run locally

Requires Python 3.10 or newer.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python run.py
```

Open [http://localhost:8000](http://localhost:8000). Maya stores its SQLite
database at `data/maya.db` by default. Set `DATABASE_PATH` to use another
location, `PORT` to change the server port, or `MAX_UPLOAD_MB` to change the
upload size limit.

## Gemini features

Maya uses Google's Gemini 2.0 Flash for syllabus extraction, topic
explanations, flashcards, and natural-language quick add. The app works without
an API key; AI actions explain how to add one when needed. Add a key in
**Settings**, or set `GEMINI_API_KEY` before starting Maya. The key is stored
locally and is never sent to another AI provider.

## Using Maya

1. Add subjects manually or upload a PDF, DOCX, JPG, or PNG syllabus, or paste
   syllabus text.
2. Review and edit the extracted draft, including confidence and prerequisite
   details, then confirm to save it.
3. Add exam dates, set daily study capacity and study days, and use Plan to
   review or reschedule the generated schedule.
4. Complete tasks, use focus sessions and spaced reviews, and track progress
   in Visuals and Profile.
5. Use Settings to export an ICS calendar, back up Maya to JSON, or restore a
   backup.

The interface is an installable PWA. Its application shell is cached for
offline access, and supported queued task changes sync when the app reconnects.
All study data remains in Maya's local SQLite database. A custom Web Lock key
can also be set in Settings to require the `X-Web-Lock-Key` header on API
requests.

## Development checks

```bash
python -m pytest -q
python -m compileall -q app run.py
find app/static/js -type f -name '*.js' -print0 | xargs -0 -n1 node --check
```
