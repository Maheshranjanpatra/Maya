import { api } from '../api.js';
import { IDB } from '../idb.js';
import { escapeHTML, showSheet } from '../components/dom.js';
import { toast } from '../components/toast.js';
import { ICONS } from '../components/icons.js';

let draft;
let subjectSummary;

export async function render(container) {
  container.innerHTML = `
    <header class="view-heading"><div><p class="eyebrow">Build your study map</p><h1>Syllabus</h1><p>Subjects, units, topics, and the work behind them.</p></div><button id="new-subject" class="button button-quiet">Add subject</button></header>
    <section class="view-stack">
      <article class="card"><div class="card-heading"><div><h2>Bring in your syllabus</h2><p class="muted">Gemini extracts a draft. You review every item before it is saved.</p></div><span class="pill pill-primary">Review first</span></div>
        <form id="upload-form" class="form-grid">
          <label>Subject name (optional)<input name="subject_name" maxlength="120" placeholder="e.g. Physics II"></label>
          <label class="file-drop">PDF, DOCX, image, or text file<input name="file" type="file" accept=".pdf,.docx,.txt,.jpg,.jpeg,.png"></label>
          <label class="span-2">Or paste syllabus text<textarea name="pasted_text" placeholder="Paste units, topics, marks, and any known prerequisites"></textarea></label>
          <div class="span-2"><button class="button" type="submit">Extract with Gemini</button><p class="hint">Your Gemini key stays in this browser. The syllabus content is sent to Google only when you request extraction.</p></div>
        </form>
        <p id="upload-status" class="status-message" hidden aria-live="polite"></p>
        <div id="extraction-review"></div>
      </article>
      <div id="subject-count" class="status-message" hidden></div>
      <div id="subject-grid" class="grid grid-3"></div>
    </section>`;

  container.querySelector('#new-subject').addEventListener('click', () => addSubject());
  container.querySelector('#upload-form').addEventListener('submit', event => analyzeSyllabus(event, container));
  await loadSubjects(container);
}

async function loadSubjects(container) {
  try {
    subjectSummary = await api('/api/subjects');
    await Promise.all(subjectSummary.subjects.map(subject => IDB.putSubject(subject)));
    renderSubjects(container);
  } catch (error) {
    const cached = await IDB.getAllSubjects();
    subjectSummary = { subjects: cached, active_count: cached.filter(s => !s.archived).length, limit: 12 };
    renderSubjects(container);
    toast(error.message);
  }
}

function renderSubjects(container) {
  const active = subjectSummary.subjects.filter(subject => !subject.archived);
  const warning = container.querySelector('#subject-count');
  warning.hidden = active.length < 10;
  warning.textContent = active.length >= 12
    ? `You have ${active.length} active subjects. Archive one before adding another.`
    : `${active.length} of 12 active subjects. At 10, Maya will remind you that archiving can keep the list manageable.`;
  container.querySelector('#subject-grid').innerHTML = subjectSummary.subjects.map(subject => `
    <article class="card subject-card ${subject.archived ? 'is-archived' : ''}">
      <div><h2 class="subject-title"><i class="subject-color" style="background:${safeColor(subject.color)}"></i>${escapeHTML(subject.name)}</h2>
        <p class="muted">${Number(subject.unit_count || 0)} units · ${Number(subject.topic_count || 0)} topics</p></div>
      <div class="subject-actions">
        <button type="button" data-open-subject="${subject.id}">${subject.archived ? 'View archive' : 'Open subject'}</button>
        ${subject.archived
          ? `<button type="button" data-restore-subject="${subject.id}">Restore</button>`
          : `<button type="button" data-archive-subject="${subject.id}">Archive</button><a href="#/exams">Add exam</a>`}
      </div>
    </article>`).join('') || '<article class="card empty-state"><h2>No subjects yet</h2><p>Import a syllabus or create a subject to get started.</p></article>';

  container.querySelectorAll('[data-open-subject]').forEach(button =>
    button.addEventListener('click', () => openSubject(container, Number(button.dataset.openSubject)))
  );
  container.querySelectorAll('[data-archive-subject],[data-restore-subject]').forEach(button =>
    button.addEventListener('click', () => toggleArchive(container, button))
  );
}

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#44634d';
}

