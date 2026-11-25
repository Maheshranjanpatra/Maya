import test from 'node:test';
import assert from 'node:assert/strict';
import { IDB } from '../app/static/js/idb.js';
import { localApi } from '../app/static/js/local-api.js';
import { startTimer } from '../app/static/js/features/timer.js';

globalThis.location = { origin: 'http://localhost' };

let stores;
let failStore;

function seed(data = {}) {
  stores = Object.fromEntries([
    'tasks', 'subjects', 'units', 'topics', 'task_dependencies', 'exams',
    'blackouts', 'review_items', 'task_sessions', 'xp_events', 'prereqs', 'flashcards'
  ].map(name => [name, structuredClone(data[name] || [])]));
  stores.settings = structuredClone(data.settings || [{
    id: 1,
    daily_capacity_minutes: 120,
    study_days: [0, 1, 2, 3, 4, 5, 6],
    buffer_pct: 15
  }]);

  IDB.all = async name => structuredClone(stores[name] || []);
  IDB.get = async (name, id) => structuredClone(stores[name]?.find(item => item.id === id));
  IDB.write = async (name, operation, value) => applyOperation(name, operation, value);
  IDB.replaceAll = async data => {
    for (const name of Object.keys(stores)) {
      if (name !== 'queue') stores[name] = structuredClone(data[name] || []);
    }
  };
  IDB.batch = async operations => {
    const snapshot = structuredClone(stores);
    try {
      const results = [];
      for (const item of operations) {
        if (failStore === item.store) throw new Error('Simulated IndexedDB write failure.');
        const dependencyValues = Array.isArray(item.dependsOn)
          ? Object.fromEntries(item.dependsOn.map(index => [index, results[index]]))
          : results[item.dependsOn];
        const value = typeof item.value === 'function' ? item.value(dependencyValues) : item.value;
        results.push(applyOperation(item.store, item.operation, value));
      }
      return results;
    } catch (error) {
      stores = snapshot;
      throw error;
    }
  };
}

function applyOperation(name, operation, value) {
  const rows = stores[name] ||= [];
  if (operation === 'add') {
    const id = value.id ?? Math.max(0, ...rows.map(item => Number(item.id) || 0)) + 1;
    rows.push({ ...structuredClone(value), id });
    return id;
  }
  if (operation === 'put') {
    const index = rows.findIndex(item => item.id === value.id);
    if (index < 0) rows.push(structuredClone(value));
    else rows[index] = structuredClone(value);
    return value.id;
  }
  if (operation === 'delete') {
    stores[name] = rows.filter(item => item.id !== value);
    return undefined;
  }
  throw new Error(`Unsupported fake IndexedDB operation: ${operation}`);
}

const request = (path, method = 'GET', body = {}) =>
  localApi(path, { method, body: JSON.stringify(body) });

test('planner handles an empty task list', async () => {
  seed();
  const result = await request('/api/plan/replan', 'POST');

  assert.equal(result.crunch, false);
  assert.deepEqual(result.schedule, {});
});

test('planner splits oversized tasks across days without exceeding capacity', async () => {
  seed({ tasks: [{ id: 1, title: 'Six-hour reading', type: 'read', est_minutes: 360, status: 'pending' }] });
  const result = await request('/api/plan/replan', 'POST');
  const chunks = stores.tasks[0].schedule_chunks;
  const totals = new Map();
  for (const chunk of chunks) totals.set(chunk.date, (totals.get(chunk.date) || 0) + chunk.minutes);

  assert.equal(result.crunch, false);
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.minutes, 0), 360);
  assert.ok(chunks.length > 1);
  assert.ok([...totals.values()].every(total => total <= 102));
});

test('planner schedules a dependent after its prerequisite', async () => {
  seed({
    tasks: [
      { id: 1, title: 'Read', est_minutes: 20, status: 'pending' },
      { id: 2, title: 'Make notes', est_minutes: 20, status: 'pending' }
    ],
    task_dependencies: [{ id: 1, task_id: 2, prereq_task_id: 1 }]
  });
  await request('/api/plan/replan', 'POST');

  assert.ok(stores.tasks[0].scheduled_date <= stores.tasks[1].scheduled_date);
  assert.ok(stores.tasks.every(task => task.schedule_chunks.length));
});

test('a completed prerequisite does not prevent scheduling its dependent', async () => {
  seed({
    tasks: [
      { id: 1, title: 'Read', est_minutes: 20, status: 'done' },
      { id: 2, title: 'Make notes', est_minutes: 20, status: 'pending' }
    ],
    task_dependencies: [{ id: 1, task_id: 2, prereq_task_id: 1 }]
  });
  await request('/api/plan/replan', 'POST');

  assert.ok(stores.tasks[1].scheduled_date);
});

