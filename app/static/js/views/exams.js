import { api } from '../api.js';
import { escapeHTML, showSheet } from '../components/dom.js';
import { toast } from '../components/toast.js';

const TYPES = ['midterm', 'final', 'quiz', 'practical'];

export async function render(container) {
  container.innerHTML = `
    <header class="view-heading"><div><p class="eyebrow">Deadlines, made visible</p><h1>Exams</h1><p>Plan backward from each assessment.</p></div><button id="add-exam" class="button">Add exam</button></header>
    <div id="exam-list" class="view-stack"></div>`;
  container.querySelector('#add-exam').addEventListener('click', () => examForm(container));
  await loadExams(container);
}

async function loadExams(container) {
  try {
    const exams = await api('/api/exams');
    const list = container.querySelector('#exam-list');
    list.innerHTML = exams.map(exam => `
      <article class="card exam-card">
        <div class="card-heading"><div><p class="eyebrow">${escapeHTML(exam.exam_type)}</p><h2>${escapeHTML(exam.subject_name)}</h2></div><span class="pill risk-${escapeHTML(exam.risk)}">${escapeHTML(exam.risk)} plan</span></div>
        <div class="row"><span class="exam-countdown">${exam.days_remaining < 0 ? `${Math.abs(exam.days_remaining)} days ago` : exam.days_remaining === 0 ? 'Today' : `${exam.days_remaining} days`}</span><span>${escapeHTML(exam.exam_date)}</span><span>${Number(exam.weightage)}% weight</span></div>
        <div class="progress-track"><span style="width:${readinessWidth(exam)}%"></span></div>
        <p class="muted">${Math.round(Number(exam.remaining_minutes || 0) / 60 * 10) / 10} study hours left in this subject</p>
        <div class="task-actions"><button type="button" data-edit-exam="${exam.id}">Edit</button><button type="button" class="danger-action" data-delete-exam="${exam.id}">Remove</button><a class="small-action" href="#/plan">View plan</a></div>
      </article>`).join('') || '<article class="card empty-state"><h2>No exams yet</h2><p>Add an exam date and Maya will plan backward from it.</p></article>';
    list.querySelectorAll('[data-edit-exam]').forEach(button => button.onclick = () => examForm(container, exams.find(item => item.id === Number(button.dataset.editExam))));
    list.querySelectorAll('[data-delete-exam]').forEach(button => button.onclick = () => confirmDelete(container, Number(button.dataset.deleteExam)));
  } catch (error) {
    toast(error.message);
  }
}

function readinessWidth(exam) {
  const capacity = Math.max(1, Number(exam.days_remaining) * 102);
  return Math.max(0, Math.min(100, 100 - Number(exam.remaining_minutes || 0) / capacity * 100));
}

async function examForm(container, existing = null) {
  let subjects;
  try {
    const result = await api('/api/subjects');
    subjects = result.subjects.filter(subject => !subject.archived);
  } catch (error) {
    toast(error.message);
    return;
  }
  const options = subjects.map(subject => `<option value="${subject.id}" ${Number(existing?.subject_id) === subject.id ? 'selected' : ''}>${escapeHTML(subject.name)}</option>`).join('');
  const selectedScope = (() => {
    try { return JSON.parse(existing?.scope_unit_ids || '[]').map(Number); }
    catch { return []; }
  })();
  const sheet = showSheet(`
    <div class="sheet-handle" aria-hidden="true"></div><div class="sheet-heading"><div><p class="eyebrow">${existing ? 'Update your deadline' : 'Set a deadline'}</p><h2>${existing ? 'Edit exam' : 'Add exam'}</h2></div><button class="icon-button" data-close-sheet aria-label="Close">Close</button></div>
    <form id="exam-form" class="form-grid">
      <label class="span-2">Subject<select name="subject_id" id="exam-subject" required>${options || '<option value="">Add an active subject first</option>'}</select></label>
      <label>Exam date<input name="exam_date" type="date" value="${escapeHTML(existing?.exam_date || '')}" required></label>
      <label>Exam type<select name="exam_type">${TYPES.map(type => `<option value="${type}" ${existing?.exam_type === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>
      <label>Weightage (%)<input name="weightage" type="number" min="0" max="100" step="1" value="${Number(existing?.weightage ?? 100)}"></label>
      <label class="span-2">Scope units<select name="scope_unit_ids" id="exam-scope" multiple size="4"><option value="">All units</option></select><small>Leave empty to include the whole subject.</small></label>
      <div class="sheet-actions span-2"><button type="button" class="button button-quiet" data-close-sheet>Cancel</button><button class="button">${existing ? 'Save exam' : 'Add exam'}</button></div>
    </form>`);
  const form = sheet.root.querySelector('#exam-form');
  const scope = sheet.root.querySelector('#exam-scope');
  const updateScope = async () => {
    const subjectId = Number(form.elements.subject_id.value);
    try {
      const detail = await api(`/api/subjects/${subjectId}/detail`);
      scope.innerHTML = detail.units.map(unit => `<option value="${unit.id}" ${selectedScope.includes(unit.id) ? 'selected' : ''}>${escapeHTML(unit.name)}</option>`).join('');
    } catch (error) {
      toast(error.message);
    }
  };
  await updateScope();
  form.elements.subject_id.addEventListener('change', () => {
    selectedScope.length = 0;
    updateScope();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.subject_id = Number(data.subject_id);
    data.weightage = Number(data.weightage);
    data.scope_unit_ids = [...scope.selectedOptions].map(option => Number(option.value)).filter(Boolean);
    const url = existing ? `/api/exams/${existing.id}` : '/api/exams';
    try {
      await api(url, { method: existing ? 'PATCH' : 'POST', body: JSON.stringify(data) });
      sheet.close();
      toast(existing ? 'Exam updated.' : 'Exam added.');
      await api('/api/plan/replan', { method: 'POST', body: '{}' });
      await loadExams(container);
    } catch (error) {
      toast(error.message);
    }
  });
}

function confirmDelete(container, id) {
  const sheet = showSheet(`<div class="sheet-handle" aria-hidden="true"></div><h2>Remove this exam?</h2><p class="muted">Study tasks and subject data will stay saved.</p><div class="sheet-actions"><button class="button button-quiet" data-close-sheet>Cancel</button><button class="button button-danger" id="confirm-delete">Remove exam</button></div>`);
  sheet.root.querySelector('#confirm-delete').onclick = async () => {
    try {
      await api(`/api/exams/${id}`, { method: 'DELETE' });
      sheet.close();
      await loadExams(container);
    } catch (error) { toast(error.message); }
  };
}