async function toggleArchive(container, button) {
  const subject = subjectSummary.subjects.find(item => item.id === Number(button.dataset.archiveSubject || button.dataset.restoreSubject));
  if (!subject) return;
  const archive = button.hasAttribute('data-archive-subject');
  const sheet = showSheet(`
    <div class="sheet-handle" aria-hidden="true"></div>
    <h2>${archive ? 'Archive' : 'Restore'} ${escapeHTML(subject.name)}?</h2>
    <p class="muted">${archive ? 'Archiving frees an active subject slot. The syllabus, tasks, and history stay saved.' : 'Restoring this subject counts toward the 12 active-subject limit.'}</p>
    <div class="sheet-actions"><button class="button button-quiet" data-close-sheet>Cancel</button><button class="button" id="confirm-archive">${archive ? 'Archive subject' : 'Restore subject'}</button></div>`);
  sheet.root.querySelector('#confirm-archive').addEventListener('click', async () => {
    try {
      await api(`/api/subjects/${subject.id}`, { method: 'PATCH', body: JSON.stringify({ archived: archive ? 1 : 0 }) });
      sheet.close();
      await loadSubjects(container);
    } catch (error) {
      toast(error.message);
    }
  });
}

function addSubject() {
  const sheet = showSheet(`
    <div class="sheet-handle" aria-hidden="true"></div><div class="sheet-heading"><div><p class="eyebrow">New study area</p><h2>Add a subject</h2></div><button class="icon-button" data-close-sheet aria-label="Close">${ICONS.close}</button></div>
    <form id="subject-form"><label>Subject name<input name="name" required maxlength="120" placeholder="e.g. Linear Algebra"></label><label>Course code (optional)<input name="code" maxlength="40"></label><div class="sheet-actions"><button type="button" class="button button-quiet" data-close-sheet>Cancel</button><button type="submit" class="button">Add subject</button></div></form>`);
  sheet.root.querySelector('#subject-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api('/api/subjects', { method: 'POST', body: JSON.stringify(form) });
      sheet.close();
      window.dispatchEvent(new CustomEvent('maya:refresh'));
    } catch (error) {
      toast(error.message);
    }
  });
}

async function analyzeSyllabus(event, container) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = container.querySelector('#upload-status');
  const file = form.elements.file.files[0];
  const pasted = form.elements.pasted_text.value.trim();
  if (!file && !pasted) {
    status.hidden = false;
    status.textContent = 'Choose a file or paste syllabus text first.';
    return;
  }
  status.hidden = false;
  status.textContent = 'Gemini is reading your syllabus…';
  const data = new FormData(form);
  data.delete('file');
  if (file) data.append('file', file);
  try {
    const result = await api('/api/upload', { method: 'POST', body: data });
    draft = result.extraction;
    renderReview(container, result.warnings || []);
    status.textContent = 'Review the extracted structure below. Nothing has been saved yet.';
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('danger-message');
  }
}

