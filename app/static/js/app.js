import { nav, activateNav } from './components/nav.js';
import { sidebar } from './components/sidebar.js';
import { IDB } from './idb.js';
import { applyPendingLocalWrites, updateStatus } from './sync.js';
import { api } from './api.js';
import { quickadd } from './features/quickadd.js';
import { palette } from './features/palette.js';
import { toast } from './components/toast.js';
import { applyTheme } from './components/theme.js';

const viewNames = [
  'tasks', 'syllabus', 'visuals', 'profile', 'reviews',
  'plan', 'exams', 'calendar', 'settings', 'help'
];
const views = Object.fromEntries(
  await Promise.all(viewNames.map(async name => [
    name,
    await import(`./views/${name}.js`)
  ]))
);

let activeView;
let installPrompt;
let routeGeneration = 0;

async function route() {
  const generation = ++routeGeneration;
  const requested = (location.hash.slice(2) || 'tasks').split('/')[0];
  const name = viewNames.includes(requested) ? requested : 'tasks';
  activeView = name;
  activateNav(name);
  const container = document.querySelector('#view-container');
  container.innerHTML = '<div class="skeleton skeleton-title"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div>';
  const viewContainer = document.createElement('div');
  viewContainer.className = 'view-content';
  try {
    await views[name].render(viewContainer);
    if (generation !== routeGeneration) return;
    container.replaceChildren(viewContainer);
  } catch (error) {
    if (generation !== routeGeneration) return;
    container.innerHTML = '<section class="card empty-state"><h2>This view could not load</h2><p class="muted"></p><button class="button button-quiet" data-retry>Try again</button></section>';
    container.querySelector('.muted').textContent = error.message;
    container.querySelector('[data-retry]').addEventListener('click', route);
  }
  container.focus({ preventScroll: true });
}

async function setupApp() {
  nav();
  sidebar();
  quickadd();
  palette();
  await IDB.init();
  try {
    await applyPendingLocalWrites();
  } catch (error) {
    toast(`A locally saved change could not be applied: ${error.message}`);
  }

  try {
    const data = await api('/api/settings');
    applyTheme(data.settings.theme || 'auto');
    const sidebarProfile = document.querySelector('#sidebar-progress');
    const profile = await api('/api/profile');
    sidebarProfile.innerHTML = `<span>Level ${profile.level}</span><span>${profile.xp_total} XP</span>`;
  } catch (error) {
    applyTheme('auto');
    toast(error.message);
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('maya:refresh', () => {
    if (activeView) route();
  });
  if (!location.hash) location.hash = '#/tasks';
  else await route();

  try {
    await api('/api/plan/replan', { method: 'POST', body: '{}' });
  } catch (error) {
    toast(error.message);
  }
  updateStatus();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
      updateViaCache: 'none'
    }).then(registration => {
      let updatePromptShown = false;
      let updateCheckRunning = false;
      let updateCheckFailed = false;

      const showUpdatePrompt = worker => {
        if (updatePromptShown || !navigator.serviceWorker.controller) return;
        updatePromptShown = true;
        toast('App updated. Tap Update to load the latest version.', {
          action: () => (registration.waiting || worker).postMessage({ type: 'SKIP_WAITING' }),
          label: 'Update',
          duration: 0,
          variant: 'update'
        });
      };

      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      if (registration.waiting) showUpdatePrompt(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') showUpdatePrompt(worker);
        });
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !navigator.onLine || updateCheckRunning) return;
        updateCheckRunning = true;
        registration.update()
          .then(() => { updateCheckFailed = false; })
          .catch(error => {
            if (!updateCheckFailed) console.warn('Maya update check failed:', error);
            updateCheckFailed = true;
          })
          .finally(() => { updateCheckRunning = false; });
      });
    }).catch(() => {
      toast('Offline support could not start. Reload Maya when you are online.');
    });
  }
}

document.addEventListener('keydown', event => {
  if (
    !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
    && ['1', '2', '3', '4', '5'].includes(event.key)
  ) {
    location.hash = `#/${['tasks', 'syllabus', 'visuals', 'profile', 'help'][Number(event.key) - 1]}`;
  }
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  document.querySelector('#install-banner').hidden = false;
});
document.querySelector('[data-install]').addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  document.querySelector('#install-banner').hidden = true;
});
document.querySelector('[data-dismiss]').addEventListener('click', () => {
  document.querySelector('#install-banner').hidden = true;
});

setupApp().catch(error => {
  console.error('Maya failed to start:', error);
  const container = document.querySelector('#view-container');
  container.innerHTML = '<section class="card empty-state" role="alert"><h2>Maya could not start</h2><p class="muted"></p><button class="button button-quiet" data-retry>Reload Maya</button></section>';
  container.querySelector('.muted').textContent = error.message || 'An unexpected startup error occurred.';
  container.querySelector('[data-retry]').addEventListener('click', () => location.reload());
});
