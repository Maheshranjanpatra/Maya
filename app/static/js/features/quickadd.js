import { api } from '../api.js';
import { showSheet, escapeHTML } from '../components/dom.js';
import { toast } from '../components/toast.js';

const taskTypes = ['read', 'notes', 'practice', 'pastpaper', 'revise', 'mocktest', 'lab', 'assignment'];

export function quickadd() {
  const input = document.querySelector('#quickadd-input');
  if (!input) return;

  input.addEventListener('keydown', async event => {
    if (event.key !== 'Enter' || !input.value.trim()) return;
    event.preventDefault();
    const text = input.value.trim();
    input.disabled = true;
    try {
      const parsed = await api('/api/ai/quickadd', {
        method: 'POST',
        body: JSON.stringify({ text })
      });
      await confirmQuickAdd(parsed, text);
      input.value = '';
    } catch (error) {
      toast(error.message);
    } finally {
      input.disabled = false;
      input.focus();
    }
  });
}

async function confirmQuickAdd(item, originalText) {
  const resultType = item.type === 'exam' ? 'exam' : 'task';
  const subjectData = await api('/api/subjects');
  const subjects = subjectData.subjects.filter(subject => !subject.archived);
  const match = subjects.find(subject =>
    subject.name.toLowerCase() === String(item.subject_name || '').toLowerCase()
  );
  const options = subjects.map(subject =>
    `<option value="${subject.id}" ${match?.id === subject.id ? 'selected' : ''}>${escapeHTML(subject.name)}</option>`
  ).join('');
  const typeField = resultType === 'exam'
    ? `<label>Exam type<select name="exam_type"><option value="final">Final</option><option value="midterm">Midterm</option><option value="quiz">Quiz</option><option value="practical">Practical</option></select></label>`
    : `<label>Task type<select name="type">${taskTypes.map(type => `<option value="${type}">${type}</option>`).join('')}</select></label>`;
  const dateField = `<label>${resultType === 'exam' ? 'Exam date' : 'Due date'}<input name="date" type="date" value="${escapeHTML(item.date || '')}" required></label>`;
  const sheet = showSheet(`
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="sheet-heading"><div><p class="eyebrow">Quick add preview</p><h2>Confirm ${resultType}</h2></div><button class="icon-button" data-close-sheet aria-label="Close">×</button></div>
    <p class="muted">${escapeHTML(originalText)}</p>
    <form id="quickadd-confirm">
      <label>Title<input name="title" value="${escapeHTML(item.title || originalText)}" required></label>
      <label>Subject<select name="subject_id" required>${options || '<option value="">Add a subject first</option>'}</select></label>
      ${dateField}${typeField}
      <div class="sheet-actions"><button type="button" class="button button-quiet" data-close-sheet>Cancel</button><button type="submit" class="button">Add ${resultType}</button></div>
    </form>
  `);
  const form = sheet.root.querySelector('#quickadd-confirm');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      if (resultType === 'exam') {
        await api('/api/exams', {
          method: 'POST',
          body: JSON.stringify({
            subject_id: Number(data.subject_id),
            exam_date: data.date,
            exam_type: data.exam_type,
            weightage: 100
          })
        });
      } else {
        await api('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({
            subject_id: Number(data.subject_id),
            type: taskTypes.includes(data.type) ? data.type : 'read',
            title: data.title,
            est_minutes: 30,
            due_date: data.date || null
          })
        });
      }
      sheet.close();
      toast(`${resultType === 'exam' ? 'Exam' : 'Task'} added.`);
      window.dispatchEvent(new CustomEvent('maya:refresh'));
    } catch (error) {
      toast(error.message);
    }
  });
}