function renderReview(container, warnings = []) {
  const root = container.querySelector('#extraction-review');
  root.innerHTML = `
    <div class="section-heading"><div><h2>Review extracted syllabus</h2><p class="hint">Low-confidence topics are highlighted. Edit, add, or remove anything before confirming.</p></div></div>
    ${warnings.map(warning => `<p class="status-message">${escapeHTML(warning)}</p>`).join('')}
    <div class="review-editor">${draft.subjects.map((subject, s) => `
      <section class="review-subject" data-review-subject="${s}">
        <div class="card-heading"><label>Subject name<input data-s="${s}" data-field="subject-name" value="${escapeHTML(subject.name)}" maxlength="120"></label><button class="small-action" data-delete-subject="${s}" type="button">Remove</button></div>
        <label>Course code<input data-s="${s}" data-field="subject-code" value="${escapeHTML(subject.code || '')}"></label>
        ${subject.units.map((unit, u) => `
          <section class="review-unit">
            <div class="card-heading"><label>Unit<input data-s="${s}" data-u="${u}" data-field="unit-name" value="${escapeHTML(unit.name)}"></label><button class="small-action" data-delete-unit="${s}:${u}" type="button">Remove unit</button></div>
            ${unit.topics.map((topic, t) => `
              <article class="review-topic ${Number(topic.confidence) < .7 ? 'low-confidence' : ''}">
                <div class="card-heading"><label>Topic<input data-s="${s}" data-u="${u}" data-t="${t}" data-field="topic-name" value="${escapeHTML(topic.name)}" required></label><button class="small-action" data-delete-topic="${s}:${u}:${t}" type="button">Remove</button></div>
                <div class="field-row">
                  <label>Marks<input data-s="${s}" data-u="${u}" data-t="${t}" data-field="marks" type="number" min="0" step="1" value="${Number(topic.marks || 0)}"></label>
                  <label>Hours<input data-s="${s}" data-u="${u}" data-t="${t}" data-field="est_hours" type="number" min=".25" max="60" step=".25" value="${Number(topic.est_hours || 1)}"></label>
                  <label>Difficulty (1–5)<input data-s="${s}" data-u="${u}" data-t="${t}" data-field="difficulty" type="number" min="1" max="5" value="${Number(topic.difficulty || 3)}"></label>
                  <label>Confidence (0–1)<input data-s="${s}" data-u="${u}" data-t="${t}" data-field="confidence" type="number" min="0" max="1" step=".05" value="${Number(topic.confidence ?? .8)}"></label>
                </div>
                <label>Prerequisites (topic names, comma separated)<input data-s="${s}" data-u="${u}" data-t="${t}" data-field="prerequisites" value="${escapeHTML((topic.prerequisites || []).join(', '))}"></label>
                <label>Subtopics (comma separated)<input data-s="${s}" data-u="${u}" data-t="${t}" data-field="subtopics" value="${escapeHTML((topic.subtopics || []).join(', '))}"></label>
                ${Number(topic.confidence) < .7 ? `<span class="confidence-low">Double-check this extraction · ${Math.round(Number(topic.confidence) * 100)}% confidence</span>` : ''}
              </article>`).join('')}
            <button type="button" class="small-action" data-add-topic="${s}:${u}">Add topic</button>
          </section>`).join('')}
        <button type="button" class="small-action" data-add-unit="${s}">Add unit</button>
      </section>`).join('')}
    </div>
    <div class="split-actions"><button type="button" class="button button-quiet" id="add-review-subject">Add subject</button><button type="button" class="button" id="confirm-extraction">Confirm and save syllabus</button></div>`;

  root.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      const s = Number(input.dataset.s);
      if (input.dataset.field === 'subject-name') draft.subjects[s].name = input.value;
      else if (input.dataset.field === 'subject-code') draft.subjects[s].code = input.value || null;
      else if (input.dataset.field === 'unit-name') draft.subjects[s].units[Number(input.dataset.u)].name = input.value;
      else {
        const topic = draft.subjects[s].units[Number(input.dataset.u)].topics[Number(input.dataset.t)];
        const field = input.dataset.field;
        if (field === 'prerequisites' || field === 'subtopics') {
          topic[field] = input.value.split(',').map(value => value.trim()).filter(Boolean);
        } else {
          topic[field] = Number(input.value);
        }
      }
    });
  });
  root.querySelectorAll('[data-delete-subject]').forEach(button => button.onclick = () => {
    draft.subjects.splice(Number(button.dataset.deleteSubject), 1);
    renderReview(container, warnings);
  });
  root.querySelectorAll('[data-delete-unit]').forEach(button => button.onclick = () => {
    const [s, u] = button.dataset.deleteUnit.split(':').map(Number);
    draft.subjects[s].units.splice(u, 1);
    renderReview(container, warnings);
  });
  root.querySelectorAll('[data-delete-topic]').forEach(button => button.onclick = () => {
    const [s, u, t] = button.dataset.deleteTopic.split(':').map(Number);
    draft.subjects[s].units[u].topics.splice(t, 1);
    renderReview(container, warnings);
  });
  root.querySelectorAll('[data-add-unit]').forEach(button => button.onclick = () => {
    draft.subjects[Number(button.dataset.addUnit)].units.push({ name: 'New unit', order: 1, topics: [] });
    renderReview(container, warnings);
  });
  root.querySelectorAll('[data-add-topic]').forEach(button => button.onclick = () => {
    const [s, u] = button.dataset.addTopic.split(':').map(Number);
    draft.subjects[s].units[u].topics.push({ name: 'New topic', subtopics: [], marks: 0, est_hours: 1, difficulty: 3, prerequisites: [], confidence: 1 });
    renderReview(container, warnings);
  });
  root.querySelector('#add-review-subject').onclick = () => {
    draft.subjects.push({ name: 'New subject', units: [] });
    renderReview(container, warnings);
  };
  root.querySelector('#confirm-extraction').onclick = async () => {
    if (!draft.subjects.length || draft.subjects.some(subject => !subject.name.trim())) {
      toast('Every subject needs a name.');
      return;
    }
    try {
      const result = await api('/api/extract/commit', {
        method: 'POST',
        body: JSON.stringify({ extraction: draft })
      });
      root.replaceChildren();
      const notice = result.soft_cap_warning
        ? `Saved. You now have ${result.active_subjects} active subjects; archive one if your list feels crowded.`
        : 'Syllabus saved. Your topics and study tasks are ready.';
      statusMessage(container, [notice, ...(result.warnings || [])].join(' '));
      await api('/api/plan/replan', { method: 'POST', body: '{}' });
      draft = null;
      await loadSubjects(container);
    } catch (error) {
      toast(error.message);
    }
  };
}

