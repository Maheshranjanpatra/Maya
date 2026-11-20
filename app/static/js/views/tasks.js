import { api } from '../api.js';
import { IDB } from '../idb.js';
import { queuedPatch, queuedRequest } from '../sync.js';
import { escapeHTML, showSheet } from '../components/dom.js';
import { toast } from '../components/toast.js';
import { formatTime, startTimer } from '../features/timer.js';
import { ICONS } from '../components/icons.js';

const TYPES = ['read', 'notes', 'practice', 'pastpaper', 'revise', 'mocktest', 'lab', 'assignment'];
let taskCache = [];
let subjectsCache = [];

const localDateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export async function render(container) {
  container.innerHTML = `
    <header class="view-heading">
      <div><p class="eyebrow">Today at a glance</p><h1>Study dashboard</h1><p>Start with what matters today, then take one small step at a time.</p></div>
      <button class="button" id="add-task"><span aria-hidden="true">+</span> Add task</button>
    </header>
    <section id="dashboard-summary" class="dashboard-summary" aria-label="Study dashboard"></section>
    <section class="view-stack">
      <div class="card timer-widget">
        <div><p class="eyebrow">Focus session</p><h2>Choose your focus time</h2><p class="muted">Pick a quick session or make one your own.</p></div>
        <div class="focus-quickstarts" aria-label="Quick-start focus sessions">
          <button type="button" class="button button-quiet" data-quick-focus="15">15 min</button>
          <button type="button" class="button button-quiet" data-quick-focus="25">25 min</button>
          <button type="button" class="button button-quiet" data-quick-focus="45">45 min</button>
          <button type="button" class="button button-quiet" data-quick-focus="60">60 min</button>
          <button type="button" class="button" id="start-focus">Custom</button>
        </div>
      </div>
      <div class="task-filters">
        <input class="search-field" id="task-search" type="search" placeholder="Search tasks or subjects" aria-label="Search tasks">
        <select id="task-filter" aria-label="Filter tasks">
          <option value="active">To do</option><option value="today">Today</option>
          <option value="overdue">Overdue</option><option value="done">Completed</option><option value="all">All tasks</option>
        </select>
        <select id="subject-filter" aria-label="Filter by subject"><option value="">All subjects</option></select>
      </div>
      <div id="bulk-toolbar" class="bulk-toolbar" hidden></div>
      <div id="task-list" class="task-list" aria-live="polite"></div>
    </section>`;

  container.querySelector('#add-task').addEventListener('click', () => openTaskForm());
  container.querySelector('#start-focus').addEventListener('click', () => openTimer(container));
  container.querySelectorAll('[data-quick-focus]').forEach(button => {
    button.addEventListener('click', () => openTimer(container, undefined, Number(button.dataset.quickFocus), true));
  });

  try {
    const [tasksResult, subjectResult] = await Promise.all([
      api('/api/tasks'),
      api('/api/subjects')
    ]);
    taskCache = tasksResult;
    subjectsCache = subjectResult.subjects.filter(subject => !subject.archived);
    await Promise.all([
      ...taskCache.map(task => IDB.putTask(task)),
      ...subjectsCache.map(subject => IDB.putSubject(subject))
    ]);
  } catch (error) {
    taskCache = await IDB.getAllTasks();
    if (!taskCache.length) {
      container.querySelector('#task-list').innerHTML = `<article class="card empty-state"><h2>Tasks could not be loaded</h2><p>Your local study data could not be read. Reload Maya and try again.</p></article>`;
      return;
    }
    subjectsCache = (await IDB.getAllSubjects()).filter(subject => !subject.archived);
    toast('Showing saved tasks from this device.');
  }

  populateSubjectFilter(container);
  ['#task-search', '#task-filter', '#subject-filter'].forEach(selector => {
    container.querySelector(selector).addEventListener('input', () => drawTasks(container));
  });
  drawTasks(container);
  container.addEventListener('change', event => {
    if (event.target.matches('[data-select-task]')) updateBulkToolbar(container);
  });
}

