import { IDB } from './idb.js';

const TASK_TYPES = new Set(['read', 'notes', 'practice', 'pastpaper', 'revise', 'mocktest', 'lab', 'assignment']);
const EXAM_TYPES = new Set(['midterm', 'final', 'quiz', 'practical']);
const DEFAULT_SETTINGS = {
  id: 1,
  daily_capacity_minutes: 120,
  study_days: [1, 2, 3, 4, 5, 6, 0],
  buffer_pct: 15,
  theme: 'auto',
  daily_goal: 3,
  weekly_goal: 5
};

export class LocalApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const fail = (message, status) => { throw new LocalApiError(message, status); };
const dateKey = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const today = () => dateKey(new Date());
const parse = value => value ? JSON.parse(value) : {};
const bodyOf = options => options.body instanceof FormData ? options.body : parse(options.body);
const all = store => IDB.all(store);
const byId = async (store, id) => (await all(store)).find(item => Number(item.id) === Number(id));
const add = (store, value) => {
  if (value.id === undefined) {
    const { id, ...withoutId } = value;
    return IDB.write(store, 'add', withoutId);
  }
  return IDB.write(store, 'add', value);
};
const put = (store, value) => IDB.write(store, 'put', value);
const remove = (store, id) => IDB.write(store, 'delete', Number(id));
const settings = async () => ({ ...DEFAULT_SETTINGS, ...(await IDB.get('settings', 1) || {}) });
const saveSettings = async value => put('settings', { ...await settings(), ...value, id: 1 });
const subjectById = async id => byId('subjects', id);

async function subjectRows() {
  const [subjects, units, topics] = await Promise.all([all('subjects'), all('units'), all('topics')]);
  return subjects.map(subject => ({
    ...subject,
    topic_count: topics.filter(topic => units.some(unit => unit.id === topic.unit_id && unit.subject_id === subject.id)).length,
    unit_count: units.filter(unit => unit.subject_id === subject.id).length
  })).sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
}

async function taskRows(filters = {}) {
  const [tasks, subjects, topics, units, dependencies] = await Promise.all([
    all('tasks'), all('subjects'), all('topics'), all('units'), all('task_dependencies')
  ]);
  return tasks.filter(task => {
    const subject = subjects.find(item => item.id === task.subject_id);
    const topic = topics.find(item => item.id === task.topic_id);
    return (!filters.date || task.scheduled_date === filters.date)
      && (!filters.status || task.status === filters.status)
      && (!filters.subject_id || String(task.subject_id) === String(filters.subject_id))
      && (!filters.q || `${task.title} ${topic?.name || ''} ${subject?.name || ''}`.toLowerCase().includes(filters.q.toLowerCase()))
      && (!subject || !subject.archived);
  }).map(task => {
    const subject = subjects.find(item => item.id === task.subject_id);
    const topic = topics.find(item => item.id === task.topic_id);
    const unit = units.find(item => item.id === topic?.unit_id);
    return {
      ...task,
      subject_name: subject?.name || '',
      subject_color: subject?.color || '',
      exam_weight: subject?.exam_weight || 100,
      topic_name: topic?.name || '',
      unit_id: unit?.id || null,
      unit_name: unit?.name || '',
      unit_order: Number(unit?.order_index || 0),
      prereq_task_ids: dependencies.filter(item => item.task_id === task.id).map(item => item.prereq_task_id),
      is_due_revision: Boolean(task.is_revision && task.scheduled_date && task.scheduled_date <= today() && task.status !== 'done')
    };
  }).sort((a, b) => Number(b.is_due_revision) - Number(a.is_due_revision)
    || String(a.scheduled_date || a.due_date || '9999').localeCompare(String(b.scheduled_date || b.due_date || '9999'))
    || Number(b.priority_score || 0) - Number(a.priority_score || 0));
}

async function subjectDetail(id) {
  const subject = await subjectById(id);
  if (!subject) fail('Subject not found.', 404);
  const [units, topics, prereqs] = await Promise.all([all('units'), all('topics'), all('prereqs')]);
  return {
    subject,
    units: units.filter(unit => unit.subject_id === subject.id).sort((a, b) => a.order_index - b.order_index).map(unit => ({
      ...unit,
      topics: topics.filter(topic => topic.unit_id === unit.id).map(topic => ({
        ...topic,
        prereqs: prereqs.filter(item => item.topic_id === topic.id).map(item => item.prereq_topic_id)
      }))
    }))
  };
}

