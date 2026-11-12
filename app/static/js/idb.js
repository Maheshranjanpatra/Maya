const DB = 'maya-local';
const VERSION = 2;
let db;

export const IDB = {
  async init() {
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('tasks')) {
          database.createObjectStore('tasks', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('subjects')) {
          database.createObjectStore('subjects', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('queue')) {
          database.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
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

  write(store, operation, value) {
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readwrite').objectStore(store)[operation](value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
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
