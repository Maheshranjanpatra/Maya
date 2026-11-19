import { api } from '../api.js';
import { showSheet, escapeHTML } from '../components/dom.js';
import { applyTheme } from '../components/theme.js';
import { toast } from '../components/toast.js';
import { IDB } from '../idb.js';
import { ICONS } from '../components/icons.js';

const weekdays = [
  ['Monday', 0], ['Tuesday', 1], ['Wednesday', 2], ['Thursday', 3],
  ['Friday', 4], ['Saturday', 5], ['Sunday', 6]
];

export async function render(container) {
  container.innerHTML = `
    <header class="view-heading"><div><p class="eyebrow">Make Maya yours</p><h1>Settings</h1><p>Your study week, privacy, and local backups.</p></div></header>
    <div class="view-stack">
      <article class="card"><p class="eyebrow">Planning</p><h2>Daily capacity</h2>
        <div class="form-grid"><label>Study time per day (minutes)<input id="capacity" type="number" min="15" max="720" step="15"></label>
          <label>Theme<select id="theme"><option value="auto">Auto (system)</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <fieldset class="span-2 study-days"><legend>Study days</legend><div class="study-day-grid">${weekdays.map(([label, day]) => `<label><input type="checkbox" value="${day}" data-study-day><span>${label}</span></label>`).join('')}</div></fieldset>
          <label>Weekly study goal (hours)<input id="weekly-goal" type="number" min="1" max="40"></label>
          <label>Daily task goal<input id="daily-goal" type="number" min="1" max="20"></label>
        </div>
        <div class="split-actions"><button class="button" id="save-planning">Save planning</button><button class="button button-quiet" id="replan">Rebuild my plan</button></div>
      </article>
      <article class="card"><p class="eyebrow">Time off</p><h2>Blackout dates</h2><p class="muted">Maya leaves these days open when scheduling study tasks.</p>
        <form id="blackout-form" class="field-row"><label>Date<input type="date" name="date" required></label><label>Reason (optional)<input name="reason" maxlength="200"></label><button class="button">Add day</button></form>
        <div id="blackout-list" class="view-stack"></div>
      </article>
      <article class="card"><p class="eyebrow">AI tools</p><h2>AI settings</h2><p class="muted" id="ai-status"></p>
        <div class="api-key-setting"><label for="ai-key">API key</label><div class="api-key-field"><input id="ai-key" type="password" autocomplete="off" placeholder="Paste your API key"><button class="icon-button" id="toggle-ai-key" type="button" aria-label="Show API key" aria-pressed="false">${ICONS.eye}</button></div></div>
        <label>Model
          <select id="ai-model">
            <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
            <option value="gemini-3.8-flash">Gemini 3.8 Flash</option>
            <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite</option>
            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
            <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite</option>
            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
          </select>
        </label>
        <label class="inline-check"><input id="clear-ai-key" type="checkbox">Remove the saved key</label>
        <p class="hint">Use a key from Google AI Studio. Model availability and usage limits depend on your provider account.</p>
        <p><a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Get an API key from Google AI Studio</a></p>
      </article>
      <article class="card"><p class="eyebrow">Your data stays yours</p><h2>Export and backup</h2><p class="muted">Download a calendar file or a complete JSON backup. Restoring replaces Maya's study data on this device.</p>
        <div class="split-actions"><button class="button button-quiet" id="export-ics">Export calendar (.ics)</button><button class="button button-quiet" id="export-backup">Download JSON backup</button></div>
        <label>Restore from a Maya backup<input id="restore-file" type="file" accept="application/json,.json"></label>
      </article>
      <article class="card"><p class="eyebrow">About</p><h2>Maya is local-first</h2><p class="muted">Your study data and settings are stored in this browser on this device. They are not uploaded or synced. Only content you submit for an AI action is sent to Google using your key, and AI responses are not saved on Maya's server.</p></article>
    </div>`;
  try {
    const [result, blackouts] = await Promise.all([api('/api/settings'), api('/api/blackouts')]);
    fillSettings(container, result.settings);
    const storedSettings = await IDB.get('settings', 1);
    container.querySelector('#ai-key').value = storedSettings?.ai_api_key || storedSettings?.gemini_api_key || '';
    container.querySelector('#ai-model').value = storedSettings?.ai_model || 'gemini-3.6-flash';
    container.querySelector('#ai-status').textContent = result.api_key_set
      ? 'Your API key is saved in this browser and will be reused automatically.'
      : 'Add an API key to enable extraction, explanations, flashcards, and natural-language quick add. It will be saved in this browser.';
    drawBlackouts(container, blackouts);
    bindSettings(container);
  } catch (error) {
    toast(error.message);
  }
}