function drawDashboard(container) {
  const today = localDateKey(new Date());
  const active = taskCache.filter(task => !['done', 'skipped'].includes(task.status));
  const dueToday = active.filter(task => {
    const chunks = Array.isArray(task.schedule_chunks) ? task.schedule_chunks : [];
    return task.scheduled_date === today
      || task.due_date === today
      || chunks.some(chunk => chunk.date === today);
  });
  const overdue = active.filter(task => {
    const chunks = Array.isArray(task.schedule_chunks) ? task.schedule_chunks : [];
    const lastScheduledDate = chunks.length ? chunks.at(-1).date : task.scheduled_date;
    return (task.due_date && task.due_date < today)
      || (lastScheduledDate && lastScheduledDate < today);
  });
  const reviews = active.filter(task => task.is_due_revision);
  const summary = container.querySelector('#dashboard-summary');
  summary.innerHTML = `
    <button class="dashboard-stat" type="button" data-dashboard-filter="today">
      <span class="eyebrow">On today's plan</span><strong>${dueToday.length}</strong><span class="muted">study tasks</span>
    </button>
    <button class="dashboard-stat" type="button" data-dashboard-filter="overdue">
      <span class="eyebrow">Needs attention</span><strong>${overdue.length}</strong><span class="muted">overdue tasks</span>
    </button>
    <a class="dashboard-stat" href="#/reviews">
      <span class="eyebrow">Keep it fresh</span><strong>${reviews.length}</strong><span class="muted">reviews due</span>
    </a>
    <a class="dashboard-stat dashboard-stat-action" href="#/plan">
      <span class="eyebrow">Looking ahead</span><strong>Study plan</strong><span class="muted">Review your week</span>
    </a>`;
  summary.querySelectorAll('[data-dashboard-filter]').forEach(button => button.addEventListener('click', () => {
    container.querySelector('#task-filter').value = button.dataset.dashboardFilter;
    drawTasks(container);
    container.querySelector('#task-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function populateSubjectFilter(container) {
  const select = container.querySelector('#subject-filter');
  select.innerHTML = '<option value="">All subjects</option>' + subjectsCache.map(subject =>
    `<option value="${subject.id}">${escapeHTML(subject.name)}</option>`
  ).join('');
}

function filteredTasks(container) {
  const query = container.querySelector('#task-search').value.trim().toLowerCase();
  const filter = container.querySelector('#task-filter').value;
  const subjectId = container.querySelector('#subject-filter').value;
  const today = localDateKey(new Date());
  return taskCache.filter(task => {
    const matchesText = !query || `${task.title} ${task.subject_name || ''} ${task.topic_name || ''}`.toLowerCase().includes(query);
    const matchesSubject = !subjectId || String(task.subject_id) === subjectId;
    const active = !['done', 'skipped'].includes(task.status);
    const chunks = Array.isArray(task.schedule_chunks) ? task.schedule_chunks : [];
    const hasTodayChunk = chunks.some(chunk => chunk.date === today);
    const lastScheduledDate = chunks.length ? chunks.at(-1).date : task.scheduled_date;
    const matchesStatus = filter === 'all'
      || (filter === 'done' && task.status === 'done')
      || (filter === 'active' && ['pending', 'missed'].includes(task.status))
      || (filter === 'today' && active && (task.scheduled_date === today || task.due_date === today || hasTodayChunk))
      || (filter === 'overdue' && active && ((task.due_date && task.due_date < today) || (lastScheduledDate && lastScheduledDate < today)));
    return matchesText && matchesSubject && matchesStatus;
  }).sort((a, b) => {
    const aPinned = a.status !== 'skipped' && (a.is_due_revision || (a.is_revision && a.scheduled_date <= today && a.status !== 'done'));
    const bPinned = b.status !== 'skipped' && (b.is_due_revision || (b.is_revision && b.scheduled_date <= today && b.status !== 'done'));
    return Number(bPinned) - Number(aPinned)
      || String(a.scheduled_date || '9999').localeCompare(String(b.scheduled_date || '9999'))
      || Number(b.priority_score || 0) - Number(a.priority_score || 0);
  });
}

function drawTasks(container) {
  drawDashboard(container);
  const list = container.querySelector('#task-list');
  const tasks = filteredTasks(container);
  if (!tasks.length) {
    list.innerHTML = `<article class="card empty-state"><h2>${taskCache.length ? 'Nothing in this filter' : 'Your plan starts here'}</h2><p>${taskCache.length ? 'Try another filter or search.' : 'Add a syllabus or create a task to get moving.'}</p></article>`;
    updateBulkToolbar(container);
    return;
  }

  const taskMarkup = task => {
    const state = task.status === 'done' ? 'is-completed' : '';
    const chunks = Array.isArray(task.schedule_chunks) ? task.schedule_chunks : [];
    const dateLabel = task.scheduled_date
      ? `Scheduled ${escapeHTML(task.scheduled_date)}${chunks.length > 1 ? ` · ${chunks.length} study sessions` : ''}`
      : 'Not scheduled';
    const dueLabel = task.is_due_revision ? '<span class="pill pill-warning">Review due</span>' : '';
    const missed = task.status === 'missed' ? '<span class="pill pill-danger">Needs rescheduling</span>' : '';
    const kind = task.type === 'read'
      ? '<span class="task-kind-badge task-kind-read">Read</span>'
      : task.type === 'revise' ? '<span class="task-kind-badge task-kind-review">Review</span>' : '';
    return `<article class="card task-card ${state}" data-task-card="${task.id}" data-task-status="${task.status}">
      <label class="task-toggle" title="Complete task">
        <input type="checkbox" data-complete-task="${task.id}" ${task.status === 'done' ? 'checked' : ''} aria-label="Complete ${escapeHTML(task.title)}">
      </label>
      <div class="task-content">
        <div class="task-title-row"><div><div class="task-heading-line">${kind}<h4 class="task-title">${escapeHTML(task.title)}</h4></div>
          <div class="task-meta"><span>${escapeHTML(task.subject_name || 'Subject')}</span><span>${Number(task.est_minutes || 0)} min</span><span>${dateLabel}</span>${dueLabel}${missed}</div>
        </div><label class="bulk-select"><input type="checkbox" data-select-task="${task.id}" aria-label="Select task for bulk edit"><span>Select</span></label></div>
        <div class="task-actions">
          <button type="button" data-start-task="${task.id}">Focus</button>
          <button type="button" data-snooze-task="${task.id}">Snooze 1 day</button>
          <button type="button" class="danger-action" data-skip-task="${task.id}">Skip</button>
        </div>
      </div>
    </article>`;
  };
  const subjects = new Map();
  tasks.forEach(task => {
    const subjectId = task.subject_id ?? 'unassigned';
    if (!subjects.has(subjectId)) {
      subjects.set(subjectId, { name: task.subject_name || 'Other tasks', units: new Map() });
    }
    const subject = subjects.get(subjectId);
    const unitId = task.unit_id ?? 'general';
    if (!subject.units.has(unitId)) {
      subject.units.set(unitId, {
        name: task.unit_name || 'General tasks',
        order: task.unit_id == null ? Number.MAX_SAFE_INTEGER : Number(task.unit_order || 0),
        tasks: []
      });
    }
    subject.units.get(unitId).tasks.push(task);
  });
  list.innerHTML = [...subjects.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(subject => `<section class="task-subject-group">
      <h2 class="task-group-heading">${escapeHTML(subject.name)}</h2>
      ${[...subject.units.values()]
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
        .map(unit => `<section class="task-unit-group">
          <h3 class="task-unit-heading">${escapeHTML(unit.name)}</h3>
          <div class="task-unit-list">${unit.tasks.map(taskMarkup).join('')}</div>
        </section>`).join('')}
    </section>`).join('');

  list.querySelectorAll('[data-complete-task]').forEach(input => {
    input.addEventListener('change', () => toggleTask(container, Number(input.dataset.completeTask), input.checked));
  });
  list.querySelectorAll('[data-skip-task]').forEach(button => {
    button.addEventListener('click', () => skipTask(container, Number(button.dataset.skipTask)));
  });
  list.querySelectorAll('[data-snooze-task]').forEach(button => {
    button.addEventListener('click', () => snoozeTask(container, Number(button.dataset.snoozeTask)));
  });
  list.querySelectorAll('[data-start-task]').forEach(button => {
    button.addEventListener('click', () => openTimer(container, Number(button.dataset.startTask)));
  });
  bindSwipe(container);
  updateBulkToolbar(container);
}

async function setTaskStatus(container, task, status, notify = false) {
  const oldStatus = task.status;
  task.status = status;
  task.is_due_revision = false;
  drawTasks(container);
  try {
    await queuedPatch(`/api/tasks/${task.id}`, { status }, () => {});
    if (notify) toast(status === 'done' ? 'Task complete. Nice work.' : 'Task restored.');
  } catch (error) {
    task.status = oldStatus;
    await IDB.putTask(task);
    drawTasks(container);
    toast(error.message);
    return false;
  }
  if (status === 'done') {
    if (navigator.vibrate) navigator.vibrate(18);
    toast('Task complete. Nice work.', {
      label: 'Undo',
      action: () => setTaskStatus(container, task, oldStatus, true),
      duration: 5000
    });
  }
  window.dispatchEvent(new CustomEvent('maya:refresh'));
  return true;
}

async function toggleTask(container, id, completed) {
  const task = taskCache.find(item => item.id === id);
  if (!task) return;
  await setTaskStatus(container, task, completed ? 'done' : 'pending');
}

function skipTask(container, id) {
  const task = taskCache.find(item => item.id === id);
  if (!task) return;
  const sheet = showSheet(`
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="sheet-heading"><div><p class="eyebrow">Skip task</p><h2>${escapeHTML(task.title)}</h2></div><button class="icon-button" data-close-sheet aria-label="Close">${ICONS.close}</button></div>
    <form id="skip-form"><label>Reason <textarea name="reason" placeholder="Optional: what got in the way?"></textarea></label>
      <div class="sheet-actions"><button type="button" class="button button-quiet" data-close-sheet>Cancel</button><button class="button button-danger" type="submit">Skip task</button></div>
    </form>`);
  sheet.root.querySelector('#skip-form').addEventListener('submit', async event => {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get('reason');
    task.status = 'skipped';
    task.skip_reason = reason;
    await IDB.putTask(task);
    drawTasks(container);
    try {
      await queuedRequest(`/api/tasks/${id}/skip`, 'POST', { reason });
      sheet.close();
      toast('Task skipped.');
    } catch (error) {
      task.status = 'pending';
      await IDB.putTask(task);
      drawTasks(container);
      toast(error.message);
    }
  });
}

async function snoozeTask(container, id) {
  const task = taskCache.find(item => item.id === id);
  if (!task) return;
  const originalDate = task.scheduled_date;
  const originalChunks = task.schedule_chunks;
  const base = originalDate ? new Date(`${originalDate}T12:00:00`) : new Date();
  base.setDate(base.getDate() + 1);
  task.scheduled_date = localDateKey(base);
  task.schedule_chunks = [];
  task.status = 'pending';
  await IDB.putTask(task);
  drawTasks(container);
  try {
    await queuedPatch(`/api/tasks/${id}`, { scheduled_date: task.scheduled_date, status: 'pending' });
    toast('Moved forward by one day.');
  } catch (error) {
    task.scheduled_date = originalDate;
    task.schedule_chunks = originalChunks;
    await IDB.putTask(task);
    drawTasks(container);
    toast(error.message);
  }
}

function bindSwipe(container) {
  container.querySelectorAll('[data-task-card]').forEach(card => {
    let startX = 0;
    let startY = 0;
    card.addEventListener('touchstart', event => {
      startX = event.changedTouches[0].clientX;
      startY = event.changedTouches[0].clientY;
    }, { passive: true });
    card.addEventListener('touchend', event => {
      const dx = event.changedTouches[0].clientX - startX;
      const dy = event.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx)) return;
      const id = Number(card.dataset.taskCard);
      if (dx > 0) toggleTask(container, id, true);
      else skipTask(container, id);
    }, { passive: true });
  });
}

function updateBulkToolbar(container) {
  const toolbar = container.querySelector('#bulk-toolbar');
  const selected = [...container.querySelectorAll('[data-select-task]:checked')].map(input => Number(input.dataset.selectTask));
  toolbar.hidden = selected.length === 0;
  if (!selected.length) return;
  toolbar.innerHTML = `<span>${selected.length} selected</span><button type="button" class="small-action" data-bulk-date>Move to date</button><button type="button" class="small-action" data-bulk-done>Complete selected</button>`;
  toolbar.querySelector('[data-bulk-date]').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'date';
    input.setAttribute('aria-label', 'New task date');
    const apply = document.createElement('button');
    apply.className = 'small-action';
    apply.type = 'button';
    apply.textContent = 'Save date';
    toolbar.append(input, apply);
    apply.onclick = async () => {
      if (!input.value) {
        toast('Choose a date before moving tasks.');
        return;
      }
      try {
        await api('/api/tasks/bulk', { method: 'POST', body: JSON.stringify({ task_ids: selected, scheduled_date: input.value }) });
        selected.forEach(id => {
          const task = taskCache.find(item => item.id === id);
          if (task) {
            task.scheduled_date = input.value;
            task.schedule_chunks = [];
          }
        });
        drawTasks(container);
        window.dispatchEvent(new CustomEvent('maya:refresh'));
      } catch (error) {
        toast(error.message);
      }
    };
  });
  toolbar.querySelector('[data-bulk-done]').addEventListener('click', () => completeTasks(container, selected));
}

async function completeTasks(container, selected) {
  const tasks = selected
    .map(id => taskCache.find(task => task.id === id))
    .filter(task => task && task.status !== 'done');
  if (!tasks.length) return;
  const ids = tasks.map(task => task.id);
  const previousStatuses = Object.fromEntries(tasks.map(task => [task.id, task.status]));
  const button = container.querySelector('[data-bulk-done]');
  if (button) button.disabled = true;
  try {
    const result = await api('/api/tasks/bulk', {
      method: 'POST',
      body: JSON.stringify({ task_ids: ids, status: 'done' })
    });
    tasks.forEach(task => {
      task.status = 'done';
      task.is_due_revision = false;
    });
    drawTasks(container);
    toast(`${result.updated} ${result.updated === 1 ? 'task' : 'tasks'} complete.`, {
      label: 'Undo',
      action: () => undoBulkComplete(container, ids, previousStatuses),
      duration: 5000
    });
    window.dispatchEvent(new CustomEvent('maya:refresh'));
  } catch (error) {
    if (button) button.disabled = false;
    toast(error.message);
  }
}

async function undoBulkComplete(container, ids, previousStatuses) {
  try {
    await api('/api/tasks/bulk', {
      method: 'POST',
      body: JSON.stringify({ task_ids: ids, task_statuses: previousStatuses })
    });
    ids.forEach(id => {
      const task = taskCache.find(item => item.id === id);
      if (!task) return;
      task.status = previousStatuses[id];
      task.is_due_revision = false;
    });
    drawTasks(container);
    toast('Tasks restored.');
    window.dispatchEvent(new CustomEvent('maya:refresh'));
  } catch (error) {
    toast(error.message);
  }
}

export async function openTaskForm(initialTitle = '') {
  try {
    if (!subjectsCache.length) {
      const response = await api('/api/subjects');
      subjectsCache = response.subjects.filter(subject => !subject.archived);
    }
  } catch (error) {
    toast(error.message);
    return;
  }
  const options = subjectsCache.map(subject =>
    `<option value="${subject.id}">${escapeHTML(subject.name)}</option>`
  ).join('');
  const sheet = showSheet(`
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="sheet-heading"><div><p class="eyebrow">Keep it small</p><h2>Add a task</h2></div><button class="icon-button" data-close-sheet aria-label="Close">${ICONS.close}</button></div>
    <form id="new-task-form" class="form-grid">
      <label class="span-2">Task name<input name="title" value="${escapeHTML(initialTitle)}" required maxlength="200" placeholder="Review lecture notes"></label>
      <label>Subject<select name="subject_id" required>${options || '<option value="">Create a subject first</option>'}</select></label>
      <label>Task type<select name="type">${TYPES.map(type => `<option value="${type}">${type}</option>`).join('')}</select></label>
      <label>Estimate (minutes)<input name="est_minutes" type="number" min="5" max="600" value="30" required></label>
      <label>Due date<input name="due_date" type="date"></label>
      <div class="sheet-actions span-2"><button type="button" class="button button-quiet" data-close-sheet>Cancel</button><button class="button" type="submit">Add task</button></div>
    </form>`);
  sheet.root.querySelector('#new-task-form').addEventListener('submit', async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.subject_id = Number(data.subject_id);
    data.est_minutes = Number(data.est_minutes);
    data.due_date ||= null;
    try {
      await queuedRequest('/api/tasks', 'POST', data);
      sheet.close();
      toast('Task added.');
      window.dispatchEvent(new CustomEvent('maya:refresh'));
    } catch (error) {
      toast(error.message);
    }
  });
}