async function examsWithRisk() {
  const [exams, subjects, tasks, appSettings] = await Promise.all([all('exams'), all('subjects'), all('tasks'), settings()]);
  const capacity = Number(appSettings.daily_capacity_minutes) * (100 - Number(appSettings.buffer_pct)) / 100;
  return exams.map(exam => {
    const subject = subjects.find(item => item.id === exam.subject_id);
    const days = Math.round((new Date(`${exam.exam_date}T00:00:00`) - new Date(`${today()}T00:00:00`)) / 86400000);
    const remaining = tasks.filter(task => task.subject_id === exam.subject_id && task.status === 'pending')
      .reduce((sum, task) => sum + Number(task.est_minutes || 0), 0);
    const available = Math.max(0, days) * capacity;
    return {
      ...exam,
      subject_name: subject?.name || '',
      subject_color: subject?.color || '',
      scope_unit_ids: JSON.stringify(exam.scope_unit_ids || []),
      days_remaining: days,
      remaining_minutes: remaining,
      risk: remaining > available ? 'crunch' : remaining > available * 0.8 ? 'tight' : 'comfortable'
    };
  }).sort((a, b) => a.exam_date.localeCompare(b.exam_date));
}

async function replan() {
  const [tasks, exams, appSettings, blackouts, dependencies] = await Promise.all([
    all('tasks'), all('exams'), settings(), all('blackouts'), all('task_dependencies')
  ]);
  const pending = tasks.filter(task => ['pending', 'missed'].includes(task.status));
  const schedule = {};
  const subjectLoad = new Map();
  const topics = await all('topics');
  const units = await all('units');
  const candidates = pending.map(task => {
    const topic = topics.find(item => item.id === task.topic_id);
    const unit = units.find(item => item.id === topic?.unit_id);
    const exam = exams.filter(item => item.subject_id === task.subject_id && item.exam_date >= today())
      .filter(item => !item.scope_unit_ids?.length || !unit || item.scope_unit_ids.includes(unit.id))
      .sort((a, b) => a.exam_date.localeCompare(b.exam_date))[0];
    const examDeadline = exam
      ? dateKey(new Date(new Date(`${exam.exam_date}T12:00:00`).getTime() - 86400000))
      : dateKey(new Date(new Date(`${today()}T12:00:00`).getTime() + 27 * 86400000));
    const deadline = task.due_date && task.due_date < examDeadline ? task.due_date : examDeadline;
    return { ...task, unit_id: unit?.id || null, deadline, exam_weight: Number(exam?.weightage || 100) };
  });
  const capacity = Math.floor(Number(appSettings.daily_capacity_minutes) * (100 - Number(appSettings.buffer_pct)) / 100);
  const availableDays = new Set(appSettings.study_days || DEFAULT_SETTINGS.study_days);
  const blockedDays = new Set(blackouts.map(item => item.date));
  const latest = candidates.reduce((max, task) => task.deadline > max ? task.deadline : max, today());
  const studyDates = [];
  for (let day = new Date(`${today()}T12:00:00`), last = new Date(`${latest}T12:00:00`); day <= last; day.setDate(day.getDate() + 1)) {
    const key = dateKey(day);
    if (availableDays.has(day.getDay()) && !blockedDays.has(key)) studyDates.push(key);
  }
  for (const key of studyDates.reverse()) {
    let remaining = capacity;
    while (remaining > 0) {
      const available = candidates.filter(task => !schedule[task.id]
        && task.deadline >= key
        && Number(task.est_minutes || 0) <= remaining
        && dependencies.filter(item => item.prereq_task_id === task.id)
          .every(item => Boolean(schedule[item.task_id])));
      if (!available.length) break;
      const chosen = available.sort((a, b) => {
        const scoreA = Number(a.exam_weight) / (1 + (subjectLoad.get(a.subject_id) || 0));
        const scoreB = Number(b.exam_weight) / (1 + (subjectLoad.get(b.subject_id) || 0));
        return scoreB - scoreA || Number(b.priority_score || 0) - Number(a.priority_score || 0) || String(a.id).localeCompare(String(b.id));
      })[0];
      schedule[chosen.id] = key;
      const minutes = Math.max(1, Number(chosen.est_minutes || 0));
      subjectLoad.set(chosen.subject_id, (subjectLoad.get(chosen.subject_id) || 0) + minutes);
      remaining -= minutes;
    }
  }
  for (const task of tasks) {
    if (!['pending', 'missed'].includes(task.status)) continue;
    const status = task.scheduled_date && task.scheduled_date < today() && !schedule[task.id] ? 'missed' : 'pending';
    await put('tasks', { ...task, status, scheduled_date: schedule[task.id] || null });
  }
  const unscheduled = candidates.filter(task => !schedule[task.id]).map(task => ({
    id: task.id, title: task.title, subject_id: task.subject_id, est_minutes: task.est_minutes,
    deadline: task.deadline
  }));
  const moved = pending.filter(task => task.scheduled_date && task.scheduled_date < today() && schedule[task.id]).length;
  const crunch = unscheduled.length > 0;
  return {
    moved,
    schedule,
    crunch,
    unscheduled,
    explanation: crunch ? `There is more work than the available study time. Maya scheduled ${pending.length - unscheduled.length} of ${pending.length} tasks and kept ${unscheduled.length} unscheduled.` : ''
  };
}