test('exam risk only counts tasks inside the selected unit scope', async () => {
  seed({
    tasks: [
      { id: 1, subject_id: 1, topic_id: 10, est_minutes: 40, status: 'pending' },
      { id: 2, subject_id: 1, topic_id: 11, est_minutes: 300, status: 'pending' }
    ],
    subjects: [{ id: 1, name: 'Math' }],
    units: [{ id: 5, subject_id: 1 }, { id: 6, subject_id: 1 }],
    topics: [{ id: 10, unit_id: 5 }, { id: 11, unit_id: 6 }],
    exams: [{ id: 1, subject_id: 1, exam_date: '2099-01-01', scope_unit_ids: [5] }]
  });
  const [exam] = await request('/api/exams');

  assert.equal(exam.remaining_minutes, 40);
});

test('deleting a subject removes Pomodoro XP referenced by its sessions', async () => {
  seed({
    subjects: [{ id: 1, name: 'Math', archived: 1 }],
    tasks: [{ id: 7, subject_id: 1, status: 'done' }],
    task_sessions: [{ id: 20, task_id: 7, minutes: 25 }],
    xp_events: [{ id: 30, reason: 'Pomodoro completed', ref_id: 20, amount: 5 }]
  });
  await request('/api/subjects/1', 'DELETE');

  assert.equal(stores.xp_events.length, 0);
  assert.equal(stores.task_sessions.length, 0);
});

test('completing, undoing, and completing a task awards XP again', async () => {
  seed({ tasks: [{ id: 1, type: 'notes', status: 'pending', est_minutes: 30 }] });
  await request('/api/tasks/1', 'PATCH', { status: 'done' });
  await request('/api/tasks/1', 'PATCH', { status: 'pending' });
  await request('/api/tasks/1', 'PATCH', { status: 'done' });

  const xp = stores.xp_events.reduce((sum, event) => sum + event.amount, 0);
  assert.equal(xp, 10);
});

test('task completion and XP changes fail together', async () => {
  seed({ tasks: [{ id: 1, type: 'notes', status: 'pending', est_minutes: 30 }] });
  failStore = 'xp_events';
  await assert.rejects(request('/api/tasks/1', 'PATCH', { status: 'done' }));
  failStore = undefined;

  assert.equal(stores.tasks[0].status, 'pending');
  assert.equal(stores.xp_events.length, 0);
});

test('a Pomodoro session and its XP event are saved together', async () => {
  seed({ tasks: [{ id: 1, type: 'read', status: 'pending', actual_minutes: 0 }] });
  await request('/api/tasks/1/session', 'POST', { minutes: 25, completed: true });

  assert.equal(stores.task_sessions.length, 1);
  assert.equal(stores.tasks[0].actual_minutes, 25);
  assert.equal(stores.xp_events[0].ref_id, stores.task_sessions[0].id);
});

test('ending a focus session early saves study minutes without completion XP', async () => {
  seed({ tasks: [{ id: 1, type: 'read', status: 'pending', actual_minutes: 0 }] });
  await request('/api/tasks/1/session', 'POST', { minutes: 7, completed: false });

  assert.equal(stores.task_sessions[0].minutes, 7);
  assert.equal(stores.tasks[0].actual_minutes, 7);
  assert.equal(stores.xp_events.length, 0);
});

test('a failed Pomodoro XP write rolls back its session and task update', async () => {
  seed({ tasks: [{ id: 1, type: 'read', status: 'pending', actual_minutes: 0 }] });
  failStore = 'xp_events';
  await assert.rejects(request('/api/tasks/1/session', 'POST', { minutes: 25, completed: true }));
  failStore = undefined;

  assert.equal(stores.task_sessions.length, 0);
  assert.equal(stores.tasks[0].actual_minutes, 0);
  assert.equal(stores.xp_events.length, 0);
});

test('syllabus extraction commits linked records together', async () => {
  seed();
  const result = await request('/api/extract/commit', 'POST', {
    extraction: {
      subjects: [{
        name: 'Biology',
        units: [{
          name: 'Cells',
          topics: [
            { name: 'Cell structure', est_hours: 1, difficulty: 4, prerequisites: [] },
            { name: 'Cell division', est_hours: 2, difficulty: 3, prerequisites: ['Cell structure'], subtopics: ['Mitosis'] }
          ]
        }]
      }]
    }
  });

  assert.equal(stores.subjects.length, 1);
  assert.equal(stores.units[0].subject_id, result.subject_ids[0]);
  assert.equal(stores.topics.length, 3);
  assert.ok(stores.topics.every(topic => topic.unit_id === stores.units[0].id));
  assert.equal(stores.prereqs.length, 1);
  assert.equal(stores.task_dependencies.length, 5);
  assert.ok(stores.tasks.every(task => task.subject_id === result.subject_ids[0]));
  assert.ok(stores.tasks.some(task => task.title === 'Read: Mitosis'));
});

test('a failed syllabus extraction write leaves no partial study data', async () => {
  seed();
  failStore = 'tasks';
  await assert.rejects(request('/api/extract/commit', 'POST', {
    extraction: {
      subjects: [{
        name: 'Biology',
        units: [{ name: 'Cells', topics: [{ name: 'Cell structure' }] }]
      }]
    }
  }), /Simulated IndexedDB write failure/);
  failStore = undefined;

  assert.equal(stores.subjects.length, 0);
  assert.equal(stores.units.length, 0);
  assert.equal(stores.topics.length, 0);
  assert.equal(stores.tasks.length, 0);
  assert.equal(stores.task_dependencies.length, 0);
});

