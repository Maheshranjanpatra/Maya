import { api } from '../api.js';
import { escapeHTML } from '../components/dom.js';
import { toast } from '../components/toast.js';
import { ICONS } from '../components/icons.js';

let visibleMonth;
let selectedDate;
let monthDays = [];
let exams = [];

export async function render(container) {
  const today = new Date();
  visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  selectedDate = localDate(today);
  container.innerHTML = `
    <header class="view-heading"><div><p class="eyebrow">See the month clearly</p><h1>Calendar</h1><p>Study tasks, exams, and the effort behind them.</p></div></header>
    <section class="view-stack">
      <article class="card">
        <div class="calendar-header"><button class="icon-button" id="month-prev" aria-label="Previous month">${ICONS.chevronLeft}</button><h2 id="month-title"></h2><button class="icon-button" id="month-next" aria-label="Next month">${ICONS.chevronRight}</button></div>
        <div class="calendar-grid" id="month-grid" role="grid"></div>
      </article>
      <article class="card"><p class="eyebrow" id="selected-label"></p><h2 id="selected-title">Selected day</h2><div id="selected-items" class="view-stack"></div></article>
    </section>`;
  container.querySelector('#month-prev').onclick = () => moveMonth(container, -1);
  container.querySelector('#month-next').onclick = () => moveMonth(container, 1);
  try {
    exams = await api('/api/exams');
    await loadMonth(container);
    await showDay(container, selectedDate);
  } catch (error) { toast(error.message); }
}

function moveMonth(container, amount) {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + amount, 1);
  loadMonth(container).catch(error => toast(error.message));
}

async function loadMonth(container) {
  const month = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, '0')}`;
  monthDays = await api(`/api/stats/calendar?month=${month}`);
  drawMonth(container);
}

function drawMonth(container) {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const today = localDate(new Date());
  const maxXp = Math.max(1, ...monthDays.map(day => Math.max(0, Number(day.xp))));
  container.querySelector('#month-title').textContent = visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const cells = labels.map(label => `<div class="calendar-weekday" role="columnheader">${label}</div>`).join('');
  const blanks = Array.from({ length: offset }, () => '<span class="calendar-day is-empty" aria-hidden="true"></span>').join('');
  const days = monthDays.map(day => {
    const number = Number(day.date.slice(-2));
    const taskCount = Number(day.task_count);
    const examCount = Number(day.exam_count);
    const intensity = Math.min(.38, Math.max(0, Number(day.xp)) / maxXp * .38);
    return `<button type="button" class="calendar-day ${day.date === today ? 'is-today' : ''} ${day.date === selectedDate ? 'is-selected' : ''} ${examCount ? 'has-exam' : ''}" data-calendar-date="${day.date}" style="--day-intensity:${Math.round(intensity * 100)}%" aria-label="${day.date}: ${taskCount} tasks, ${examCount} exams${examCount ? ', exam day' : ''}">
      <span>${number}</span><span class="calendar-markers">${taskCount ? '<i></i>' : ''}${examCount ? '<i class="exam-marker"></i>' : ''}</span>
    </button>`;
  }).join('');
  const grid = container.querySelector('#month-grid');
  grid.innerHTML = cells + blanks + days;
  grid.querySelectorAll('[data-calendar-date]').forEach(button => button.onclick = async () => {
    selectedDate = button.dataset.calendarDate;
    drawMonth(container);
    await showDay(container, selectedDate);
  });
}

function localDate(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function showDay(container, day) {
  container.querySelector('#selected-label').textContent = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
  container.querySelector('#selected-title').textContent = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  const list = container.querySelector('#selected-items');
  list.innerHTML = '<div class="skeleton skeleton-card"></div>';
  try {
    const tasks = await api(`/api/tasks?date=${encodeURIComponent(day)}`);
    const dayExams = exams.filter(exam => exam.exam_date === day);
    list.innerHTML = [
      ...dayExams.map(exam => `<article class="status-message"><strong>${escapeHTML(exam.subject_name)} ${escapeHTML(exam.exam_type)}</strong><span> · Exam · ${Number(exam.weightage)}% weight</span></article>`),
      ...tasks.map(task => `<article class="topic-row"><div><strong>${escapeHTML(task.title)}</strong><p class="muted">${escapeHTML(task.subject_name)} · ${Number(task.est_minutes)} min · ${escapeHTML(task.status)}</p></div><a class="small-action" href="#/tasks">Tasks</a></article>`)
    ].join('') || '<p class="muted">No scheduled study tasks or exams on this date.</p>';
  } catch (error) {
    list.textContent = error.message;
  }
}
