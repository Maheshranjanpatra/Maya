import { escapeHTML } from '../components/dom.js';

const sections = [
  ['Start with your syllabus', 'Open Syllabus and paste text or upload a PDF, DOCX, JPG, or PNG. Gemini creates a draft; edit the topics, confidence, marks, and prerequisites, then choose Confirm and save. Nothing is committed before that confirmation.'],
  ['Set an exam date', 'Add an exam with its type, date, weightage, and optional unit scope. Maya schedules pending tasks before the deadline and reserves a catch-up buffer.'],
  ['Work through today', 'Tasks are small study actions. Complete them for XP, use Focus for a task-linked Pomodoro, snooze or skip with a reason, and use the search and filters to find work.'],
  ['Stay on top of reviews', 'Completing a Read task creates revision tasks for one, three, and seven days later. The Reviews view also uses four recall grades to adjust future review intervals.'],
  ['Reschedule a plan', 'Open Plan and drag a task to another day. On touch screens, use the task’s Move button. A task that cannot fit remains visible instead of disappearing.'],
  ['Set up Gemini', 'Add your own Gemini API key in Settings. Maya uses Gemini 3.6 Flash for extraction, explanations, flashcards, and natural-language quick add. Without a key, all non-AI features still work.'],
  ['Offline and backup', 'Your study data is saved in this browser with IndexedDB, so planning, tasks, and progress remain available offline. Use Settings to export an ICS calendar or a full JSON backup.'],
  ['Keyboard shortcuts', 'Press Ctrl/Cmd+K to open the command palette. Keys 1–4 open Tasks, Syllabus, Visuals, and Profile when you are not typing in a field. Press Escape to close a sheet or palette.'],
  ['Privacy', 'Maya does not upload or sync study data. Your records stay in this browser on this device. When you request an AI action, only the content needed for that action is sent to Google Gemini using your key; Maya does not keep a server-side copy.']
];

export async function render(container) {
  container.innerHTML = `
    <header class="view-heading"><div><p class="eyebrow">A few helpful pointers</p><h1>Help</h1><p>How to get the most out of Maya.</p></div></header>
    <section class="view-stack">
      ${sections.map(([title, copy]) => `<details class="card help-item"><summary>${escapeHTML(title)}</summary><p class="muted">${escapeHTML(copy)}</p></details>`).join('')}
      <article class="card"><h2>Need to configure the app?</h2><p class="muted">Set study capacity, themes, and your Gemini key in Settings.</p><a class="button button-quiet" href="#/settings">Open Settings</a></article>
    </section>`;
}
