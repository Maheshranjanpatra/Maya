# Maya - Study Tracker

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
plans, settings, progress, and the AI API key are stored in the browser's
IndexedDB on the device where Maya is opened. Set `PORT` to change the server
port or `MAX_UPLOAD_MB` to change the upload size limit. Maya listens on
`127.0.0.1` by default. To expose it on another host, set `MAYA_HOST` and
provide both `MAYA_SSL_CERT` and `MAYA_SSL_KEY`; remote access without TLS is
refused. Do not expose the development server directly to the public internet.

AI endpoints are limited to 10 requests per client per minute by default and
time out after 60 seconds. Temporary provider errors are retried up to twice.
Configure these limits with `AI_REQUESTS_PER_MINUTE` and `AI_TIMEOUT_SECONDS`.
Syllabus uploads are validated by their file content and capped at 12 MB; text
extracted or pasted for AI processing is size-limited.

## AI features

Maya uses Google's Gemini API for syllabus extraction, topic explanations,
flashcards, and natural-language quick add. Choose the model and add your API
key in **Settings**. The app works without a key; AI actions explain how to add
one when needed. The key is stored in this browser and sent with a request only
when you choose an AI action. Only the content needed for that action is sent
to Google; Maya's server does not save it. Model availability and usage limits
depend on your Google AI Studio project and selected model.

## Using Maya

1. Add subjects manually or upload a PDF, DOCX, JPG, or PNG syllabus, or paste
   syllabus text.
2. Review and edit the extracted draft, including confidence and prerequisite
   details, then confirm to save it.
3. Add exam dates, set daily study capacity and study days, and use Plan to
   review or reschedule the generated schedule. Longer tasks are split into
   daily sessions that stay within the configured capacity.
4. Complete tasks, start a 15-, 25-, 45-, or 60-minute focus session (or set a
   custom duration), and use spaced reviews. Ending an active focus session
   requires two confirmations; track progress in Visuals and Profile.
5. Use Settings to export an ICS calendar, back up Maya to JSON, or restore a
   backup.

The interface is an installable PWA. Its application shell is cached for
offline access, and study data remains in IndexedDB on that device. Browser
storage is tied to the app's origin and browser profile; clearing browser data
can erase it. Use Settings to download a JSON backup regularly or restore one
on this device. Maya does not sync data between devices. When a new app version
is deployed, Maya shows an update prompt; tap **Update** to reload the latest
version while keeping your study data on the device.

## Development checks

```bash
python -m pytest -q
python -m compileall -q app run.py
find app/static/js -type f -name '*.js' -print0 | xargs -0 -n1 node --check
node --experimental-default-type=module --test tests/test_local_api.mjs
```
