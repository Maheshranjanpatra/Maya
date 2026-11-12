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

export async function render(container) {
  container.innerHTML = `
    <header class="view-heading">
      <div><p class="eyebrow">Make today count</p><h1>Tasks</h1><p>One small step at a time.</p></div>
      <button class="button" id="add-task"><span aria-hidden="true">+</span> Add task</button>
    </header>
    <section class="view-stack">
      <div class="card timer-widget">
        <div><p class="eyebrow">Focus session</p><h2>25 minutes, one task</h2><p class="muted">Stay with one thing until the timer ends.</p></div>
        <button class="button button-quiet" id="start-focus">Start focus</button>
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

  container.querySelector('#add-task').addEventListener('click', () => openTaskForm(container));
  container.querySelector('#start-focus').addEventListener('click', () => openTimer(container));

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
  const today = new Date().toISOString().slice(0, 10);
  return taskCache.filter(task => {
    const matchesText = !query || `${task.title} ${task.subject_name || ''} ${task.topic_name || ''}`.toLowerCase().includes(query);
    const matchesSubject = !subjectId || String(task.subject_id) === subjectId;
    const matchesStatus = filter === 'all'
      || (filter === 'done' && task.status === 'done')
      || (filter === 'active' && ['pending', 'missed'].includes(task.status))
      || (filter === 'today' && task.status !== 'done' && task.scheduled_date === today)
      || (filter === 'overdue' && task.status !== 'done' && task.scheduled_date < today);
    return matchesText && matchesSubject && matchesStatus;
  }).sort((a, b) => {
    const aPinned = a.is_due_revision || (a.is_revision && a.scheduled_date <= today && a.status !== 'done');
    const bPinned = b.is_due_revision || (b.is_revision && b.scheduled_date <= today && b.status !== 'done');
    return Number(bPinned) - Number(aPinned)
      || String(a.scheduled_date || '9999').localeCompare(String(b.scheduled_date || '9999'))
      || Number(b.priority_score || 0) - Number(a.priority_score || 0);
  });
}

function drawTasks(container) {
  const list = container.querySelector('#task-list');
  const tasks = filteredTasks(container);
  if (!tasks.length) {
    list.innerHTML = `<article class="card empty-state"><h2>${taskCache.length ? 'Nothing in this filter' : 'Your plan starts here'}</h2><p>${taskCache.length ? 'Try another filter or search.' : 'Add a syllabus or create a task to get moving.'}</p></article>`;
    return;
  }

  const taskMarkup = task => {
    const state = task.status === 'done' ? 'is-completed' : '';
    const dateLabel = task.scheduled_date ? `Scheduled ${escapeHTML(task.scheduled_date)}` : 'Not scheduled';
    const dueLabel = task.is_due_revision ? '<span class="pill pill-warning">Review due</span>' : '';
    const missed = task.status === 'missed' ? '<span class="pill pill-danger">Needs rescheduling</span>' : '';
    return `<article class="card task-card ${state}" data-task-card="${task.id}" data-task-status="${task.status}">
      <label class="task-toggle" title="Complete task">
        <input type="checkbox" data-complete-task="${task.id}" ${task.status === 'done' ? 'checked' : ''} aria-label="Complete ${escapeHTML(task.title)}">
      </label>
      <div class="task-content">
        <div class="task-title-row"><div><h4 class="task-title">${escapeHTML(task.title)}</h4>
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
  const base = originalDate ? new Date(`${originalDate}T12:00:00`) : new Date();
  base.setDate(base.getDate() + 1);
  task.scheduled_date = base.toISOString().slice(0, 10);
  task.status = 'pending';
  await IDB.putTask(task);
  drawTasks(container);
  try {
    await queuedPatch(`/api/tasks/${id}`, { scheduled_date: task.scheduled_date, status: 'pending' });
    toast('Moved forward by one day.');
  } catch (error) {
    task.scheduled_date = originalDate;
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
      try {
        await api('/api/tasks/bulk', { method: 'POST', body: JSON.stringify({ task_ids: selected, scheduled_date: input.value }) });
        selected.forEach(id => {
          const task = taskCache.find(item => item.id === id);
          if (task) task.scheduled_date = input.value;
        });
        drawTasks(container);
      } catch (error) {
        toast(error.message);
      }
    };
  });
  toolbar.querySelector('[data-bulk-done]').addEventListener('click', async () => {
    await Promise.all(selected.map(id => toggleTask(container, id, true)));
  });
}

