import { api } from '../api.js';
import { queuedPatch } from '../sync.js';
import { escapeHTML, showSheet } from '../components/dom.js';
import { toast } from '../components/toast.js';

let weekStart;
let planData;

export async function render(container) {
  weekStart = startOfWeek(new Date());
  container.innerHTML = `
    <header class="view-heading"><div><p class="eyebrow">A week at a time</p><h1>Plan</h1><p>Tasks are placed before their deadlines, with room left for catch-up.</p></div><button id="replan" class="button button-quiet">Replan</button></header>
    <div class="calendar-header card"><button class="icon-button" id="week-prev" aria-label="Previous week">Prev</button><h2 id="week-title"></h2><button class="icon-button" id="week-next" aria-label="Next week">Next</button></div>
    <div id="crunch-note" class="status-message" hidden></div>
    <section id="week-grid" class="plan-grid"></section>`;
  container.querySelector('#week-prev').onclick = () => moveWeek(container, -7);
  container.querySelector('#week-next').onclick = () => moveWeek(container, 7);
  container.querySelector('#replan').onclick = () => replan(container);
  await loadPlan(container);
}

function startOfWeek(value) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function dateKey(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function moveWeek(container, days) {
  weekStart.setDate(weekStart.getDate() + days);
  loadPlan(container).catch(error => toast(error.message));
}

async function loadPlan(container) {
  const start = dateKey(weekStart);
  planData = await api(`/api/plan/week?start=${start}`);
  drawPlan(container);
}

function drawPlan(container) {
  const last = new Date(weekStart);
  last.setDate(last.getDate() + 6);
  container.querySelector('#week-title').textContent =
    `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  const notice = container.querySelector('#crunch-note');
  notice.hidden = !planData.crunch && !planData.explanation;
  notice.textContent = planData.explanation || '';
  container.querySelector('#week-grid').innerHTML = planData.days.map(day => {
    const date = new Date(`${day.date}T12:00:00`);
    const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const tasks = day.tasks.map(task => `
      <article class="plan-task" draggable="true" data-plan-task="${task.id}">
        <strong>${escapeHTML(task.title)}</strong>
        <p class="muted">${escapeHTML(task.subject_name || '')} · ${Number(task.est_minutes)} min</p>
        <button type="button" class="small-action" data-move-task="${task.id}" aria-label="Move ${escapeHTML(task.title)} to another day">Move</button>
      </article>`).join('');
    return `<article class="plan-day" data-plan-date="${day.date}">
      <h3>${label}<span class="pill">${Number(day.minutes_planned || 0)} / ${Number(day.capacity_minutes || 0)}m</span></h3>
      <div class="plan-day-tasks">${tasks || '<p class="muted">No tasks planned.</p>'}</div>
    </article>`;
  }).join('');

  const grid = container.querySelector('#week-grid');
  grid.querySelectorAll('[data-plan-task]').forEach(card => {
    card.addEventListener('dragstart', event => {
      event.dataTransfer.setData('text/plain', card.dataset.planTask);
      event.dataTransfer.effectAllowed = 'move';
    });
  });
  grid.querySelectorAll('[data-plan-date]').forEach(day => {
    day.addEventListener('dragover', event => {
      event.preventDefault();
      day.classList.add('drag-target');
    });
    day.addEventListener('dragleave', () => day.classList.remove('drag-target'));
    day.addEventListener('drop', event => {
      event.preventDefault();
      day.classList.remove('drag-target');
      moveTask(container, Number(event.dataTransfer.getData('text/plain')), day.dataset.planDate);
    });
  });
  grid.querySelectorAll('[data-move-task]').forEach(button => button.onclick = () =>
    chooseDate(container, Number(button.dataset.moveTask))
  );
}

async function moveTask(container, taskId, date) {
  try {
    await queuedPatch(`/api/tasks/${taskId}`, { scheduled_date: date });
    toast(`Task moved to ${date}.`);
    await loadPlan(container);
  } catch (error) { toast(error.message); }
}

function chooseDate(container, taskId) {
  const sheet = showSheet(`<div class="sheet-handle" aria-hidden="true"></div><h2>Reschedule task</h2><label>New day<input id="move-date" type="date" value="${dateKey(weekStart)}" required></label><div class="sheet-actions"><button class="button button-quiet" data-close-sheet>Cancel</button><button class="button" id="save-date">Move task</button></div>`);
  sheet.root.querySelector('#save-date').onclick = async () => {
    const date = sheet.root.querySelector('#move-date').value;
    if (!date) return;
    try {
      await queuedPatch(`/api/tasks/${taskId}`, { scheduled_date: date });
      sheet.close();
      toast(`Task moved to ${date}.`);
      await loadPlan(container);
    } catch (error) { toast(error.message); }
  };
}

async function replan(container) {
  const button = container.querySelector('#replan');
  button.disabled = true;
  try {
    const result = await api('/api/plan/replan', { method: 'POST', body: '{}' });
    if (result.explanation) toast(result.explanation);
    else toast(result.moved ? `${result.moved} overdue tasks moved forward.` : 'Your plan is up to date.');
    await loadPlan(container);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}
