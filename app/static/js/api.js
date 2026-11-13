import { IDB } from './idb.js';
import { localApi, LocalApiError } from './local-api.js';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api(url, options = {}) {
  if (!url.startsWith('/api/ai/') && url !== '/api/upload') {
    try {
      return await localApi(url, options);
    } catch (error) {
      if (error instanceof LocalApiError) throw new ApiError(error.message, error.status);
      throw error;
    }
  }

  const settings = (await IDB.get('settings', 1)) || {};
  const headers = { ...options.headers };
  const apiKey = settings.ai_api_key || settings.gemini_api_key;
  if (apiKey) headers['X-AI-Api-Key'] = apiKey;
  if (settings.ai_model) headers['X-AI-Model'] = settings.ai_model;

  if (url === '/api/ai/explain' || url === '/api/ai/flashcards' || url === '/api/ai/quickadd') {
    const body = JSON.parse(options.body || '{}');
    if (url === '/api/ai/quickadd') {
      body.subjects = (await IDB.getAllSubjects()).filter(subject => !subject.archived).map(subject => subject.name);
    } else {
      const topic = (await IDB.all('topics')).find(item => item.id === Number(body.topic_id));
      if (!topic) throw new ApiError('Topic not found.', 404);
      body.topic = { name: topic.name, notes: topic.notes || '' };
      if (url === '/api/ai/flashcards') {
        const cards = (await IDB.all('flashcards')).filter(item => item.topic_id === topic.id);
        if (cards.length) return cards.map(({ front, back }) => ({ front, back }));
      }
    }
    options = { ...options, body: JSON.stringify(body) };
  }
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const response = await fetch(url, { ...options, headers });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(`Request failed (${response.status}).`, response.status);
  }
  if (!response.ok || payload.ok === false) {
    throw new ApiError(
      payload.error || `Request failed (${response.status}).`,
      response.status
    );
  }
  if (url === '/api/ai/flashcards' && Array.isArray(payload.data)) {
    const topicId = Number(JSON.parse(options.body).topic_id);
    for (const card of payload.data) {
      if (card.front && card.back) {
        await IDB.write('flashcards', 'add', { topic_id: topicId, front: card.front, back: card.back, created_at: new Date().toISOString() });
      }
    }
  }
  return payload.data;
}