async function openTaskForm(container) {
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
      <label class="span-2">Task name<input name="title" required maxlength="200" placeholder="Review lecture notes"></label>
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

function openTimer(container, initialTaskId) {
  const pending = taskCache.filter(task => task.status !== 'done');
  const options = pending.map(task =>
    `<option value="${task.id}" ${task.id === initialTaskId ? 'selected' : ''}>${escapeHTML(task.title)}</option>`
  ).join('');
  const sheet = showSheet(`
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="sheet-heading"><div><p class="eyebrow">Focus mode</p><h2 id="timer-phase">Focus</h2></div><button class="icon-button" data-close-sheet aria-label="Close">${ICONS.close}</button></div>
    <label>Study task<select id="timer-task">${options || '<option value="">Unlinked focus session</option>'}</select></label>
    <div class="timer-face"><span id="timer-display" class="timer-clock">25:00</span><span id="timer-caption" class="muted">Focus session</span></div>
    <div class="split-actions"><button id="timer-start" class="button">Start</button><button id="timer-pause" class="button button-quiet">Pause</button><button id="timer-reset" class="button button-quiet">Reset</button></div>`);
  let phase = 'focus';
  let timer;
  let focusStartedAt;
  const display = sheet.root.querySelector('#timer-display');
  const pauseButton = sheet.root.querySelector('#timer-pause');
  const startButton = sheet.root.querySelector('#timer-start');
  const resetButton = sheet.root.querySelector('#timer-reset');
  const start = () => {
    if (!timer) {
      timer = startTimer(phase === 'focus' ? 25 * 60 : 5 * 60, tick, complete);
    }
    if (phase === 'focus' && !focusStartedAt) focusStartedAt = new Date().toISOString();
    timer.start();
  };
  const tick = remaining => { display.textContent = formatTime(remaining); };
  const complete = async () => {
    if (phase === 'focus') {
      const taskId = Number(sheet.root.querySelector('#timer-task').value);
      if (taskId) {
        try {
          await api(`/api/tasks/${taskId}/session`, {
            method: 'POST',
            body: JSON.stringify({ minutes: 25, completed: true, started_at: focusStartedAt })
          });
        } catch (error) {
          toast(error.message);
        }
      }
      if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
      phase = 'break';
      sheet.root.querySelector('#timer-phase').textContent = 'Break';
      sheet.root.querySelector('#timer-caption').textContent = 'Five minutes to reset';
    } else {
      phase = 'focus';
      focusStartedAt = null;
      sheet.root.querySelector('#timer-phase').textContent = 'Focus';
      sheet.root.querySelector('#timer-caption').textContent = 'Focus session';
    }
    timer = startTimer(phase === 'focus' ? 25 * 60 : 5 * 60, tick, complete);
    timer.start();
    toast(phase === 'break' ? 'Focus complete. Take a short break.' : 'Break complete. Ready to focus.');
  };
  startButton.addEventListener('click', start);
  pauseButton.addEventListener('click', () => timer?.pause());
  resetButton.addEventListener('click', () => {
    timer?.cancel();
    timer = startTimer(phase === 'focus' ? 25 * 60 : 5 * 60, tick, complete);
    focusStartedAt = null;
    start();
  });
  sheet.root.querySelector('[data-close-sheet]').addEventListener('click', () => timer?.pause());
}