function fillSettings(container, settings) {
  container.querySelector('#capacity').value = settings.daily_capacity_minutes;
  container.querySelector('#theme').value = settings.theme || 'auto';
  container.querySelector('#daily-goal').value = settings.daily_goal || 3;
  container.querySelector('#weekly-goal').value = settings.weekly_goal || 5;
  const days = new Set(settings.study_days || []);
  container.querySelectorAll('[data-study-day]').forEach(input => {
    input.checked = days.has(Number(input.value));
  });
}

function drawBlackouts(container, blackouts) {
  const list = container.querySelector('#blackout-list');
  list.innerHTML = blackouts.map(item => `
    <div class="row"><span><strong>${escapeHTML(item.date)}</strong>${item.reason ? ` · ${escapeHTML(item.reason)}` : ''}</span><button class="small-action" data-remove-blackout="${item.id}">Remove</button></div>
  `).join('') || '<p class="muted">No blackout dates yet.</p>';
  list.querySelectorAll('[data-remove-blackout]').forEach(button => button.onclick = async () => {
    try {
      await api(`/api/blackouts/${button.dataset.removeBlackout}`, { method: 'DELETE' });
      await reloadBlackouts(container);
    } catch (error) { toast(error.message); }
  });
}

async function reloadBlackouts(container) {
  drawBlackouts(container, await api('/api/blackouts'));
}

function bindSettings(container) {
  container.querySelector('#theme').addEventListener('change', event => setTheme(event.target.value));
  container.querySelector('#save-planning').onclick = async () => {
    const data = {
      daily_capacity_minutes: Number(container.querySelector('#capacity').value),
      theme: container.querySelector('#theme').value,
      daily_goal: Number(container.querySelector('#daily-goal').value),
      weekly_goal: Number(container.querySelector('#weekly-goal').value),
      study_days: [...container.querySelectorAll('[data-study-day]:checked')].map(input => Number(input.value))
    };
    try {
      await api('/api/settings', { method: 'PATCH', body: JSON.stringify(data) });
      await api('/api/plan/replan', { method: 'POST', body: '{}' });
      toast('Planning settings saved.');
    } catch (error) { toast(error.message); }
  };
  container.querySelector('#replan').onclick = async () => {
    try {
      const result = await api('/api/plan/replan', { method: 'POST', body: '{}' });
      toast(result.explanation || (result.moved ? `${result.moved} tasks moved forward.` : 'Your plan is up to date.'));
    } catch (error) { toast(error.message); }
  };
  container.querySelector('#blackout-form').addEventListener('submit', async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api('/api/blackouts', { method: 'POST', body: JSON.stringify(data) });
      event.currentTarget.reset();
      await reloadBlackouts(container);
    } catch (error) { toast(error.message); }
  });

  container.querySelector('#export-ics').onclick = () => download('/api/export/ics', 'maya.ics');
  container.querySelector('#export-backup').onclick = () => download('/api/export/backup', 'maya-backup.json');
  container.querySelector('#restore-file').addEventListener('change', event => restoreBackup(event, container));
  const keyInput = container.querySelector('#ai-key');
  const keyToggle = container.querySelector('#toggle-ai-key');
  keyToggle.addEventListener('click', () => {
    const visible = keyInput.type === 'password';
    keyInput.type = visible ? 'text' : 'password';
    keyToggle.innerHTML = visible ? ICONS.eyeOff : ICONS.eye;
    keyToggle.setAttribute('aria-label', visible ? 'Hide API key' : 'Show API key');
    keyToggle.setAttribute('aria-pressed', String(visible));
  });
  keyInput.form?.addEventListener('submit', event => event.preventDefault());
  keyInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') saveSecrets(container);
  });
  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'button';
  saveButton.textContent = 'Save AI settings';
  saveButton.id = 'save-keys';
  container.querySelector('#ai-key').closest('.card').append(saveButton);
  saveButton.onclick = () => saveSecrets(container);
}