function openTimer(container, initialTaskId, initialMinutes = 25, startImmediately = false) {
  const pending = taskCache.filter(task => task.status !== 'done');
  const options = pending.map(task =>
    `<option value="${task.id}" ${task.id === initialTaskId ? 'selected' : ''}>${escapeHTML(task.title)}</option>`
  ).join('');
  let timer;
  let durationMinutes = initialMinutes;
  let focusStartedAt;
  let completed = false;
  let sessionSavePending = false;
  let sessionSavePromise;
  let confirmationStep = 0;
  const protectActiveFocus = event => {
    if (focusStartedAt && (!completed || sessionSavePending)) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  const sheet = showSheet(`
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="sheet-heading"><div><p class="eyebrow">Focus mode</p><h2 id="timer-phase">Focus</h2></div><button class="icon-button" data-close-sheet aria-label="Close">${ICONS.close}</button></div>
    <label>Study task<select id="timer-task">${options || '<option value="">Unlinked focus session</option>'}</select></label>
    <fieldset class="focus-duration">
      <legend>Focus duration</legend>
      <div class="focus-presets" role="group" aria-label="Choose a focus duration">
        ${[15, 25, 45, 60].map(minutes => `<button type="button" class="button button-quiet" data-duration="${minutes}" aria-pressed="${minutes === durationMinutes}">${minutes} min</button>`).join('')}
      </div>
      <form id="custom-duration-form" class="custom-duration">
        <label for="custom-duration">Custom (1–240 minutes)</label>
        <input id="custom-duration" type="number" min="1" max="240" step="1" value="${durationMinutes}" required>
        <button type="submit" class="button button-quiet">Set</button>
      </form>
    </fieldset>
    <div class="timer-face">
      <div class="timer-ring" id="timer-ring" role="progressbar" aria-label="Focus time remaining" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="timer-ring-track" cx="60" cy="60" r="52"></circle>
          <circle class="timer-ring-progress" id="timer-progress" cx="60" cy="60" r="52"></circle>
        </svg>
        <div class="timer-ring-content"><span id="timer-display" class="timer-clock">25:00</span><span id="timer-caption" class="muted">25 minutes to go</span></div>
      </div>
    </div>
    <div class="focus-controls">
      <button id="timer-start" class="button">Start focus</button>
      <button id="timer-pause" class="button button-quiet" hidden>Pause</button>
      <button id="timer-resume" class="button" hidden>Resume</button>
      <button id="timer-end" class="button button-danger" hidden>End session</button>
    </div>
    <div id="timer-confirmation" class="focus-confirmation" role="group" aria-labelledby="timer-confirmation-title" hidden>
      <h3 id="timer-confirmation-title"></h3>
      <p class="muted" id="timer-confirmation-copy"></p>
      <div class="focus-controls">
        <button type="button" class="button button-quiet" id="timer-keep-going">Keep focusing</button>
        <button type="button" class="button button-danger" id="timer-confirm-end"></button>
      </div>
    </div>`, () => {
    timer?.pause();
    window.removeEventListener('beforeunload', protectActiveFocus);
  }, {
    onRequestClose: () => {
      if (!focusStartedAt || (completed && !sessionSavePending)) return true;
      requestEndConfirmation();
      return false;
    }
  });
  window.addEventListener('beforeunload', protectActiveFocus);
  const display = sheet.root.querySelector('#timer-display');
  const pauseButton = sheet.root.querySelector('#timer-pause');
  const startButton = sheet.root.querySelector('#timer-start');
  const resumeButton = sheet.root.querySelector('#timer-resume');
  const endButton = sheet.root.querySelector('#timer-end');
  const progress = sheet.root.querySelector('#timer-progress');
  const progressRing = sheet.root.querySelector('#timer-ring');
  const caption = sheet.root.querySelector('#timer-caption');
  const confirmation = sheet.root.querySelector('#timer-confirmation');
  const circumference = 2 * Math.PI * 52;
  const durationButtons = [...sheet.root.querySelectorAll('[data-duration]')];
  const customDuration = sheet.root.querySelector('#custom-duration');
  const tick = remaining => {
    display.textContent = formatTime(remaining);
    const elapsed = durationMinutes * 60 - remaining;
    const percent = Math.max(0, Math.min(100, elapsed / (durationMinutes * 60) * 100));
    progress.style.strokeDashoffset = String(circumference * percent / 100);
    progressRing.setAttribute('aria-valuenow', String(Math.round(100 - percent)));
    caption.textContent = remaining === 0
      ? 'Session complete'
      : `${Math.ceil(remaining / 60)} ${Math.ceil(remaining / 60) === 1 ? 'minute' : 'minutes'} to go`;
    updateControls();
  };
  const updateControls = () => {
    const running = Boolean(timer?.running);
    startButton.hidden = running || (Boolean(focusStartedAt) && !completed);
    pauseButton.hidden = !running;
    resumeButton.hidden = running || !focusStartedAt || completed;
    endButton.hidden = !focusStartedAt || completed;
    const durationLocked = Boolean(focusStartedAt) && (!completed || sessionSavePending);
    durationButtons.forEach(button => { button.disabled = durationLocked; });
    customDuration.disabled = durationLocked;
    sheet.root.querySelector('#custom-duration-form button').disabled = durationLocked;
  };
  const saveSession = async (minutes, isCompleted) => {
    const taskId = Number(sheet.root.querySelector('#timer-task').value);
    if (!taskId || minutes < 1) return true;
    if (sessionSavePromise) return sessionSavePromise;
    sessionSavePromise = api(`/api/tasks/${taskId}/session`, {
        method: 'POST',
        body: JSON.stringify({ minutes, completed: isCompleted, started_at: focusStartedAt })
      }).then(() => true)
      .catch(error => {
        toast(`Focus time could not be saved: ${error.message}`);
        return false;
      })
      .finally(() => { sessionSavePromise = null; });
    return sessionSavePromise;
  };
  const complete = async () => {
    completed = true;
    sheet.root.querySelector('#timer-phase').textContent = 'Focus complete';
    const hasTask = Boolean(Number(sheet.root.querySelector('#timer-task').value));
    sessionSavePending = hasTask;
    const saved = await saveSession(durationMinutes, true);
    sessionSavePending = !saved && hasTask;
    if (!saved) {
      startButton.textContent = 'Retry saving session';
      if (sessionSavePending) startButton.dataset.retrySave = 'true';
    } else {
      toast('Focus complete. Nice work!');
      startButton.textContent = 'Start another focus';
      startButton.hidden = false;
    }
    updateControls();
  };
  const start = () => {
    if (completed) {
      completed = false;
      focusStartedAt = null;
      timer = null;
    }
    if (!timer) timer = startTimer(durationMinutes * 60, complete, tick);
    if (!focusStartedAt) focusStartedAt = new Date().toISOString();
    sheet.root.querySelector('#timer-phase').textContent = 'Focus';
    startButton.textContent = 'Start focus';
    delete startButton.dataset.retrySave;
    timer.start();
    tick(timer.remaining);
    updateControls();
  };
  const requestEndConfirmation = () => {
    confirmationStep = Math.min(2, confirmationStep + 1);
    confirmation.hidden = false;
    sheet.root.querySelector('#timer-confirmation-title').textContent = confirmationStep === 1
      ? 'Are you sure you want to end your focus?'
      : 'Think about it again—your focus time is not over yet.';
    sheet.root.querySelector('#timer-confirmation-copy').textContent = confirmationStep === 1
      ? 'You can pause or keep going without ending this session.'
      : 'Once you end, this focus session cannot be continued.';
    sheet.root.querySelector('#timer-confirm-end').textContent = confirmationStep === 1
      ? 'I want to stop'
      : 'Yes, end my session';
  };
  const endSession = async () => {
    timer?.pause();
    const elapsedMinutes = Math.floor((durationMinutes * 60 - (timer?.remaining ?? durationMinutes * 60)) / 60);
    const minutesToSave = completed ? durationMinutes : elapsedMinutes;
    if (!await saveSession(minutesToSave, completed)) {
      confirmation.hidden = true;
      confirmationStep = 0;
      return;
    }
    sessionSavePending = false;
    if (minutesToSave > 0 && Number(sheet.root.querySelector('#timer-task').value)) {
      toast(`${minutesToSave} focus ${minutesToSave === 1 ? 'minute' : 'minutes'} saved.`);
    }
    sheet.close();
  };
  const setDuration = minutes => {
    durationMinutes = minutes;
    customDuration.value = String(minutes);
    timer = null;
    completed = false;
    focusStartedAt = null;
    startButton.textContent = 'Start focus';
    delete startButton.dataset.retrySave;
    durationButtons.forEach(button => {
      const selected = Number(button.dataset.duration) === minutes;
      button.setAttribute('aria-pressed', String(selected));
    });
    tick(minutes * 60);
  };

  durationButtons.forEach(button => button.addEventListener('click', () => setDuration(Number(button.dataset.duration))));
  sheet.root.querySelector('#custom-duration-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!customDuration.reportValidity()) return;
    setDuration(Number(customDuration.value));
    durationButtons.forEach(button => button.setAttribute('aria-pressed', 'false'));
  });
  startButton.addEventListener('click', async () => {
    if (startButton.dataset.retrySave) {
      if (await saveSession(durationMinutes, true)) {
        sessionSavePending = false;
        startButton.textContent = 'Start another focus';
        delete startButton.dataset.retrySave;
        toast('Focus session saved.');
        updateControls();
      }
      return;
    }
    start();
  });
  pauseButton.addEventListener('click', () => {
    timer?.pause();
    updateControls();
  });
  resumeButton.addEventListener('click', start);
  endButton.addEventListener('click', requestEndConfirmation);
  sheet.root.querySelector('#timer-keep-going').addEventListener('click', () => {
    confirmationStep = 0;
    confirmation.hidden = true;
  });
  sheet.root.querySelector('#timer-confirm-end').addEventListener('click', () => {
    if (confirmationStep === 1) requestEndConfirmation();
    else endSession();
  });
  tick(durationMinutes * 60);
  if (startImmediately) start();
}
