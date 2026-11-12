import { ApiError, api } from './api.js';
import { IDB } from './idb.js';
import { toast } from './components/toast.js';

const chip = document.querySelector('#offline-chip');
const network = document.querySelector('#network-status');
let syncing = false;

async function updateStatus() {
  const count = await IDB.getQueueCount();
  chip.hidden = navigator.onLine && count === 0;
  chip.textContent = count
    ? `${count} saved change${count === 1 ? '' : 's'} waiting to sync`
    : 'Offline — changes stay on this device';
  network.textContent = navigator.onLine ? '' : 'Offline';
}

export async function flush() {
  if (!navigator.onLine || syncing) {
    await updateStatus();
    return;
  }
  syncing = true;
  try {
    for (const queued of await IDB.getQueue()) {
      try {
        await api(queued.url, {
          method: queued.method,
          body: queued.body == null ? undefined : JSON.stringify(queued.body)
        });
        await IDB.clearQueueItem(queued.id);
      } catch (error) {
        if (error instanceof ApiError) {
          toast(`A saved change could not sync: ${error.message}`);
        }
        break;
      }
    }
  } finally {
    syncing = false;
    await updateStatus();
  }
}

export async function queuedPatch(url, body, optimistic = () => {}) {
  return queuedRequest(url, 'PATCH', body, optimistic);
}

export async function queuedRequest(url, method, body, optimistic = () => {}) {
  optimistic();
  if (!navigator.onLine) {
    await IDB.enqueueWrite({ method, url, body });
    await updateStatus();
    return { queued: true };
  }
  try {
    return await api(url, { method, body: JSON.stringify(body) });
  } catch (error) {
    if (!(error instanceof TypeError) && navigator.onLine) throw error;
    await IDB.enqueueWrite({ method, url, body });
    await updateStatus();
    return { queued: true };
  }
}

window.addEventListener('online', flush);
window.addEventListener('offline', updateStatus);
