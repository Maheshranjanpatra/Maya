export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api(url, options = {}) {
  const key = localStorage.getItem('maya-lock-key') || '';
  const headers = {
    'X-Web-Lock-Key': key,
    ...options.headers
  };
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

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
  return payload.data;
}
