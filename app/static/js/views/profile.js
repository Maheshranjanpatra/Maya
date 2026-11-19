import { api } from '../api.js';
import { Visuals } from '../components/visuals.js';
import { ICONS } from '../components/icons.js';
import { toast } from '../components/toast.js';

const badgeNames = {
  first_task: 'First task',
  streak_7: 'Seven-day streak',
  streak_30: 'Thirty-day streak',
  streak_100: 'One hundred days',
  first_subject_100: 'Subject complete',
  first_exam: 'First exam added',
  exams_10: 'Ten exams',
  tasks_100: '100 tasks',
  tasks_500: '500 tasks',
  level_10: 'Level 10',
  perfect_week: 'Perfect week',
  night_owl: 'Night owl'
};

export async function render(container) {
  container.innerHTML = `
    <header class="view-heading"><div><p class="eyebrow">Your effort adds up</p><h1>Profile</h1><p>Your progress, streaks, and earned milestones.</p></div></header>
    <div class="view-stack">
      <section id="profile-summary" class="grid grid-2"></section>
      <section class="grid grid-2">
        <article class="card chart-card"><p class="eyebrow">Last 12 weeks</p><h2>Study consistency</h2><canvas id="profile-heatmap" height="140" aria-label="Study consistency heatmap"></canvas></article>
        <article class="card chart-card"><p class="eyebrow">Last 12 weeks</p><h2>XP trend</h2><canvas id="profile-xp-trend" height="140" aria-label="XP trend"></canvas></article>
        <article class="card"><p class="eyebrow">Weekly review</p><h2>This week, so far</h2><p id="weekly-review" class="muted"></p><p id="weekly-goal-label" class="hint"></p><div id="weekly-progress" class="progress-track" role="progressbar" aria-label="Weekly study goal progress" aria-valuemin="0" aria-valuemax="100"><span></span></div></article>
        <article class="card"><p class="eyebrow">Your rhythm</p><h2>Time-of-day insight</h2><p id="time-insight" class="muted"></p></article>
      </section>
      <section class="card"><div class="section-heading"><div><p class="eyebrow">Keep showing up</p><h2>Badges</h2></div><span class="pill" id="badge-count"></span></div><div class="badge-grid" id="badges"></div></section>
    </div>`;
  try {
    const [profile, overview, days] = await Promise.all([
      api('/api/profile'),
      api('/api/stats/overview'),
      api('/api/stats/heatmap')
    ]);
    renderProfile(container, profile, overview, days);
  } catch (error) {
    toast(error.message);
  }
}

function renderProfile(container, profile, overview, days) {
  const progress = Math.max(0, Math.min(100, profile.xp_into_level / Math.max(1, profile.xp_for_next) * 100));
  const summary = container.querySelector('#profile-summary');
  summary.innerHTML = `
    <article class="card profile-level">
      <div class="card-heading"><div><p class="eyebrow">Current level</p><h2>Level ${Number(profile.level)} · ${profile.title}</h2></div><span class="pill pill-primary">${Number(profile.xp_total)} XP</span></div>
      <div class="progress-track xp-progress"><span style="width:${progress}%"></span></div>
      <p class="muted">${Number(profile.xp_into_level)} / ${Number(profile.xp_for_next)} XP toward the next level</p>
    </article>
    <article class="card streak-card">
      <div class="card-heading"><div><p class="eyebrow">Current streak</p><h2>${ICONS.flame} ${Number(profile.streak)} ${profile.streak === 1 ? 'day' : 'days'}</h2></div><span class="pill">Best ${Number(profile.streak_best)} days</span></div>
      <p class="muted">Complete at least one task today to keep your study rhythm going.</p>
    </article>`;

  const weeklyHours = Math.round(Number(overview.total_minutes_this_week || 0) / 6) / 10;
  const lastHours = Math.round(Number(overview.total_minutes_last_week || 0) / 6) / 10;
  container.querySelector('#weekly-review').textContent =
    `${weeklyHours} hours studied this week, compared with ${lastHours} hours last week. ${Number(profile.tasks_completed)} tasks completed so far.`;
  const goal = Math.max(1, Number((overview.settings || {}).weekly_goal || 5) * 60);
  const goalHours = goal / 60;
  const progressPercent = Math.min(100, Number(overview.total_minutes_this_week || 0) / goal * 100);
  container.querySelector('#weekly-goal-label').textContent =
    `${weeklyHours} of ${goalHours} hours`;
  container.querySelector('#weekly-progress span').style.width =
    `${progressPercent}%`;
  container.querySelector('#weekly-progress').setAttribute('aria-valuenow', String(Math.round(progressPercent)));

  const peak = overview.time_of_day_peak;
  container.querySelector('#time-insight').textContent = peak == null
    ? 'Your study-time pattern will appear after your first focus session.'
    : `Your recent sessions most often start around ${formatHour(Number(peak))}. Use that time for your hardest topic.`;

  Visuals.heatmap(container.querySelector('#profile-heatmap'), days);
  const weeklyXp = [];
  for (let week = 0; week < 12; week += 1) {
    const slice = days.slice(week * 7, week * 7 + 7);
    weeklyXp.push(slice.reduce((sum, day) => sum + Math.max(0, Number(day.xp || 0)), 0));
  }
  Visuals.spark(container.querySelector('#profile-xp-trend'), weeklyXp);

  const earned = new Set((profile.badges || []).map(badge => badge.key));
  container.querySelector('#badge-count').textContent = `${earned.size} / ${Object.keys(badgeNames).length} earned`;
  container.querySelector('#badges').innerHTML = Object.entries(badgeNames).map(([key, label]) =>
    `<div class="badge-item ${earned.has(key) ? '' : 'locked'}"><strong>${label}</strong><span class="muted">${earned.has(key) ? 'Earned' : 'Not yet earned'}</span></div>`
  ).join('');
}

function formatHour(hour) {
  const normalized = hour % 24;
  const suffix = normalized >= 12 ? 'PM' : 'AM';
  return `${normalized % 12 || 12} ${suffix}`;
}