async function planWeek(start) {
  const [tasks, subjects, exams, appSettings, blackouts] = await Promise.all([taskRows(), all('subjects'), all('exams'), settings(), all('blackouts')]);
  const startDate = new Date(`${start}T12:00:00`);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(date.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    const dayTasks = tasks.filter(task => task.status !== 'done' && task.scheduled_date === key);
    return {
      date: key,
      capacity_minutes: Math.floor(Number(appSettings.daily_capacity_minutes) * (100 - Number(appSettings.buffer_pct)) / 100),
      minutes_planned: dayTasks.reduce((sum, task) => sum + Number(task.est_minutes || 0), 0),
      tasks: dayTasks.map(task => ({ ...task, subject_name: subjects.find(subject => subject.id === task.subject_id)?.name || '' }))
    };
  });
  const currentPlan = await replanPreview(tasks, exams, appSettings, blackouts, start);
  return { days, crunch: currentPlan.crunch, explanation: currentPlan.explanation, unscheduled: currentPlan.unscheduled };
}

async function replanPreview(tasks, exams, appSettings, blackouts, start) {
  const pending = tasks.filter(task => ['pending', 'missed'].includes(task.status));
  const unscheduled = pending.filter(task => !task.scheduled_date).map(task => ({
    id: task.id, title: task.title, subject_id: task.subject_id, est_minutes: task.est_minutes,
    deadline: task.due_date || exams.find(exam => exam.subject_id === task.subject_id)?.exam_date || ''
  }));
  return {
    crunch: unscheduled.length > 0,
    explanation: unscheduled.length ? `${unscheduled.length} tasks are not currently scheduled.` : '',
    unscheduled
  };
}

async function profile() {
  const [events, tasks, sessions, badges] = await Promise.all([all('xp_events'), all('tasks'), all('task_sessions'), all('badges')]);
  const total = Math.max(0, events.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  let level = 1;
  while (50 * level * (level - 1) <= total) level += 1;
  level -= 1;
  const into = total - 50 * (level - 1) * level;
  const doneDays = [...new Set(tasks.filter(task => task.status === 'done' && task.completed_at).map(task => task.completed_at.slice(0, 10)))].sort().reverse();
  const current = new Date(`${today()}T00:00:00`);
  let streak = 0;
  for (const day of doneDays) {
    const expected = new Date(current);
    expected.setDate(expected.getDate() - streak);
    if (day !== expected.toISOString().slice(0, 10)) break;
    streak += 1;
  }
  return {
    level,
    xp_total: total,
    xp_into_level: into,
    xp_for_next: 100 * level,
    title: level < 4 ? 'Novice' : level < 7 ? 'Apprentice' : level < 10 ? 'Scholar' : level < 15 ? 'Adept' : level < 20 ? 'Expert' : level < 30 ? 'Master' : 'Sage',
    streak,
    streak_best: streak,
    tasks_completed: tasks.filter(task => task.status === 'done').length,
    minutes_studied: sessions.reduce((sum, item) => sum + Number(item.minutes || 0), 0),
    badges
  };
}

async function heatmap(days = 84) {
  const [events, sessions, tasks] = await Promise.all([all('xp_events'), all('task_sessions'), all('tasks')]);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (days - index - 1));
    const key = date.toISOString().slice(0, 10);
    return {
      date: key,
      xp: events.filter(item => item.created_at?.slice(0, 10) === key).reduce((sum, item) => sum + Number(item.amount || 0), 0),
      minutes: sessions.filter(item => item.started_at?.slice(0, 10) === key).reduce((sum, item) => sum + Number(item.minutes || 0), 0),
      tasks: tasks.filter(item => item.status === 'done' && item.completed_at?.slice(0, 10) === key).length
    };
  });
}

