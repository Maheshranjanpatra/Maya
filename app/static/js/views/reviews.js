import { api } from '../api.js';
import { escapeHTML } from '../components/dom.js';
import { toast } from '../components/toast.js';

const grades = [
  ['Again', 1],
  ['Hard', 3],
  ['Good', 4],
  ['Easy', 5]
];

export async function render(container) {
  container.innerHTML = `
    <header class="view-heading"><div><p class="eyebrow">Remember more with less cramming</p><h1>Reviews</h1><p>Review due topics and rate how well you recalled them.</p></div></header>
    <div id="review-queue" class="view-stack"></div>`;
  await loadQueue(container);
}

async function loadQueue(container) {
  const queue = container.querySelector('#review-queue');
  try {
    const items = await api('/api/reviews/queue');
    queue.innerHTML = items.map(item => `
      <article class="card review-card" data-review="${item.id}">
        <div class="card-heading"><div><p class="eyebrow">${escapeHTML(item.subject_name)}</p><h2>${escapeHTML(item.topic_name)}</h2></div><span class="pill pill-warning">Due today</span></div>
        <p class="muted">Try to recall the key idea before revealing your notes.</p>
        <details class="review-answer"><summary>Show my notes</summary><p>${escapeHTML(item.back || 'No notes saved yet. Add notes from the Syllabus view.')}</p></details>
        <div class="grade-buttons">${grades.map(([label, quality]) => `<button type="button" data-grade="${quality}">${label}</button>`).join('')}</div>
      </article>`).join('') || '<article class="card empty-state"><h2>You are up to date</h2><p>New reviews appear as you complete reading tasks.</p><a class="button button-quiet" href="#/tasks">Back to tasks</a></article>';
    queue.querySelectorAll('[data-grade]').forEach(button => button.onclick = async () => {
      const card = button.closest('[data-review]');
      try {
        const result = await api(`/api/reviews/${card.dataset.review}/grade`, {
          method: 'POST',
          body: JSON.stringify({ quality: Number(button.dataset.grade) })
        });
        toast(`Next review in ${result.interval_days} day${result.interval_days === 1 ? '' : 's'}.`);
        await loadQueue(container);
      } catch (error) { toast(error.message); }
    });
  } catch (error) {
    queue.innerHTML = `<article class="card empty-state"><p>${escapeHTML(error.message)}</p></article>`;
  }
}