test('invalid focus session durations are rejected without changing study data', async () => {
  seed({ tasks: [{ id: 1, type: 'read', status: 'pending', actual_minutes: 0 }] });
  const before = structuredClone(stores);

  for (const minutes of [0, 0.5, 241, 'not-a-number']) {
    await assert.rejects(
      request('/api/tasks/1/session', 'POST', { minutes }),
      /Session duration must be between 1 and 240 whole minutes/
    );
    assert.deepEqual(stores, before);
  }
});

test('invalid backups are rejected without replacing local study data', async () => {
  seed({
    subjects: [{ id: 1, name: 'Math' }],
    tasks: [{ id: 1, title: 'Review', status: 'pending' }]
  });
  const before = structuredClone(stores);

  await assert.rejects(
    request('/api/import/backup', 'POST', {
      subjects: [{ id: 2, name: 'Physics' }],
      tasks: [{ id: 2, title: 'Practice', status: 'pending' }],
      settings: { theme: 'dark' }
    }),
    /invalid settings data/
  );

  assert.deepEqual(stores, before);
  await assert.rejects(
    request('/api/import/backup', 'POST', {
      subjects: [],
      tasks: [],
      settings: [{ id: 1, daily_capacity_minutes: 0 }]
    }),
    /Daily study capacity must be between 15 and 720 minutes/
  );
  assert.deepEqual(stores, before);
  await assert.rejects(
    request('/api/import/backup', 'POST', {
      subjects: [],
      tasks: [{ id: 1 }, { id: 1 }]
    }),
    /duplicate IDs in tasks/
  );
  assert.deepEqual(stores, before);
});

test('restoring a valid backup replaces data and preserves local AI credentials', async () => {
  seed({
    subjects: [{ id: 1, name: 'Math' }],
    settings: [{ id: 1, ai_api_key: 'local-key', theme: 'light' }]
  });

  await request('/api/import/backup', 'POST', {
    subjects: [{ id: 2, name: 'Physics' }],
    tasks: [{ id: 3, title: 'Practice', status: 'pending' }],
    settings: [{ id: 1, theme: 'dark' }]
  });

  assert.deepEqual(stores.subjects, [{ id: 2, name: 'Physics' }]);
  assert.deepEqual(stores.tasks, [{ id: 3, title: 'Practice', status: 'pending' }]);
  assert.equal(stores.settings[0].theme, 'dark');
  assert.equal(stores.settings[0].ai_api_key, 'local-key');
});

test('profile keeps yesterday streaks and reports the historical best streak', async () => {
  const completed = offset => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return date.toISOString();
  };
  seed({
    tasks: [
      { id: 1, status: 'done', completed_at: completed(-5) },
      { id: 2, status: 'done', completed_at: completed(-4) },
      { id: 3, status: 'done', completed_at: completed(-3) },
      { id: 4, status: 'done', completed_at: completed(-1) }
    ]
  });

  const profile = await request('/api/profile');

  assert.equal(profile.streak, 1);
  assert.equal(profile.streak_best, 3);
});

test('invalid planning settings are rejected without changing saved settings', async () => {
  seed({
    settings: [{
      id: 1,
      daily_capacity_minutes: 120,
      study_days: [1, 2, 3],
      weekly_goal: 5,
      theme: 'light'
    }]
  });

  await assert.rejects(
    request('/api/settings', 'PATCH', { daily_capacity_minutes: 0, study_days: [] }),
    /Daily study capacity must be between 15 and 720 minutes/
  );
  assert.equal(stores.settings[0].daily_capacity_minutes, 120);
  assert.deepEqual(stores.settings[0].study_days, [1, 2, 3]);
});

test('invalid review grades do not corrupt the review schedule', async () => {
  seed({
    review_items: [{
      id: 1,
      topic_id: 3,
      ease: 2.5,
      interval_days: 1,
      next_review: '2099-01-01',
      reps: 0
    }]
  });
  const before = structuredClone(stores.review_items);

  await assert.rejects(
    request('/api/reviews/1/grade', 'POST', { quality: 'invalid' }),
    /Choose Again, Hard, Good, or Easy/
  );

  assert.deepEqual(stores.review_items, before);
});

test('focus timer counts elapsed time instead of delayed interval ticks', () => {
  const originalNow = Date.now;
  const originalWindow = globalThis.window;
  let now = 1000;
  let tick;
  let completed = 0;
  globalThis.window = {
    setInterval(callback) {
      tick = callback;
      return 1;
    },
    clearInterval() {}
  };
  Date.now = () => now;

  try {
    const timer = startTimer(10, () => { completed += 1; });
    timer.start();
    now += 5500;
    tick();
    assert.equal(timer.remaining, 5);
    now += 4500;
    tick();
    assert.equal(timer.remaining, 0);
    assert.equal(completed, 1);
  } finally {
    Date.now = originalNow;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