async function overview() {
  const [subjects, tasks, sessions, appSettings, exams, topics, units, userProfile] = await Promise.all([
    subjectRows(), all('tasks'), all('task_sessions'), settings(), all('exams'), all('topics'), all('units'), profile()
  ]);
  const visible = subjects.filter(subject => !subject.archived).map(subject => {
    const subjectTasks = tasks.filter(task => task.subject_id === subject.id);
    const done = subjectTasks.filter(task => task.status === 'done');
    const subjectTopics = topics.filter(topic => units.some(unit => unit.id === topic.unit_id && unit.subject_id === subject.id));
    const totalMarks = subjectTopics.reduce((sum, topic) => sum + Number(topic.marks || 0), 0);
    const completedMarks = subjectTopics.filter(topic => done.some(task => task.topic_id === topic.id)).reduce((sum, topic) => sum + Number(topic.marks || 0), 0);
    return {
      ...subject,
      task_count: subjectTasks.length,
      completed_tasks: done.length,
      total_marks: totalMarks,
      completed_marks: completedMarks,
      coverage: subjectTasks.length ? Math.round(100 * done.length / subjectTasks.length) : 0,
      mastery: totalMarks ? Math.round(100 * completedMarks / totalMarks) : (subjectTasks.length ? Math.round(100 * done.length / subjectTasks.length) : 0),
      actual_minutes: sessions.filter(item => subjectTasks.some(task => task.id === item.task_id)).reduce((sum, item) => sum + Number(item.minutes || 0), 0),
      estimated_minutes: subjectTasks.reduce((sum, task) => sum + Number(task.est_minutes || 0), 0)
    };
  });
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekStart = monday.toISOString().slice(0, 10);
  const lastWeek = new Date(monday);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const lastWeekStart = lastWeek.toISOString().slice(0, 10);
  const thisWeekMinutes = sessions.filter(item => item.started_at >= weekStart).reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const lastWeekMinutes = sessions.filter(item => item.started_at >= lastWeekStart && item.started_at < weekStart).reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const topicCompletions = topics.map(topic => {
    const unit = units.find(item => item.id === topic.unit_id);
    const subject = subjects.find(item => item.id === unit?.subject_id);
    const related = tasks.filter(task => task.topic_id === topic.id);
    return { id: topic.id, name: topic.name, difficulty: topic.difficulty, subject_name: subject?.name || '', completion: related.length ? related.filter(task => task.status === 'done').length / related.length : 0 };
  }).sort((a, b) => Number(b.difficulty) - Number(a.difficulty) || a.completion - b.completion).slice(0, 8);
  return {
    ...userProfile,
    settings: appSettings,
    subjects: visible,
    total_minutes_this_week: thisWeekMinutes,
    total_minutes_last_week: lastWeekMinutes,
    weak_topics: topicCompletions,
    time_of_day_peak: null
  };
}

async function calendarMonth(month) {
  const [tasks, exams, events] = await Promise.all([all('tasks'), all('exams'), all('xp_events')]);
  const [year, monthNumber] = month ? month.split('-').map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
  if (!year || monthNumber < 1 || monthNumber > 12) fail('Month must use YYYY-MM format.');
  const count = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: count }, (_, index) => {
    const date = `${year}-${String(monthNumber).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`;
    return {
      date,
      task_count: tasks.filter(task => task.scheduled_date === date && task.status !== 'skipped').length,
      exam_count: exams.filter(exam => exam.exam_date === date).length,
      xp: events.filter(item => item.created_at?.slice(0, 10) === date).reduce((sum, item) => sum + Number(item.amount || 0), 0)
    };
  });
}