function statusMessage(container, text) {
  const status = container.querySelector('#upload-status');
  status.hidden = false;
  status.classList.remove('danger-message');
  status.textContent = text;
}

async function openSubject(container, id) {
  try {
    const detail = await api(`/api/subjects/${id}/detail`);
    const subject = detail.subject;
    container.innerHTML = `
      <header class="view-heading"><div><p class="eyebrow">Subject syllabus</p><h1>${escapeHTML(subject.name)}</h1><p>${escapeHTML(subject.code || 'Units and topics')}</p></div><button id="back-subjects" class="button button-quiet">All subjects</button></header>
      <div class="split-actions"><button class="button" id="add-unit">Add unit</button><a class="button button-quiet" href="#/exams">Manage exams</a></div>
      <div class="unit-list">${detail.units.map(unit => `
        <section class="card"><div class="card-heading"><div><p class="eyebrow">Unit ${Number(unit.order_index) || ''}</p><h2>${escapeHTML(unit.name)}</h2></div><button class="small-action" data-add-topic="${unit.id}">Add topic</button></div>
          ${unit.topics.map(topic => `<article class="topic-row ${topic.parent_topic_id ? 'child-topic' : ''}">
            <div><div class="topic-title">${escapeHTML(topic.name)} ${Number(topic.confidence) < .7 ? `<span class="confidence-low">Check extraction</span>` : ''}</div>
              <p class="task-meta">${Number(topic.marks || 0)} marks · ${Number(topic.est_minutes || 0)} min · Difficulty ${Number(topic.difficulty || 3)}</p>
              <label>Notes<textarea data-topic-notes="${topic.id}" rows="2">${escapeHTML(topic.notes || '')}</textarea></label>
              <div class="task-actions"><button data-explain-topic="${topic.id}">Explain</button><button data-flashcards-topic="${topic.id}">Flashcards</button></div>
            </div><button class="small-action" data-edit-topic="${topic.id}" data-title="${escapeHTML(topic.name)}" data-marks="${Number(topic.marks || 0)}" data-minutes="${Number(topic.est_minutes || 60)}" data-difficulty="${Number(topic.difficulty || 3)}">Edit</button>
          </article>`).join('') || '<p class="muted">No topics in this unit yet.</p>'}
        </section>`).join('') || '<article class="card empty-state"><p>No units yet. Add your first unit to organize topics.</p></article>'}</div>`;
    container.querySelector('#back-subjects').onclick = () => render(container);
    container.querySelector('#add-unit').onclick = () => addUnit(container, id);
    container.querySelectorAll('[data-add-topic]').forEach(button => button.onclick = () => addTopic(container, Number(button.dataset.addTopic), id));
    container.querySelectorAll('[data-edit-topic]').forEach(button => button.onclick = () => editTopic(container, button, id));
    container.querySelectorAll('[data-topic-notes]').forEach(textarea => {
      let timeout;
      textarea.addEventListener('input', () => {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
          try {
            await api(`/api/topics/${textarea.dataset.topicNotes}`, { method: 'PATCH', body: JSON.stringify({ notes: textarea.value }) });
            toast('Notes saved.');
          } catch (error) {
            toast(error.message);
          }
        }, 600);
      });
    });
    container.querySelectorAll('[data-explain-topic]').forEach(button => button.onclick = () => aiExplain(Number(button.dataset.explainTopic)));
    container.querySelectorAll('[data-flashcards-topic]').forEach(button => button.onclick = () => showFlashcards(Number(button.dataset.flashcardsTopic)));
  } catch (error) {
    toast(error.message);
  }
}

function addUnit(container, subjectId) {
  const sheet = showSheet(`<div class="sheet-handle" aria-hidden="true"></div><h2>Add a unit</h2><form id="unit-form"><label>Unit name<input name="name" required></label><div class="sheet-actions"><button type="button" class="button button-quiet" data-close-sheet>Cancel</button><button class="button">Add unit</button></div></form>`);
  sheet.root.querySelector('#unit-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await api(`/api/subjects/${subjectId}/units`, { method: 'POST', body: JSON.stringify({ name: new FormData(event.currentTarget).get('name') }) });
      sheet.close();
      await openSubject(container, subjectId);
    } catch (error) { toast(error.message); }
  });
}

