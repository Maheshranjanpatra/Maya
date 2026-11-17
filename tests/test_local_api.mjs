import test from 'node:test';
import assert from 'node:assert/strict';
import { IDB } from '../app/static/js/idb.js';
import { localApi } from '../app/static/js/local-api.js';

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
  IDB.batch = async operations => {
    const snapshot = structuredClone(stores);
    try {
      const results = [];
      for (const item of operations) {
        if (failStore === item.store) throw new Error('Simulated IndexedDB write failure.');
        const value = typeof item.value === 'function'
          ? item.value(results[item.dependsOn])
          : item.value;
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

test('a failed Pomodoro XP write rolls back its session and task update', async () => {
  seed({ tasks: [{ id: 1, type: 'read', status: 'pending', actual_minutes: 0 }] });
  failStore = 'xp_events';
  await assert.rejects(request('/api/tasks/1/session', 'POST', { minutes: 25, completed: true }));
  failStore = undefined;

  assert.equal(stores.task_sessions.length, 0);
  assert.equal(stores.tasks[0].actual_minutes, 0);
  assert.equal(stores.xp_events.length, 0);
});
