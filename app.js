/* =====================================================
   MAYA - Habit & Task Tracker
   Offline-first • Neon dark • Strong philosophical companion
   ===================================================== */

(() => {
  'use strict';

  // -------------------- STATE --------------------
  const DEFAULT_STATE = {
    profile: {
      name: 'My Love',
      joined: new Date().toISOString().slice(0, 10)
    },
    xp: 0,
    level: 1,
    habits: [],
    todos: [],
    settings: {
      streakFreezes: 2,
      maxFreezes: 2,
      soundEnabled: true,
      
      vibrationEnabled: true,
      lastQuoteTime: 0
    },
    badges: [],
    moodHistory: [],
    lastDailyReset: new Date().toDateString()
  };

  let state = loadState();
  let currentTab = 'habits';
  let charts = { streak: null, tasks: null };
  let audioCtx = null;
  let confettiParticles = [];
  let confettiRunning = false;

  // -------------------- QUOTES (Strong Philosophical) --------------------
  const QUOTES = [
    "You cannot become more if you continue doing only what you already are.",
    "Choose your pain. The pain of discipline, or the pain of regret.",
    "Discipline is the bridge between goals and accomplishment.",
    "A man who cannot command himself will forever be commanded by others.",
    "The obstacle is the way. What stands in the way becomes the way.",
    "He who has a why to live can bear almost any how.",
    "Do not pray for an easy life. Pray for the strength to endure a difficult one.",
    "We suffer more in imagination than in reality.",
    "It is not the man who has too little, but the man who craves more, that is poor.",
    "The best revenge is not to be like your enemy.",
    "Waste no more time arguing what a good man should be. Be one.",
    "You have power over your mind, not outside events. Realize this, and you will find strength.",
    "No man is free who is not master of himself.",
    "First say to yourself what you would be; and then do what you have to do.",
    "The happiness of your life depends upon the quality of your thoughts.",
    "It is not death that a man should fear, but he should fear never beginning to live.",
    "Be tolerant with others and strict with yourself.",
    "What we do now echoes in eternity.",
    "A gem cannot be polished without friction, nor a man perfected without trials.",
    "The greater the difficulty, the more glory in surmounting it."
  ];

  // -------------------- HELPERS --------------------
  function loadState() {
    try {
      const raw = localStorage.getItem('maya_state');
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_STATE, ...parsed, settings: { ...DEFAULT_STATE.settings, ...parsed.settings } };
      }
    } catch (e) {}
    return structuredClone(DEFAULT_STATE);
  }

  function saveState() {
    localStorage.setItem('maya_state', JSON.stringify(state));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function todayStr() {
    return new Date().toDateString();
  }

  function isToday(dateStr) {
    return dateStr === todayStr();
  }

  function getLevelThreshold(level) {
    // Progressive difficulty
    return Math.floor(100 * Math.pow(1.45, level - 1));
  }

  function xpForNextLevel() {
    return getLevelThreshold(state.level);
  }

  function checkLevelUp() {
    let leveled = false;
    while (state.xp >= xpForNextLevel()) {
      state.xp -= xpForNextLevel();
      state.level += 1;
      leveled = true;

      if (state.level % 8 === 0) {
        showSpecialModal(`
          <div class="mb-4 flex justify-center animate-float">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="1.5">
              <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2M7 2v20M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>
            </svg>
          </div>
          <h2 class="font-outfit text-2xl font-bold text-maya-flame mb-2">Level ${state.level}!</h2>
          <p class="text-slate-300 leading-relaxed">You've come so far... How about we go out for dinner sometime soon? My treat. You've earned every bit of celebration.</p>
        `);
        
      } else {
        showToast(`Level ${state.level} reached.`);
        
      }
      triggerConfetti();
    }
    if (leveled) saveState();
  }

  // -------------------- AUDIO & VOICE --------------------
  function initAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  function playChime(type = 'complete') {
    if (!state.settings.soundEnabled) return;
    initAudio();
    const now = audioCtx.currentTime;

    const notes = {
      complete: [523.25, 659.25, 783.99],      // C5 E5 G5
      task: [440, 554.37],
      alarm: [880, 987.77, 880],
      level: [523.25, 659.25, 783.99, 1046.5]
    }[type] || [523.25, 659.25];

    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02 + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4 + i * 0.1);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + i * 0.08);
      osc.stop(now + 0.5 + i * 0.1);
    });
  }

  function vibrate(pattern = [30]) {
    if (state.settings.vibrationEnabled && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }

  // -------------------- NOTIFICATIONS --------------------
  async function requestNotificationPermission() {
    if (!('Notification' in window)) {
      showToast('Notifications not supported on this device');
      return false;
    }
    if (Notification.permission === 'granted') return true;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  async function showNotification(title, body) {
    if (Notification.permission !== 'granted') return;

    // Prefer Service Worker notification (works better on Android)
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, {
          body,
          icon: 'logo.png',
          badge: 'icon-192.png',
          vibrate: [100, 50, 100],
          tag: 'maya-alert',
          renotify: true,
          requireInteraction: false
        });
        return;
      } catch (e) {}
    }

    // Fallback
    try {
      const n = new Notification(title, {
        body,
        icon: 'logo.png',
        badge: 'icon-192.png',
        vibrate: [80, 40, 80],
        tag: 'maya-alert'
      });
      n.onclick = () => { window.focus(); n.close(); };
    } catch (e) {}
  }

  // Alarm checker (every 10s)
  setInterval(() => {
    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5);
    state.todos.forEach(todo => {
      if (!todo.completed && todo.alarm === hhmm && !todo.alarmTriggered) {
        todo.alarmTriggered = true;
        saveState();
        playChime('alarm');
        vibrate([100, 50, 100, 50, 100]);
        showNotification('Maya', `Time for: ${todo.title}. You've got this.`);
        
        showToast(`Alarm: ${todo.title}`);
      }
    });
  }, 10000);

  // -------------------- CONFETTI --------------------
  function triggerConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#10b981', '#22d3ee', '#f97316', '#f472b6', '#a78bfa', '#fbbf24'];
    for (let i = 0; i < 120; i++) {
      confettiParticles.push({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * 100,
        r: 4 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        speed: 2 + Math.random() * 4,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.2
      });
    }
    if (!confettiRunning) {
      confettiRunning = true;
      requestAnimationFrame(confettiLoop);
    }
  }

  function confettiLoop() {
    const canvas = document.getElementById('confettiCanvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    confettiParticles = confettiParticles.filter(p => {
      p.y += p.speed;
      p.x += Math.sin(p.angle) * 1.5;
      p.angle += p.spin;
      ctx.beginPath();
      ctx.fillStyle = p.color;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      return p.y < canvas.height + 20;
    });

    if (confettiParticles.length > 0) {
      requestAnimationFrame(confettiLoop);
    } else {
      confettiRunning = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  // -------------------- UI HELPERS --------------------
  function showToast(msg, duration = 2800) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), duration);
  }

  function showModal(html) {
    const modal = document.getElementById('modal');
    const content = document.getElementById('modalContent');
    content.innerHTML = html;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeModal() {
    const modal = document.getElementById('modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  function showSpecialModal(html) {
    document.getElementById('specialContent').innerHTML = html;
    const m = document.getElementById('specialModal');
    m.classList.remove('hidden');
    m.classList.add('flex');
  }

  function closeSpecial() {
    const m = document.getElementById('specialModal');
    m.classList.add('hidden');
    m.classList.remove('flex');
  }

  // -------------------- ANIME GIRL SVG (original) --------------------
  function animeGirlSVG(size = 56) {
    return `
    <svg width="${size}" height="${size}" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill="#0f172a"/>
      <ellipse cx="50" cy="58" rx="28" ry="32" fill="#fce7f3"/>
      <path d="M22 45 Q30 15 50 18 Q70 15 78 45 Q75 30 50 28 Q25 30 22 45" fill="#1e293b"/>
      <path d="M25 48 Q35 22 50 24 Q65 22 75 48" fill="#334155"/>
      <ellipse cx="38" cy="52" rx="5" ry="6" fill="#1e293b"/>
      <ellipse cx="62" cy="52" rx="5" ry="6" fill="#1e293b"/>
      <circle cx="39" cy="51" r="2" fill="white"/>
      <circle cx="63" cy="51" r="2" fill="white"/>
      <path d="M44 62 Q50 67 56 62" stroke="#f9a8d4" stroke-width="2" stroke-linecap="round" fill="none"/>
      <ellipse cx="32" cy="60" rx="4" ry="2.5" fill="#fda4af" opacity="0.6"/>
      <ellipse cx="68" cy="60" rx="4" ry="2.5" fill="#fda4af" opacity="0.6"/>
    </svg>`;
  }

  // -------------------- RENDER FUNCTIONS --------------------
  function render() {
    // Daily reset check
    if (state.lastDailyReset !== todayStr()) {
      state.habits.forEach(h => {
        if (h.completedToday) {
          h.streak = (h.streak || 0) + 1;
        } else if (h.streak > 0) {
          // check freeze
          if (state.settings.streakFreezes > 0) {
            state.settings.streakFreezes -= 1;
            showToast('Streak freeze used. Your discipline was protected.');
          } else {
            h.streak = 0;
          }
        }
        h.completedToday = false;
      });
      state.lastDailyReset = todayStr();
      saveState();
    }

    document.getElementById('profileName').textContent = state.profile.name;
    document.getElementById('sideLevel').textContent = state.level;
    document.getElementById('sideXP').textContent = state.xp;
    // Use the user-provided avatar image
    document.getElementById('sideAvatar').innerHTML = `<img src="avatar.png" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:20px;">`;

    const main = document.getElementById('mainContent');
    if (currentTab === 'habits') main.innerHTML = renderHabits();
    else if (currentTab === 'todos') main.innerHTML = renderTodos();
    else if (currentTab === 'visuals') main.innerHTML = renderVisuals();
    else if (currentTab === 'settings') main.innerHTML = renderSettings();

    attachEventListeners();
    if (currentTab === 'visuals') initCharts();
  }

  function renderHabits() {
    const completed = state.habits.filter(h => h.completedToday).length;
    const total = state.habits.length || 1;
    const percent = Math.round((completed / total) * 100);
    const radius = 45;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100) * circumference;

    let list = state.habits.map(h => {
      const strength = Math.min(100, (h.streak || 0) * 8 + (h.totalCompletions || 0));
      return `
      <div class="habit-card bg-maya-card border border-maya-border rounded-2xl p-4 mb-3 card-glow ${h.completedToday ? 'completed' : ''}" data-id="${h.id}">
        <div class="flex items-center gap-3">
          <button class="check-btn w-10 h-10 rounded-xl border-2 flex items-center justify-center transition ${h.completedToday ? 'bg-maya-neon border-maya-neon text-maya-bg' : 'border-maya-border text-transparent'}">
            <svg class="w-5 h-5 ${h.completedToday ? 'check-bounce' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>
          </button>
          <div class="flex-1 min-w-0">
            <div class="habit-title font-semibold truncate">${h.title}</div>
            <div class="flex items-center gap-2 mt-1 text-xs text-slate-400">
              <span class="flex items-center gap-1">
                <svg class="w-3.5 h-3.5 text-maya-flame flame-icon" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.503A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 018 13a3 3 0 014.12 2.12z" clip-rule="evenodd"/></svg>
                ${h.streak || 0}
              </span>
              <span>• ${h.frequency}</span>
            </div>
            <div class="mt-2 h-1.5 bg-maya-bg rounded-full overflow-hidden">
              <div class="h-full bg-gradient-to-r from-maya-neon to-maya-neon2 rounded-full" style="width:${strength}%"></div>
            </div>
          </div>
          <button class="delete-habit p-2 text-slate-500 hover:text-red-400">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>`;
    }).join('') || `<p class="text-center text-slate-500 py-10">No habits yet. Begin.</p>`;

    return `
      <div class="mb-6">
        <div class="bg-maya-card border border-maya-border rounded-3xl p-5 flex items-center gap-5 card-glow">
          <div class="relative w-24 h-24">
            <svg class="w-24 h-24 progress-ring" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" fill="none" stroke="#1e293b" stroke-width="8"/>
              <circle class="progress-ring-circle" cx="50" cy="50" r="45" fill="none" stroke="url(#grad)" stroke-width="8"
                stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
              <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#10b981"/>
                  <stop offset="100%" stop-color="#22d3ee"/>
                </linearGradient>
              </defs>
            </svg>
            <div class="absolute inset-0 flex items-center justify-center font-outfit font-bold text-xl neon-text">${percent}%</div>
          </div>
          <div>
            <div class="text-sm text-slate-400">Today's Progress</div>
            <div class="font-outfit text-2xl font-bold">${completed} / ${state.habits.length}</div>
            <div class="text-xs text-maya-neon mt-1">Discipline compounds</div>
          </div>
        </div>
      </div>

      <div class="flex justify-between items-center mb-3">
        <h2 class="font-outfit font-bold text-lg">Your Habits</h2>
        <button id="addHabitBtn" class="px-4 py-2 rounded-xl bg-maya-neon text-maya-bg font-semibold text-sm active:scale-95 transition shadow-neon">
          + Add
        </button>
      </div>
      ${list}
    `;
  }

  function renderTodos() {
    const filter = window._todoFilter || 'all';
    let list = state.todos;
    if (filter === 'pending') list = list.filter(t => !t.completed);
    if (filter === 'completed') list = list.filter(t => t.completed);

    const items = list.map(t => `
      <div class="todo-card bg-maya-card border border-maya-border rounded-2xl p-4 mb-3 card-glow ${t.completed ? 'opacity-60' : ''}" data-id="${t.id}">
        <div class="flex items-start gap-3">
          <button class="todo-check mt-0.5 w-9 h-9 rounded-xl border-2 flex items-center justify-center transition ${t.completed ? 'bg-maya-neon border-maya-neon text-maya-bg' : 'border-maya-border'}">
            <svg class="w-4 h-4 ${t.completed ? 'check-bounce' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>
          </button>
          <div class="flex-1 min-w-0">
            <div class="font-semibold ${t.completed ? 'line-through text-slate-400' : ''}">${t.title}</div>
            <div class="flex flex-wrap gap-2 mt-1.5">
              <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold badge-${t.priority}">${t.priority}</span>
              ${t.alarm ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-maya-bg text-maya-neon2 border border-maya-neon2/30">${t.alarm}</span>` : ''}
            </div>
          </div>
          <button class="delete-todo p-2 text-slate-500 hover:text-red-400">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
    `).join('') || `<p class="text-center text-slate-500 py-10">No tasks here yet.</p>`;

    return `
      <div class="flex gap-2 mb-4 overflow-x-auto pb-1">
        ${['all', 'pending', 'completed'].map(f => `
          <button class="filter-chip px-4 py-1.5 rounded-full text-sm font-semibold border border-maya-border whitespace-nowrap ${filter === f ? 'active' : 'text-slate-400'}" data-filter="${f}">
            ${f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        `).join('')}
      </div>
      <div class="flex justify-between items-center mb-3">
        <h2 class="font-outfit font-bold text-lg">Tasks</h2>
        <button id="addTodoBtn" class="px-4 py-2 rounded-xl bg-maya-neon text-maya-bg font-semibold text-sm active:scale-95 transition shadow-neon">+ Add</button>
      </div>
      ${items}
    `;
  }

  function renderVisuals() {
    return `
      <div class="space-y-6">
        <div class="bg-maya-card border border-maya-border rounded-3xl p-5 card-glow">
          <h3 class="font-outfit font-bold mb-4 text-maya-neon">Habit Streaks</h3>
          <canvas id="streakChart" height="200"></canvas>
        </div>
        <div class="bg-maya-card border border-maya-border rounded-3xl p-5 card-glow">
          <h3 class="font-outfit font-bold mb-4 text-maya-neon2">Task Completion</h3>
          <canvas id="taskChart" height="180"></canvas>
        </div>
        <div class="bg-maya-card border border-maya-border rounded-3xl p-5 card-glow">
          <h3 class="font-outfit font-bold mb-3">Your Stats</h3>
          <div class="grid grid-cols-2 gap-3 text-center">
            <div class="bg-maya-bg rounded-2xl p-3">
              <div class="text-2xl font-bold text-maya-neon">${state.level}</div>
              <div class="text-xs text-slate-400">Level</div>
            </div>
            <div class="bg-maya-bg rounded-2xl p-3">
              <div class="text-2xl font-bold text-maya-flame">${state.xp}</div>
              <div class="text-xs text-slate-400">XP</div>
            </div>
            <div class="bg-maya-bg rounded-2xl p-3">
              <div class="text-2xl font-bold text-maya-neon2">${state.habits.reduce((a, h) => a + (h.streak || 0), 0)}</div>
              <div class="text-xs text-slate-400">Total Streak Days</div>
            </div>
            <div class="bg-maya-bg rounded-2xl p-3">
              <div class="text-2xl font-bold text-pink-400">${state.settings.streakFreezes}</div>
              <div class="text-xs text-slate-400">Freezes Left</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderSettings() {
    return `
      <div class="space-y-4">
        <div class="bg-maya-card border border-maya-border rounded-2xl p-4">
          <label class="block text-sm text-slate-400 mb-1">Your Name</label>
          <input id="settingName" type="text" value="${state.profile.name}" class="w-full bg-maya-bg border border-maya-border rounded-xl px-4 py-3 outline-none focus:border-maya-neon" />
        </div>

        <div class="bg-maya-card border border-maya-border rounded-2xl p-4">
          <div class="flex justify-between items-center mb-2">
            <span>Streak Freezes</span>
            <span class="text-maya-neon font-bold">${state.settings.streakFreezes} / ${state.settings.maxFreezes}</span>
          </div>
          <input id="settingFreezes" type="range" min="0" max="5" value="${state.settings.maxFreezes}" class="w-full accent-maya-neon" />
          <p class="text-xs text-slate-500 mt-1">Default freezes available each week</p>
        </div>

        <div class="bg-maya-card border border-maya-border rounded-2xl p-4 space-y-3">
          <label class="flex items-center justify-between">
            <span>Sound Effects</span>
            <input type="checkbox" id="settingSound" ${state.settings.soundEnabled ? 'checked' : ''} class="w-5 h-5 accent-maya-neon" />
          </label>
          <label class="flex items-center justify-between">
            <span>Vibration</span>
            <input type="checkbox" id="settingVibrate" ${state.settings.vibrationEnabled ? 'checked' : ''} class="w-5 h-5 accent-maya-neon" />
          </label>
        </div>

        <div class="bg-maya-card border border-maya-border rounded-2xl p-4">
          <h3 class="font-semibold mb-2">Notifications (Samsung / Android)</h3>
          <p class="text-xs text-slate-400 leading-relaxed mb-3">
            On Samsung / Android, notifications only work reliably when the app is added to Home Screen and not killed by the system.<br><br>
            <strong class="text-maya-neon">Do this on your M31:</strong><br>
            1. Open Maya in Chrome → Menu → Add to Home screen<br>
            2. Settings → Apps → Chrome (or Maya) → Battery → Unrestricted<br>
            3. Settings → Device care → Battery → Background usage limits → Never sleeping apps → Add Chrome/Maya<br>
            4. Do not swipe the app away from Recents or force-stop it<br><br>
            Even then, Android may still kill background tabs. This is a system limitation of web apps.
          </p>
          <button id="testNotifBtn" class="w-full py-2.5 rounded-xl bg-maya-neon/20 text-maya-neon border border-maya-neon/40 font-semibold text-sm">
            Test Notification
          </button>
        </div>

        <div class="bg-maya-card border border-maya-border rounded-2xl p-4 space-y-3">
          <button id="exportBtn" class="w-full py-3 rounded-xl bg-maya-bg border border-maya-border font-semibold">Export Backup</button>
          <label class="w-full py-3 rounded-xl bg-maya-bg border border-maya-border font-semibold text-center block cursor-pointer">
            Import Backup
            <input type="file" id="importBtn" accept=".json" class="hidden" />
          </label>
        </div>
      </div>
    `;
  }

  function initCharts() {
    const streakCtx = document.getElementById('streakChart');
    const taskCtx = document.getElementById('taskChart');
    if (!streakCtx || !taskCtx) return;

    if (charts.streak) charts.streak.destroy();
    if (charts.tasks) charts.tasks.destroy();

    charts.streak = new Chart(streakCtx, {
      type: 'bar',
      data: {
        labels: state.habits.map(h => h.title.slice(0, 12)),
        datasets: [{
          label: 'Current Streak',
          data: state.habits.map(h => h.streak || 0),
          backgroundColor: 'rgba(16, 185, 129, 0.7)',
          borderColor: '#10b981',
          borderWidth: 1,
          borderRadius: 8
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
          x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
        }
      }
    });

    const completed = state.todos.filter(t => t.completed).length;
    const pending = state.todos.length - completed;

    charts.tasks = new Chart(taskCtx, {
      type: 'doughnut',
      data: {
        labels: ['Completed', 'Pending'],
        datasets: [{
          data: [completed, pending],
          backgroundColor: ['#10b981', '#334155'],
          borderWidth: 0
        }]
      },
      options: {
        plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } },
        cutout: '65%'
      }
    });
  }

  // -------------------- EVENT LISTENERS --------------------
  function updateNavIndicator(activeItem) {
    const nav = document.getElementById('bottomNav');
    const cutout = document.getElementById('navCutout');
    if (!nav || !cutout || !activeItem) return;
    const navRect = nav.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    const centerLeft = (itemRect.left - navRect.left) + (itemRect.width / 2);
    const translateX = centerLeft - 34; // 68px / 2
    cutout.style.transform = `translateX(${translateX}px)`;
  }

  function attachEventListeners() {
    // Floating glass nav
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.onclick = () => {
        if (btn.classList.contains('active')) return;
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateNavIndicator(btn);
        currentTab = btn.dataset.tab;
        render();
      };
    });

    // Habits
    document.getElementById('addHabitBtn')?.addEventListener('click', () => {
      showModal(`
        <h3 class="font-outfit font-bold text-xl mb-4">New Habit</h3>
        <input id="habitTitle" placeholder="Habit name..." class="mb-3" />
        <select id="habitFreq" class="mb-4">
          <option value="Daily">Daily</option>
          <option value="Weekdays">Weekdays</option>
          <option value="Weekends">Weekends</option>
        </select>
        <div class="flex gap-3">
          <button id="cancelModal" class="flex-1 py-3 rounded-xl bg-maya-bg border border-maya-border">Cancel</button>
          <button id="saveHabit" class="flex-1 py-3 rounded-xl bg-maya-neon text-maya-bg font-bold">Save</button>
        </div>
      `);
      document.getElementById('cancelModal').onclick = closeModal;
      document.getElementById('saveHabit').onclick = () => {
        const title = document.getElementById('habitTitle').value.trim();
        if (!title) return;
        state.habits.push({
          id: uid(),
          title,
          frequency: document.getElementById('habitFreq').value,
          streak: 0,
          completedToday: false,
          totalCompletions: 0
        });
        saveState();
        closeModal();
        render();
        showToast('Habit added. Now honor it.');
        
      };
    });

    document.querySelectorAll('.check-btn').forEach(btn => {
      btn.onclick = (e) => {
        const card = e.target.closest('.habit-card');
        const id = card.dataset.id;
        const h = state.habits.find(x => x.id === id);
        if (!h) return;

        const wasCompleted = h.completedToday;
        h.completedToday = !h.completedToday;

        if (h.completedToday && !wasCompleted) {
          // Only award XP when marking as done (not when unticking)
          h.totalCompletions = (h.totalCompletions || 0) + 1;
          state.xp += 50;
          playChime('complete');
          vibrate([40]);
          checkLevelUp();

          if (state.habits.every(x => x.completedToday) && state.habits.length > 0) {
            state.xp += 100;
            triggerConfetti();
            showToast('All habits completed. Discipline wins.');
            checkLevelUp();
          }
        }
        // Unticking does nothing to XP
        saveState();
        render();
      };
    });

    document.querySelectorAll('.delete-habit').forEach(btn => {
      btn.onclick = (e) => {
        const id = e.target.closest('.habit-card').dataset.id;
        state.habits = state.habits.filter(h => h.id !== id);
        saveState();
        render();
      };
    });

    // Todos
    document.getElementById('addTodoBtn')?.addEventListener('click', () => {
      showModal(`
        <h3 class="font-outfit font-bold text-xl mb-4">New Task</h3>
        <input id="todoTitle" placeholder="What needs doing?" class="mb-3" />
        <input id="todoAlarm" type="time" class="mb-3" />
        <select id="todoPriority" class="mb-4">
          <option value="high">High Priority</option>
          <option value="medium" selected>Medium</option>
          <option value="low">Low</option>
        </select>
        <div class="flex gap-3">
          <button id="cancelModal" class="flex-1 py-3 rounded-xl bg-maya-bg border border-maya-border">Cancel</button>
          <button id="saveTodo" class="flex-1 py-3 rounded-xl bg-maya-neon text-maya-bg font-bold">Save</button>
        </div>
      `);
      document.getElementById('cancelModal').onclick = closeModal;
      document.getElementById('saveTodo').onclick = () => {
        const title = document.getElementById('todoTitle').value.trim();
        if (!title) return;
        state.todos.unshift({
          id: uid(),
          title,
          priority: document.getElementById('todoPriority').value,
          alarm: document.getElementById('todoAlarm').value || null,
          completed: false,
          alarmTriggered: false
        });
        saveState();
        closeModal();
        render();
        showToast('Task added.');
      };
    });

    document.querySelectorAll('.todo-check').forEach(btn => {
      btn.onclick = (e) => {
        const id = e.target.closest('.todo-card').dataset.id;
        const t = state.todos.find(x => x.id === id);
        if (!t) return;

        const wasCompleted = t.completed;
        t.completed = !t.completed;

        if (t.completed && !wasCompleted) {
          // Only award XP when marking complete
          state.xp += 20;
          playChime('task');
          vibrate([30]);
          checkLevelUp();
        }
        // Unticking does not change XP
        saveState();
        render();
      };
    });

    document.querySelectorAll('.delete-todo').forEach(btn => {
      btn.onclick = (e) => {
        const id = e.target.closest('.todo-card').dataset.id;
        state.todos = state.todos.filter(t => t.id !== id);
        saveState();
        render();
      };
    });

    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.onclick = () => {
        window._todoFilter = chip.dataset.filter;
        render();
      };
    });

    // Settings
    document.getElementById('settingName')?.addEventListener('change', (e) => {
      state.profile.name = e.target.value.trim() || 'My Love';
      saveState();
      render();
    });
    document.getElementById('settingFreezes')?.addEventListener('change', (e) => {
      state.settings.maxFreezes = +e.target.value;
      state.settings.streakFreezes = Math.min(state.settings.streakFreezes, state.settings.maxFreezes);
      saveState();
      render();
    });
    document.getElementById('settingSound')?.addEventListener('change', (e) => {
      state.settings.soundEnabled = e.target.checked;
      saveState();
    });
    
    document.getElementById('settingVibrate')?.addEventListener('change', (e) => {
      state.settings.vibrationEnabled = e.target.checked;
      saveState();
    });
    document.getElementById('testNotifBtn')?.addEventListener('click', async () => {
      const ok = await requestNotificationPermission();
      if (ok) {
        showNotification('Maya', 'Notifications are active. You will be reminded.');
        showToast('Test notification sent.');
      }
    });

    document.getElementById('exportBtn')?.addEventListener('click', () => {
      const data = JSON.stringify(state, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `maya_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Backup downloaded');
    });

    document.getElementById('importBtn')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported = JSON.parse(ev.target.result);
          state = { ...DEFAULT_STATE, ...imported };
          saveState();
          render();
          showToast('Data restored.');
          
        } catch {
          showToast('Invalid backup file');
        }
      };
      reader.readAsText(file);
    });
  }

  // -------------------- SIDE MENU & GLOBAL --------------------
  function openSideMenu() {
    document.getElementById('sideMenu').classList.add('open');
    document.getElementById('sideMenuOverlay').classList.add('open');
  }
  function closeSideMenu() {
    document.getElementById('sideMenu').classList.remove('open');
    document.getElementById('sideMenuOverlay').classList.remove('open');
  }

  document.getElementById('menuBtn').addEventListener('click', openSideMenu);
  document.getElementById('sideMenuOverlay').addEventListener('click', closeSideMenu);

  // Side menu actions
  document.querySelectorAll('.side-link').forEach(link => {
    link.addEventListener('click', () => {
      const action = link.dataset.side;
      closeSideMenu();

      if (action === 'profile') {
        showModal(`
          <div class="text-center mb-4">
            <img src="avatar.png" style="width:80px;height:80px;border-radius:22px;object-fit:cover;box-shadow:0 0 18px rgba(16,185,129,0.45);margin:0 auto 12px;">
            <h3 class="font-outfit font-bold text-xl">${state.profile.name}</h3>
            <p class="text-slate-400 text-sm mt-1">Joined ${state.profile.joined || 'recently'}</p>
          </div>
          <div class="bg-maya-bg rounded-2xl p-4 space-y-2 text-sm">
            <div class="flex justify-between"><span class="text-slate-400">Level</span><span class="font-bold text-maya-neon">${state.level}</span></div>
            <div class="flex justify-between"><span class="text-slate-400">Total XP</span><span class="font-bold">${state.xp}</span></div>
            <div class="flex justify-between"><span class="text-slate-400">Habits</span><span>${state.habits.length}</span></div>
            <div class="flex justify-between"><span class="text-slate-400">Tasks</span><span>${state.todos.length}</span></div>
          </div>
          <button id="closeModalBtn" class="w-full mt-5 py-3 rounded-xl bg-maya-neon text-maya-bg font-bold">Close</button>
        `);
        document.getElementById('closeModalBtn').onclick = closeModal;
        
      }

      if (action === 'level') {
        const next = getLevelThreshold(state.level);
        const progress = Math.min(100, Math.round((state.xp / next) * 100));
        showModal(`
          <h3 class="font-outfit font-bold text-xl mb-1 text-center">Level ${state.level}</h3>
          <p class="text-center text-slate-400 text-sm mb-4">${state.xp} / ${next} XP to next level</p>
          <div class="h-3 bg-maya-bg rounded-full overflow-hidden mb-6">
            <div class="h-full bg-gradient-to-r from-maya-neon to-maya-neon2 rounded-full transition-all" style="width:${progress}%"></div>
          </div>
          <div class="bg-maya-bg rounded-2xl p-4 text-sm space-y-2">
            <p class="text-slate-300">Every multiple of 8 levels I will ask you out for dinner.</p>
            <p class="text-maya-flame font-semibold">Next dinner invitation at Level ${Math.ceil((state.level + 1) / 8) * 8}</p>
          </div>
          <button id="closeModalBtn" class="w-full mt-5 py-3 rounded-xl bg-maya-neon text-maya-bg font-bold">Got it</button>
        `);
        document.getElementById('closeModalBtn').onclick = closeModal;
        
      }

      if (action === 'sounds') {
        showModal(`
          <h3 class="font-outfit font-bold text-xl mb-4">Sound Settings</h3>
          <div class="space-y-4">
            <label class="flex items-center justify-between">
              <span>Sound Effects</span>
              <input type="checkbox" id="sideSound" ${state.settings.soundEnabled ? 'checked' : ''} class="w-5 h-5 accent-emerald-500">
            </label>
            <label class="flex items-center justify-between">
              <span>Vibration</span>
              <input type="checkbox" id="sideVibrate" ${state.settings.vibrationEnabled ? 'checked' : ''} class="w-5 h-5 accent-emerald-500">
            </label>
          </div>
          <button id="testSoundBtn" class="w-full mt-5 py-3 rounded-xl bg-maya-neon/20 border border-maya-neon/40 text-maya-neon font-semibold">Test Sound</button>
          <button id="closeModalBtn" class="w-full mt-3 py-3 rounded-xl bg-maya-bg border border-maya-border">Done</button>
        `);
        document.getElementById('sideSound').onchange = (e) => { state.settings.soundEnabled = e.target.checked; saveState(); };
        document.getElementById('sideVibrate').onchange = (e) => { state.settings.vibrationEnabled = e.target.checked; saveState(); };
        document.getElementById('testSoundBtn').onclick = () => playChime('complete');
        document.getElementById('closeModalBtn').onclick = closeModal;
      }

      if (action === 'export') {
        // Jump to settings tab and scroll to backup section
        currentTab = 'settings';
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        const settingsBtn = document.querySelector('.nav-item[data-tab="settings"]');
        if (settingsBtn) {
          settingsBtn.classList.add('active');
          updateNavIndicator(settingsBtn);
        }
        render();
        showToast('Backup options are in Settings');
        
      }
    });
  });

  document.getElementById('closeQuote').onclick = () => {
    document.getElementById('quotePopup').classList.add('hidden');
    document.getElementById('quotePopup').classList.remove('flex');
  };
  document.getElementById('closeSpecial').onclick = closeSpecial;

  document.getElementById('enableNotifBtn').onclick = async () => {
    const ok = await requestNotificationPermission();
    showToast(ok ? 'Alerts enabled.' : 'Permission denied');
    if (ok) 
  };

  // Quote every ~2 hours
  function maybeShowQuote() {
    const now = Date.now();
    if (now - state.settings.lastQuoteTime > 2 * 60 * 60 * 1000) {
      state.settings.lastQuoteTime = now;
      saveState();
      const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
      document.getElementById('quoteText').textContent = q;
      document.getElementById('quoteAvatar').innerHTML = `<img src="avatar.png" alt="Maya" style="width:72px;height:72px;object-fit:cover;border-radius:20px;box-shadow:0 0 16px rgba(16,185,129,0.4);">`;
      const popup = document.getElementById('quotePopup');
      popup.classList.remove('hidden');
      popup.classList.add('flex');
      
    }
  }

  // -------------------- INIT --------------------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  }

  // Load voices
  }

  render();

  // Position the circular indicator on first load
  setTimeout(() => {
    const initial = document.querySelector('.nav-item.active');
    if (initial) updateNavIndicator(initial);
  }, 50);

  // Keep indicator correct on resize
  window.addEventListener('resize', () => {
    const active = document.querySelector('.nav-item.active');
    if (active) updateNavIndicator(active);
  });

  setTimeout(maybeShowQuote, 1200);

  // Expose for debugging
  window.Maya = { state, saveState, render };
})();
