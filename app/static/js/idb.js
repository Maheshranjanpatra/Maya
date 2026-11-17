const DB = 'maya-local';
const VERSION = 4;
const STORES = [
  'tasks',
  'subjects',
  'units',
  'topics',
  'prereqs',
  'task_dependencies',
  'exams',
  'blackouts',
  'review_items',
  'task_sessions',
  'xp_events',
  'badges',
  'settings',
  'flashcards',
  'queue'
];
let db;

export const IDB = {
  async init() {
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, VERSION);
      request.onupgradeneeded = event => {
        const database = request.result;
        for (const store of STORES) {
          if (!database.objectStoreNames.contains(store)) {
            database.createObjectStore(store, { keyPath: 'id', autoIncrement: store !== 'settings' });
          } else if (['tasks', 'subjects'].includes(store)) {
            const existing = event.target.transaction.objectStore(store);
            if (!existing.autoIncrement) {
              const records = existing.getAll();
              records.onsuccess = () => {
                const values = records.result;
                database.deleteObjectStore(store);
                const replacement = database.createObjectStore(store, { keyPath: 'id', autoIncrement: true });
                for (const value of values) replacement.put(value);
              };
            }
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  all(store) {
    return new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  get(store, key) {
    return new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  write(store, operation, value) {
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readwrite').objectStore(store)[operation](value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  batch(operations) {
    return new Promise((resolve, reject) => {
      const stores = [...new Set(operations.map(item => item.store))];
      const transaction = db.transaction(stores, 'readwrite');
      const requests = [];
      for (const [index, item] of operations.entries()) {
        if (typeof item.value === 'function') {
          const dependency = requests[item.dependsOn];
          if (!dependency) {
            transaction.abort();
            reject(new Error('A batched write depends on a missing request.'));
            return;
          }
          dependency.onsuccess = () => {
            requests[index] = transaction.objectStore(item.store)[item.operation](item.value(dependency.result));
          };
        } else {
          requests[index] = transaction.objectStore(item.store)[item.operation](item.value);
        }
      }
      transaction.oncomplete = () => resolve(requests.map(request => request.result));
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  },

  async clear(store) {
    await this.write(store, 'clear');
  },

  async replaceAll(data) {
    const stores = STORES.filter(store => store !== 'queue');
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(stores, 'readwrite');
      for (const store of stores) {
        const objectStore = transaction.objectStore(store);
        objectStore.clear();
        for (const item of data[store] || []) objectStore.put(item);
      }
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  },

  async exportAll() {
    const result = {};
    for (const store of STORES.filter(name => name !== 'queue')) {
      result[store] = await this.all(store);
    }
    result.settings = result.settings.map(({ ai_api_key, gemini_api_key, web_lock_key, ...item }) => item);
    return result;
  },

  getAllTasks() { return this.all('tasks'); },
  putTask(task) { return this.write('tasks', 'put', task); },
  deleteTask(id) { return this.write('tasks', 'delete', id); },
  getAllSubjects() { return this.all('subjects'); },
  putSubject(subject) { return this.write('subjects', 'put', subject); },
  enqueueWrite(write) {
    return this.write('queue', 'add', { ...write, createdAt: Date.now() });
  },
  getQueue() { return this.all('queue'); },
  clearQueueItem(id) { return this.write('queue', 'delete', id); },
  async getQueueCount() { return (await this.getQueue()).length; }
};