function addTopic(container, unitId, subjectId) {
  const sheet = showSheet(`<div class="sheet-handle" aria-hidden="true"></div><h2>Add a topic</h2><form id="topic-form" class="form-grid"><label class="span-2">Topic name<input name="name" required></label><label>Marks<input name="marks" type="number" min="0" value="0"></label><label>Estimated minutes<input name="est_minutes" type="number" min="5" value="60"></label><label>Difficulty<input name="difficulty" type="number" min="1" max="5" value="3"></label><div class="sheet-actions span-2"><button type="button" class="button button-quiet" data-close-sheet>Cancel</button><button class="button">Add topic</button></div></form>`);
  sheet.root.querySelector('#topic-form').addEventListener('submit', async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.marks = Number(data.marks);
    data.est_minutes = Number(data.est_minutes);
    data.difficulty = Number(data.difficulty);
    try {
      await api(`/api/units/${unitId}/topics`, { method: 'POST', body: JSON.stringify(data) });
      sheet.close();
      toast('Topic added.');
      await openSubject(container, subjectId);
    } catch (error) { toast(error.message); }
  });
}

function editTopic(container, button, subjectId) {
  const topicId = Number(button.dataset.editTopic);
  const sheet = showSheet(`<div class="sheet-handle" aria-hidden="true"></div><h2>Edit topic</h2><form id="edit-topic-form"><label>Topic name<input name="name" value="${escapeHTML(button.dataset.title)}" required></label><div class="field-row"><label>Marks<input name="marks" type="number" min="0" value="${button.dataset.marks}"></label><label>Estimated minutes<input name="est_minutes" type="number" min="5" value="${button.dataset.minutes}"></label></div><label>Difficulty<input name="difficulty" type="number" min="1" max="5" value="${button.dataset.difficulty}"></label><div class="sheet-actions"><button type="button" class="button button-quiet" data-close-sheet>Cancel</button><button class="button">Save</button></div></form>`);
  sheet.root.querySelector('#edit-topic-form').addEventListener('submit', async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.marks = Number(data.marks);
    data.est_minutes = Number(data.est_minutes);
    data.difficulty = Number(data.difficulty);
    try {
      await api(`/api/topics/${topicId}`, { method: 'PATCH', body: JSON.stringify(data) });
      sheet.close();
      toast('Topic updated.');
      await openSubject(container, subjectId);
    } catch (error) { toast(error.message); }
  });
}

async function aiExplain(topicId) {
  try {
    const result = await api('/api/ai/explain', { method: 'POST', body: JSON.stringify({ topic_id: topicId }) });
    const sheet = showSheet(`<div class="sheet-handle" aria-hidden="true"></div><div class="sheet-heading"><h2>Topic explanation</h2><button class="icon-button" data-close-sheet aria-label="Close">${ICONS.close}</button></div><p class="explanation-text"></p>`);
    sheet.root.querySelector('.explanation-text').textContent = result.text;
  } catch (error) { toast(error.message); }
}

async function showFlashcards(topicId) {
  try {
    const cards = await api('/api/ai/flashcards', { method: 'POST', body: JSON.stringify({ topic_id: topicId }) });
    let index = 0;
    const sheet = showSheet(`<div class="sheet-handle" aria-hidden="true"></div><div class="sheet-heading"><h2>Flashcards</h2><button class="icon-button" data-close-sheet aria-label="Close">${ICONS.close}</button></div><article class="card flashcard"><p class="eyebrow" id="flashcard-count"></p><h3 id="flashcard-front"></h3><div id="flashcard-back" class="review-answer" hidden></div><button class="button button-quiet" id="flip-card">Show answer</button><button class="small-action" id="next-card">Next card</button></article>`);
    const draw = () => {
      sheet.root.querySelector('#flashcard-count').textContent = `Card ${index + 1} of ${cards.length}`;
      sheet.root.querySelector('#flashcard-front').textContent = cards[index].front;
      sheet.root.querySelector('#flashcard-back').textContent = cards[index].back;
      sheet.root.querySelector('#flashcard-back').hidden = true;
    };
    sheet.root.querySelector('#flip-card').onclick = () => { sheet.root.querySelector('#flashcard-back').hidden = false; };
    sheet.root.querySelector('#next-card').onclick = () => { index = (index + 1) % cards.length; draw(); };
    draw();
  } catch (error) { toast(error.message); }
}