function setTheme(theme) {
  applyTheme(theme);
}

async function saveSecrets(container) {
  const apiKey = container.querySelector('#ai-key').value.trim();
  const removeKey = container.querySelector('#clear-ai-key').checked;
  const data = { ai_model: container.querySelector('#ai-model').value };
  if (apiKey || removeKey) {
    data.ai_api_key = removeKey ? '' : apiKey;
    data.gemini_api_key = '';
  }
  try {
    await api('/api/settings', { method: 'PATCH', body: JSON.stringify(data) });
    container.querySelector('#clear-ai-key').checked = false;
    if (removeKey) {
      container.querySelector('#ai-key').value = '';
      container.querySelector('#ai-key').type = 'password';
      const toggle = container.querySelector('#toggle-ai-key');
      toggle.innerHTML = ICONS.eye;
      toggle.setAttribute('aria-label', 'Show API key');
      toggle.setAttribute('aria-pressed', 'false');
    }
    const savedKey = apiKey || (!removeKey
      && container.querySelector('#ai-status').textContent.includes('saved'));
    container.querySelector('#ai-status').textContent = removeKey
      ? 'API key removed from this browser.'
      : savedKey
        ? 'Your API key is saved in this browser and will be reused automatically.'
        : 'Model saved. Add an API key to enable AI tools.';
    toast('AI settings saved on this device.');
    window.dispatchEvent(new CustomEvent('maya:refresh'));
  } catch (error) { toast(error.message); }
}

async function download(url, filename) {
  try {
    const blob = url.endsWith('/ics')
      ? await makeCalendar()
      : new Blob([JSON.stringify(await api('/api/export/backup'), null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  } catch (error) { toast(error.message); }
}

async function makeCalendar() {
  const [tasks, exams] = await Promise.all([
    api('/api/tasks/all'),
    api('/api/exams')
  ]);
  const escape = value => String(value || '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
  const events = [
    ...tasks.flatMap(task => {
      const chunks = Array.isArray(task.schedule_chunks) ? task.schedule_chunks : [];
      if (chunks.length) {
        return chunks.map((chunk, index) => ({
          date: chunk.date.replaceAll('-', ''),
          title: chunks.length > 1 ? `${task.title} (Part ${index + 1} of ${chunks.length})` : task.title,
          description: `${task.subject_name} · ${chunk.minutes} minutes`
        }));
      }
      return task.scheduled_date ? [{
        date: task.scheduled_date.replaceAll('-', ''),
        title: task.title,
        description: `${task.subject_name} · ${task.est_minutes} minutes`
      }] : [];
    }),
    ...exams.map(exam => ({
      date: exam.exam_date.replaceAll('-', ''),
      title: `${exam.subject_name} ${exam.exam_type}`,
      description: `${exam.weightage}% weight`
    }))
  ];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Maya//Study Planner//EN'];
  for (const [index, item] of events.entries()) {
    lines.push('BEGIN:VEVENT', `UID:maya-${index}-${item.date}@local`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`, `DTSTART;VALUE=DATE:${item.date}`, `SUMMARY:${escape(item.title)}`, `DESCRIPTION:${escape(item.description)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Blob([lines.join('\r\n')], { type: 'text/calendar' });
}

async function restoreBackup(event, container) {
  const file = event.target.files[0];
  if (!file) return;
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    toast('This file is not valid JSON.');
    event.target.value = '';
    return;
  }
  const sheet = showSheet(`<div class="sheet-handle" aria-hidden="true"></div><h2>Replace local study data?</h2><p class="muted">This restores the selected Maya backup over the current study data on this device. Your Gemini key stays unchanged.</p><div class="sheet-actions"><button class="button button-quiet" data-close-sheet>Cancel</button><button class="button button-danger" id="confirm-restore">Restore backup</button></div>`);
  sheet.root.querySelector('#confirm-restore').onclick = async () => {
    try {
      await api('/api/import/backup', { method: 'POST', body: JSON.stringify(backup) });
      sheet.close();
      toast('Backup restored.');
      window.dispatchEvent(new CustomEvent('maya:refresh'));
    } catch (error) { toast(error.message); }
    finally { event.target.value = ''; }
  };
}
