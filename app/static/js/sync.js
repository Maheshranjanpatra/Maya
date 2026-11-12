import { api } from './api.js';
import { IDB } from './idb.js';

const chip = document.querySelector('#offline-chip');
const network = document.querySelector('#network-status');

export async function updateStatus() {
  const count = await IDB.getQueueCount();
  chip.hidden = count === 0 && navigator.onLine;
  chip.textContent = count
    ? `${count} local change${count === 1 ? '' : 's'}`
    : 'Offline — your data stays on this device';
  network.textContent = navigator.onLine ? '' : 'Offline';
}

export async function queuedPatch(url, body, optimistic = () => {}) {
  return queuedRequest(url, 'PATCH', body, optimistic);
}

export async function queuedRequest(url, method, body, optimistic = () => {}) {
  optimistic();
  return api(url, { method, body: JSON.stringify(body) });
}

export async function applyPendingLocalWrites() {
  for (const queued of await IDB.getQueue()) {
    await api(queued.url, {
      method: queued.method,
      body: queued.body == null ? undefined : JSON.stringify(queued.body)
    });
    await IDB.clearQueueItem(queued.id);
  }
}

window.addEventListener('online', updateStatus);
window.addEventListener('offline', updateStatus);
