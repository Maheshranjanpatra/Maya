const CACHE = 'maya-shell-v10';
const SHELL = [
  '/',
  '/static/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/icons/favicon.svg',
  '/static/icons/favicon.ico',
  '/static/icons/favicon-16x16.png',
  '/static/icons/favicon-32x32.png',
  '/static/icons/apple-touch-icon.png',
  '/static/css/tokens.css',
  '/static/css/base.css',
  '/static/css/components.css',
  '/static/css/layout.css',
  '/static/css/views.css',
  '/static/js/app.js',
  '/static/js/api.js',
  '/static/js/idb.js',
  '/static/js/local-api.js',
  '/static/js/sync.js',
  '/static/js/components/dom.js',
  '/static/js/components/icons.js',
  '/static/js/components/modal.js',
  '/static/js/components/nav.js',
  '/static/js/components/sidebar.js',
  '/static/js/components/task-card.js',
  '/static/js/components/toast.js',
  '/static/js/components/theme.js',
  '/static/js/components/visuals.js',
  '/static/js/features/palette.js',
  '/static/js/features/quickadd.js',
  '/static/js/features/timer.js',
  '/static/js/views/calendar.js',
  '/static/js/views/exams.js',
  '/static/js/views/help.js',
  '/static/js/views/plan.js',
  '/static/js/views/profile.js',
  '/static/js/views/reviews.js',
  '/static/js/views/settings.js',
  '/static/js/views/syllabus.js',
  '/static/js/views/tasks.js',
  '/static/js/views/visuals.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(name => name.startsWith('maya-shell-') && name !== CACHE)
          .map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/'))
    );
    return;
  }

  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
  }
});
