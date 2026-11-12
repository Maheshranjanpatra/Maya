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

Open [http://localhost:8000](http://localhost:8000). Flask serves the app and
its optional AI endpoints; it does not store study records. Subjects, tasks,
plans, settings, progress, and the Gemini key are stored in the browser's
IndexedDB on the device where Maya is opened. Set `PORT` to change the server
port or `MAX_UPLOAD_MB` to change the upload size limit.

## Gemini features

Maya uses Google's Gemini 3.6 Flash for syllabus extraction, topic
explanations, flashcards, and natural-language quick add. The app works without
an API key; AI actions explain how to add one when needed. Add your key in
**Settings**. It is stored in this browser and sent with a request only when
you choose an AI action. Only the content needed for that action is sent to
Google Gemini; Maya's server does not save it.

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
offline access, and study data remains in IndexedDB on that device. Browser
storage is tied to the app's origin and browser profile; clearing browser data
can erase it. Use Settings to download a JSON backup regularly or restore one
on this device. Maya does not sync data between devices.

## Development checks

```bash
python -m pytest -q
python -m compileall -q app run.py
find app/static/js -type f -name '*.js' -print0 | xargs -0 -n1 node --check
```