async function dispatch(path, method, options, query) {
  const data = bodyOf(options);
  const parts = path.replace(/^\/api\/?/, '').split('/').filter(Boolean);

  if (path === '/api/settings' && method === 'GET') {
    const current = await settings();
    return {
      settings: Object.fromEntries(Object.entries(current).filter(([key]) => !['gemini_api_key', 'web_lock_key'].includes(key))),
      gemini_key_set: Boolean(current.gemini_api_key),
      active_provider: current.gemini_api_key ? 'Gemini' : null,
      providers_available: current.gemini_api_key ? ['Gemini'] : []
    };
  }
  if (path === '/api/settings' && method === 'PATCH') {
    const current = await settings();
    await saveSettings({ ...current, ...data, study_days: data.study_days || current.study_days });
    return {};
  }
  if (parts[0] === 'subjects') {
    const subjects = await subjectRows();
    if (parts.length === 1 && method === 'GET') {
      const active = subjects.filter(item => !item.archived).length;
      return { subjects, active_count: active, soft_cap_warning: active >= 10, limit: 12 };
    }
    if (parts.length === 1 && method === 'POST') {
      const name = String(data.name || '').trim();
      if (!name) fail('Subject name is required.');
      if (subjects.filter(item => !item.archived).length >= 12) fail('Maya supports up to 12 active subjects. Archive one first.', 409);
      const id = await add('subjects', { ...data, name, color: data.color || '#5B5BD6', exam_weight: data.exam_weight || 100, archived: 0, created_at: new Date().toISOString() });
      return { id, active_count: subjects.filter(item => !item.archived).length + 1, soft_cap_warning: subjects.filter(item => !item.archived).length + 1 >= 10 };
    }
    const id = Number(parts[1]);
    if (parts[2] === 'detail' && method === 'GET') return subjectDetail(id);
    if (parts[2] === 'units' && method === 'POST') {
      if (!await subjectById(id)) fail('Subject not found.', 404);
      const name = String(data.name || '').trim();
      if (!name) fail('Unit name is required.');
      const units = await all('units');
      return { id: await add('units', { subject_id: id, name, order_index: units.filter(item => item.subject_id === id).length + 1 }) };
    }
    const subject = await subjectById(id);
    if (!subject) fail('Subject not found.', 404);
    if (method === 'PATCH') {
      if (data.archived === 0 && subjects.filter(item => !item.archived).length >= 12) fail('Archive or remove an active subject before restoring this one.', 409);
      await put('subjects', { ...subject, ...data });
      return { updated: true };
    }
    if (method === 'DELETE') {
      if (!subject.archived) fail('Archive the subject before deleting it.', 409);
      const units = (await all('units')).filter(item => item.subject_id === id);
      const unitIds = new Set(units.map(item => item.id));
      const topics = (await all('topics')).filter(item => unitIds.has(item.unit_id));
      const topicIds = new Set(topics.map(item => item.id));
      const tasks = (await all('tasks')).filter(item => item.subject_id === id);
      const taskIds = new Set(tasks.map(item => item.id));
      for (const [store, items] of [
        ['units', units], ['topics', topics], ['tasks', tasks],
        ['exams', (await all('exams')).filter(item => item.subject_id === id)],
        ['review_items', (await all('review_items')).filter(item => topicIds.has(item.topic_id))],
        ['task_sessions', (await all('task_sessions')).filter(item => taskIds.has(item.task_id))],
        ['xp_events', (await all('xp_events')).filter(item => taskIds.has(item.ref_id))],
        ['prereqs', (await all('prereqs')).filter(item => topicIds.has(item.topic_id) || topicIds.has(item.prereq_topic_id))],
        ['task_dependencies', (await all('task_dependencies')).filter(item => taskIds.has(item.task_id) || taskIds.has(item.prereq_task_id))],
        ['flashcards', (await all('flashcards')).filter(item => topicIds.has(item.topic_id))]
      ]) {
        await Promise.all(items.map(item => remove(store, item.id)));
      }
      await remove('subjects', id);
      return {};
    }
  }
  if (parts[0] === 'units' && parts[2] === 'topics' && method === 'POST') {
    const unit = await byId('units', Number(parts[1]));
    if (!unit) fail('Unit not found.', 404);
    const name = String(data.name || '').trim();
    if (!name) fail('Topic name is required.');
    const topicId = await add('topics', { ...data, name, unit_id: unit.id, difficulty: Number(data.difficulty || 3), marks: Number(data.marks || 0), est_minutes: Number(data.est_minutes || 60), confidence: 1, notes: '' });
    await add('tasks', { topic_id: topicId, subject_id: unit.subject_id, type: 'read', title: `Read: ${name}`, est_minutes: Math.max(15, Number(data.est_minutes || 60)), status: 'pending', created_by: 'manual', actual_minutes: 0, priority_score: 0 });
    return { id: topicId };
  }
  if (parts[0] === 'topics' && method === 'PATCH') {
    const id = Number(parts[1]);
    const topic = await byId('topics', id);
    if (!topic) fail('Topic not found.', 404);
    await put('topics', { ...topic, ...data });
    return {};
  }
  if (parts[0] === 'exams') {
    if (parts.length === 1 && method === 'GET') return examsWithRisk();
    if (parts.length === 1 && method === 'POST') {
      if (!data.subject_id || !data.exam_date) fail('Subject and exam date are required.');
      const subject = await subjectById(data.subject_id);
      if (!subject || subject.archived) fail('Choose an active subject.', 404);
      if (!EXAM_TYPES.has(data.exam_type || 'final')) fail('Choose midterm, final, quiz, or practical.');
      return { id: await add('exams', { ...data, exam_type: data.exam_type || 'final', weightage: Number(data.weightage ?? 100), scope_unit_ids: data.scope_unit_ids || [], created_at: new Date().toISOString() }) };
    }
    const id = Number(parts[1]);
    if (method === 'DELETE') { await remove('exams', id); return {}; }
    if (method === 'PATCH') {
      const exam = await byId('exams', id);
      if (!exam) fail('Exam not found.', 404);
      await put('exams', { ...exam, ...data });
      return {};
    }
  }
  if (parts[0] === 'tasks') {
    if (parts.length === 1 && method === 'GET') return taskRows(Object.fromEntries(query.entries()));
    if (parts[1] === 'all' && method === 'GET') return taskRows();
    if (parts[1] === 'generate' && method === 'POST') {
      const subjectId = Number(parts[2]);
      const detail = await subjectDetail(subjectId);
      return { tasks: detail.units.flatMap(unit => unit.topics.map(topic => ({ topic_id: topic.id, subject_id: subjectId, type: 'read', title: `Read: ${topic.name}`, est_minutes: Math.max(15, topic.est_minutes), status: 'pending' }))) };
    }
    if (parts[1] === 'commit' && method === 'POST') {
      const created = [];
      for (const item of data.tasks || []) {
        if (!item.title || !TASK_TYPES.has(item.type || 'read') || !await subjectById(item.subject_id)) continue;
        const { id: ignoredId, ...taskData } = item;
        const id = await add('tasks', { ...taskData, type: item.type || 'read', est_minutes: Number(item.est_minutes || 30), status: 'pending', created_by: 'manual' });
        created.push([id, item.prereq_task_ids || []]);
      }
      for (const [taskId, ids] of created) for (const prerequisite of ids) await add('task_dependencies', { task_id: taskId, prereq_task_id: prerequisite });
      return { created: created.length };
    }
    if (parts[1] === 'bulk' && method === 'POST') {
      for (const taskId of data.task_ids || []) {
        const item = await byId('tasks', taskId);
        if (item) await put('tasks', { ...item, ...Object.fromEntries(['scheduled_date', 'est_minutes', 'status'].filter(key => key in data).map(key => [key, data[key]])) });
      }
      return { updated: (data.task_ids || []).length };
    }
    if (parts.length === 1 && method === 'POST') {
      if (!data.title || !data.subject_id) fail('Task title and subject are required.');
      if (!TASK_TYPES.has(data.type || 'read')) fail('Choose a supported task type.');
      const id = await add('tasks', { ...data, type: data.type || 'read', est_minutes: Number(data.est_minutes || 30), status: 'pending', actual_minutes: 0, priority_score: 0, created_by: 'manual' });
      return { id };
    }
    const id = Number(parts[1]);
    const task = await byId('tasks', id);
    if (!task) fail('Task not found.', 404);
    if (parts[2] === 'snooze' && method === 'POST') {
      const base = task.scheduled_date ? new Date(`${task.scheduled_date}T12:00:00`) : new Date();
      base.setDate(base.getDate() + Math.max(1, Math.min(30, Number(data.days || 1))));
      const scheduledDate = base.toISOString().slice(0, 10);
      await put('tasks', { ...task, scheduled_date: scheduledDate, status: 'pending' });
      return { scheduled_date: scheduledDate };
    }
    if (parts[2] === 'session' && method === 'POST') {
      const minutes = Number(data.minutes || 25);
      if (minutes < 1 || minutes > 240) fail('Session duration must be between 1 and 240 minutes.');
      const started = data.started_at || new Date().toISOString();
      const xp = data.completed === false ? 0 : Math.max(1, Math.floor(minutes / 5));
      const sessionId = await add('task_sessions', { task_id: id, started_at: started, ended_at: new Date().toISOString(), minutes });
      await put('tasks', { ...task, actual_minutes: Number(task.actual_minutes || 0) + minutes });
      if (xp) await add('xp_events', { amount: xp, reason: 'Pomodoro completed', ref_id: sessionId, created_at: new Date().toISOString() });
      return { minutes, xp_awarded: xp };
    }
    if (parts[2] === 'skip' && method === 'POST') {
      await put('tasks', { ...task, status: 'skipped', skip_reason: String(data.reason || '').trim() });
      return {};
    }
    if (method === 'PATCH') {
      const updated = { ...task, ...Object.fromEntries(['status', 'scheduled_date', 'actual_minutes', 'est_minutes'].filter(key => key in data).map(key => [key, data[key]])) };
      if (data.status === 'done' && task.status !== 'done') {
        updated.completed_at = new Date().toISOString();
        const points = { read: 10, notes: 10, practice: 15, pastpaper: 20, revise: 15, mocktest: 30, lab: 20, assignment: 20 }[task.type] || 10;
        const events = await all('xp_events');
        if (!events.some(item => item.reason === 'Task completed' && item.ref_id === id && item.amount > 0)) {
          await add('xp_events', { amount: points, reason: 'Task completed', ref_id: id, created_at: updated.completed_at });
        }
        if (task.type === 'read' && task.topic_id) {
          const [reviews, topic] = await Promise.all([all('review_items'), byId('topics', task.topic_id)]);
          if (topic && !reviews.some(item => item.topic_id === task.topic_id)) {
            for (const interval of [1, 3, 7]) {
              const due = new Date();
              due.setDate(due.getDate() + interval);
              const date = due.toISOString().slice(0, 10);
              await add('tasks', { topic_id: topic.id, subject_id: task.subject_id, type: 'revise', title: `Review: ${topic.name}`, est_minutes: 15, scheduled_date: date, due_date: date, is_revision: 1, status: 'pending', created_by: 'system' });
            }
            const due = new Date();
            due.setDate(due.getDate() + 1);
            await add('review_items', { topic_id: task.topic_id, ease: 2.5, interval_days: 1, next_review: due.toISOString().slice(0, 10), reps: 0 });
          }
        }
      } else if (data.status && data.status !== 'done' && task.status === 'done') {
        updated.completed_at = null;
        const events = await all('xp_events');
        const event = events.find(item => item.reason === 'Task completed' && item.ref_id === id && item.amount > 0);
        if (event && !events.some(item => item.reason === 'Task unchecked' && item.ref_id === id)) {
          await add('xp_events', { amount: -event.amount, reason: 'Task unchecked', ref_id: id, created_at: new Date().toISOString() });
        }
      } else if (data.status && data.status !== 'done') updated.completed_at = null;
      await put('tasks', updated);
      return updated;
    }
  }
  if (parts[0] === 'plan') {
    if (parts[1] === 'replan' && method === 'POST') return replan();
    if (parts[1] === 'week' || parts[1] === 'today') {
      const start = parts[1] === 'today' ? today() : query.get('start') || today();
      const result = await planWeek(start);
      if (parts[1] === 'today') {
        const day = result.days[0];
        return { date: day.date, capacity_minutes: day.capacity_minutes, planned_minutes: day.minutes_planned, groups: [], tasks: day.tasks, crunch: result.crunch, explanation: result.explanation };
      }
      return result;
    }
  }
  if (parts[0] === 'reviews') {
    if (parts[1] === 'queue' && method === 'GET') {
      const [reviews, topics, units, subjects] = await Promise.all([all('review_items'), all('topics'), all('units'), all('subjects')]);
      return reviews.filter(item => item.next_review <= today()).map(item => {
        const topic = topics.find(value => value.id === item.topic_id);
        const unit = units.find(value => value.id === topic?.unit_id);
        return { ...item, topic_name: topic?.name || '', back: topic?.notes || '', subject_name: subjects.find(value => value.id === unit?.subject_id)?.name || '' };
      });
    }
    if (method === 'POST') {
      const review = await byId('review_items', Number(parts[1]));
      if (!review) fail('Review not found.', 404);
      const quality = Math.max(0, Math.min(5, Number(data.quality || 3)));
      const ease = Math.max(1.3, Number(review.ease || 2.5) + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
      const interval = quality < 3 ? 1 : Number(review.reps) === 0 ? 1 : Number(review.reps) === 1 ? 6 : Math.max(1, Math.round(Number(review.interval_days) * ease));
      const next = new Date(`${today()}T12:00:00`); next.setDate(next.getDate() + interval);
      await put('review_items', { ...review, ease, interval_days: interval, next_review: next.toISOString().slice(0, 10), reps: Number(review.reps || 0) + 1 });
      return { next_review: next.toISOString().slice(0, 10), interval_days: interval, ease };
    }
  }
  if (parts[0] === 'profile' && method === 'GET') return profile();
  if (parts[0] === 'blackouts') {
    if (method === 'GET') return (await all('blackouts')).sort((a, b) => a.date.localeCompare(b.date));
    if (method === 'POST') {
      if (!data.date) fail('Choose a valid blackout date.');
      const items = await all('blackouts');
      if (items.some(item => item.date === data.date)) fail('That blackout date already exists.', 409);
      return { id: await add('blackouts', { date: data.date, reason: String(data.reason || '').slice(0, 200) }) };
    }
    if (method === 'DELETE') { await remove('blackouts', Number(parts[1])); return {}; }
  }
  if (parts[0] === 'stats') {
    if (parts[1] === 'overview') return overview();
    if (parts[1] === 'heatmap') return heatmap();
    if (parts[1] === 'calendar') return calendarMonth(query.get('month'));
    if (parts[1] === 'risk') return examsWithRisk();
  }
  if (parts[0] === 'extract' && parts[1] === 'commit' && method === 'POST') {
    const extraction = data.extraction || {};
    const result = await commitExtraction(extraction);
    return result;
  }
  if (parts[0] === 'export' && parts[1] === 'backup' && method === 'GET') return await IDB.exportAll();
  if (parts[0] === 'import' && parts[1] === 'backup' && method === 'POST') {
    if (!data || typeof data !== 'object' || !Array.isArray(data.subjects) || !Array.isArray(data.tasks)) fail('This is not a valid Maya backup.');
    const currentSettings = await settings();
    const importedSettings = data.settings?.[0] || {};
    await IDB.replaceAll({
      ...data,
      settings: [{ ...currentSettings, ...importedSettings, gemini_api_key: currentSettings.gemini_api_key, id: 1 }]
    });
    return {};
  }
  fail(`Unsupported local request: ${method} ${path}`, 404);
}

async function commitExtraction(extraction) {
  const subjects = extraction.subjects || [];
  const existing = (await all('subjects')).filter(subject => !subject.archived).length;
  if (existing + subjects.length > 12) fail('Maya supports up to 12 active subjects. Archive one first.', 409);
  const ids = [];
  for (const source of subjects) {
    const subjectId = await add('subjects', { name: source.name.trim(), code: source.code || null, color: '#5B5BD6', credits: source.credits ?? null, exam_weight: 100, archived: 0, created_at: new Date().toISOString() });
    ids.push(subjectId);
    const topicIds = new Map();
    const unitRows = [];
    for (const [index, unit] of [...(source.units || [])].sort((a, b) => Number(a.order || 0) - Number(b.order || 0)).entries()) {
      const unitId = await add('units', { subject_id: subjectId, name: unit.name.trim(), order_index: unit.order ?? index });
      const topicRows = [];
      for (const topic of unit.topics || []) {
        const topicId = await add('topics', { unit_id: unitId, name: topic.name.trim(), difficulty: Number(topic.difficulty || 3), marks: Number(topic.marks || 0), est_minutes: Math.max(15, Math.round(Number(topic.est_hours || 1) * 60)), confidence: Number(topic.confidence ?? 0.8), notes: '', parent_topic_id: null });
        topicIds.set(topic.name.toLowerCase(), topicId);
        topicRows.push({ ...topic, id: topicId, name: topic.name });
        for (const subtopic of topic.subtopics || []) {
          const subtopicId = await add('topics', { unit_id: unitId, parent_topic_id: topicId, name: subtopic.trim(), difficulty: Number(topic.difficulty || 3), marks: 0, est_minutes: Math.max(15, Math.round(Number(topic.est_hours || 1) * 30)), confidence: Number(topic.confidence ?? 0.8), notes: '' });
          topicIds.set(subtopic.toLowerCase(), subtopicId);
          topicRows.push({ id: subtopicId, name: subtopic.trim(), difficulty: topic.difficulty, marks: 0, est_hours: Number(topic.est_hours || 1) / 2, prerequisites: [], subtopics: [] });
        }
      }
      unitRows.push({ id: unitId, name: unit.name, topics: topicRows });
    }
    for (const unit of unitRows) {
      for (const topic of unit.topics) {
        for (const prerequisiteName of topic.prerequisites || []) {
          const prerequisiteId = topicIds.get(prerequisiteName.toLowerCase());
          if (prerequisiteId && prerequisiteId !== topic.id) {
            await add('prereqs', { topic_id: topic.id, prereq_topic_id: prerequisiteId });
          }
        }
      }
    }
    const readTaskIds = new Map();
    for (const unit of unitRows) {
      const readTasks = new Map();
      for (const topic of unit.topics) {
        const taskId = await add('tasks', { topic_id: topic.id, subject_id: subjectId, type: 'read', title: `Read: ${topic.name}`, est_minutes: Math.max(15, Math.round(Number(topic.est_hours || 1) * 60 / 5) * 5), priority_score: 0, status: 'pending', created_by: 'ai' });
        readTasks.set(topic.id, taskId);
        readTaskIds.set(topic.id, taskId);
      }
      if (!unit.topics.length) continue;
      const totalHours = unit.topics.reduce((sum, topic) => sum + Number(topic.est_hours || 1), 0);
      const notesId = await add('tasks', { subject_id: subjectId, type: 'notes', title: `Make notes: ${unit.name}`, est_minutes: Math.max(15, Math.round(totalHours * 18 / 5) * 5), status: 'pending', created_by: 'ai' });
      for (const readId of readTasks.values()) await add('task_dependencies', { task_id: notesId, prereq_task_id: readId });
      if (unit.topics.some(topic => Number(topic.difficulty || 3) >= 3)) {
        const practiceId = await add('tasks', { subject_id: subjectId, type: 'practice', title: `Practice: ${unit.name}`, est_minutes: Math.max(15, Math.round(totalHours * 30 / 5) * 5), status: 'pending', created_by: 'ai' });
        await add('task_dependencies', { task_id: practiceId, prereq_task_id: notesId });
      }
    }
    for (const unit of unitRows) {
      for (const topic of unit.topics) {
        const taskId = readTaskIds.get(topic.id);
        for (const prereqName of topic.prerequisites || []) {
          const prerequisiteTopicId = topicIds.get(prereqName.toLowerCase());
          const prerequisiteTaskId = readTaskIds.get(prerequisiteTopicId);
          if (taskId && prerequisiteTaskId) {
            await add('task_dependencies', { task_id: taskId, prereq_task_id: prerequisiteTaskId });
          }
        }
      }
    }
  }
  return { subject_ids: ids, active_subjects: existing + ids.length, soft_cap_warning: existing + ids.length >= 10, warnings: extraction.warnings || [] };
}

export async function localApi(path, options = {}) {
  const url = new URL(path, location.origin);
  const method = (options.method || 'GET').toUpperCase();
  return dispatch(url.pathname, method, options, url.searchParams);
}

export async function localBackupBlob() {
  return new Blob([JSON.stringify(await IDB.exportAll(), null, 2)], { type: 'application/json' });
}
