import { api } from '../api.js';
import { Visuals } from '../components/visuals.js';
import { escapeHTML } from '../components/dom.js';
import { toast } from '../components/toast.js';

export async function render(container) {
  container.innerHTML = `
    <header class="view-heading"><div><p class="eyebrow">Progress you can see</p><h1>Visuals</h1><p>Consistency, coverage, readiness, and what to focus on next.</p></div></header>
    <div class="view-stack">
      <section class="grid grid-2">
        <article class="card chart-card"><p class="eyebrow">12 weeks</p><h2>Consistency heatmap</h2><canvas id="heatmap" height="150"></canvas></article>
        <article class="card chart-card"><p class="eyebrow">Recent activity</p><h2>XP sparkline</h2><canvas id="xp-sparkline" height="150"></canvas></article>
        <article class="card chart-card"><p class="eyebrow">Hours in Maya</p><h2>Estimated vs actual</h2><canvas id="time-bars" height="170"></canvas><p class="hint">Solid bars are estimates; the gold line is your logged study time.</p></article>
        <article class="card chart-card"><p class="eyebrow">Upcoming deadlines</p><h2>Exam timeline</h2><canvas id="exam-timeline" height="120"></canvas></article>
      </section>
      <section><div class="section-heading"><div><p class="eyebrow">At a glance</p><h2>Subject coverage</h2></div></div><div id="coverage-rings" class="grid grid-3"></div></section>
      <section><div class="section-heading"><div><p class="eyebrow">Deadline readiness</p><h2>Readiness gauges</h2></div></div><div id="readiness-gauges" class="grid grid-3"></div></section>
      <section class="card chart-card"><p class="eyebrow">Weighted progress</p><h2>Mastery by subject</h2><canvas id="mastery-bars" height="180"></canvas></section>
      <section class="card"><p class="eyebrow">Where to focus</p><h2>Weak topics</h2><div id="weak-topics" class="view-stack"></div></section>
    </div>`;
  try {
    const [overview, days, exams] = await Promise.all([
      api('/api/stats/overview'),
      api('/api/stats/heatmap'),
      api('/api/stats/risk')
    ]);
    draw(container, overview, days, exams);
  } catch (error) {
    toast(error.message);
  }
}

function draw(container, overview, days, exams) {
  Visuals.heatmap(container.querySelector('#heatmap'), days);
  const weeklyXp = [];
  for (let week = 0; week < 12; week += 1) {
    weeklyXp.push(days.slice(week * 7, week * 7 + 7)
      .reduce((sum, day) => sum + Math.max(0, Number(day.xp || 0)), 0));
  }
  Visuals.spark(container.querySelector('#xp-sparkline'), weeklyXp);
  Visuals.bars(container.querySelector('#time-bars'), overview.subjects.map(subject => ({
    label: subject.name,
    est: Number(subject.estimated_minutes || 0) / 60,
    actual: Number(subject.actual_minutes || 0) / 60,
    color: subject.color
  })));
  Visuals.timeline(container.querySelector('#exam-timeline'), exams);

  const coverage = container.querySelector('#coverage-rings');
  coverage.innerHTML = overview.subjects.map(subject => `
    <article class="card chart-card"><h3>${escapeHTML(subject.name)}</h3><canvas class="chart-ring" data-coverage="${Number(subject.coverage)}" height="150"></canvas><p class="muted">${Number(subject.completed_tasks)} / ${Number(subject.task_count)} tasks complete</p></article>
  `).join('') || '<article class="card empty-state">Add a subject to start tracking coverage.</article>';
  coverage.querySelectorAll('[data-coverage]').forEach(canvas =>
    Visuals.ring(canvas, Number(canvas.dataset.coverage))
  );

  const readiness = container.querySelector('#readiness-gauges');
  readiness.innerHTML = exams.map(exam => {
    const capacity = Math.max(1, Number(exam.days_remaining) * 102);
    const percent = Math.max(0, Math.min(100, 100 - Number(exam.remaining_minutes || 0) / capacity * 100));
    const color = exam.risk === 'crunch' ? '#b54b43' : exam.risk === 'tight' ? '#c07816' : undefined;
    return `<article class="card chart-card"><h3>${escapeHTML(exam.subject_name)}</h3><canvas class="chart-ring" data-readiness="${percent}" data-color="${color || ''}" height="145"></canvas><p class="muted">${Number(exam.days_remaining)} days · <span class="risk-${escapeHTML(exam.risk)}">${escapeHTML(exam.risk)}</span></p></article>`;
  }).join('') || '<article class="card empty-state">Add an exam to track readiness.</article>';
  readiness.querySelectorAll('[data-readiness]').forEach(canvas =>
    Visuals.gauge(canvas, Number(canvas.dataset.readiness), canvas.dataset.color || undefined)
  );

  Visuals.bars(container.querySelector('#mastery-bars'), overview.subjects.map(subject => ({
    label: subject.name,
    value: Number(subject.mastery),
    color: subject.color
  })));

  const weak = container.querySelector('#weak-topics');
  weak.innerHTML = overview.weak_topics.map(topic =>
    `<article class="topic-row"><div><strong>${escapeHTML(topic.name)}</strong><p class="muted">${escapeHTML(topic.subject_name)} · Difficulty ${Number(topic.difficulty)} · ${Math.round(Number(topic.completion) * 100)}% task completion</p></div><a class="small-action" href="#/tasks">Study</a></article>`
  ).join('') || '<p class="muted">Your topic progress will appear here as you study.</p>';
}
