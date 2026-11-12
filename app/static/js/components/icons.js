const svg = path => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export const ICONS = {
  tasks: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2"/>'),
  syllabus: svg('<path d="M4 4h13a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/><path d="M8 8h8M8 12h8"/>'),
  visuals: svg('<path d="M4 19V5m0 14h17M8 15l3-4 3 2 5-7"/>'),
  profile: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  reviews: svg('<path d="M4 5h16v13H8l-4 3z"/><path d="M8 9h8m-8 4h5"/>'),
  plan: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4m8-4v4M3 9h18m-13 4h3m-3 4h7"/>'),
  exams: svg('<path d="M5 3h14v18l-7-4-7 4z"/><path d="M9 8h6m-6 4h6"/>'),
  calendar: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4m8-4v4M3 9h18M8 13h2m4 0h2m-8 4h2"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4v.3a2 2 0 1 1-4 0v-.2a2 2 0 0 0-3.4-1.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A2 2 0 0 0 1.6 12H1.5a2 2 0 1 1 0-4h.2a2 2 0 0 0 1.4-3.4L3 4.5a2 2 0 1 1 2.8-2.8l.1.1A2 2 0 0 0 9.3.4V.3a2 2 0 1 1 4 0v.2a2 2 0 0 0 3.4 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a2 2 0 0 0 1.4 3.4h.3a2 2 0 1 1 0 4H21a2 2 0 0 0-1.6 2.9z"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.2 1.8c-1.1 1-1.8 1.3-1.8 2.7m0 3h.01"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  search: svg('<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/>'),
  close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  arrow: svg('<path d="m9 18 6-6-6-6"/>'),
  chevronLeft: svg('<path d="m15 18-6-6 6-6"/>'),
  chevronRight: svg('<path d="m9 18 6-6-6-6"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a14.8 14.8 0 0 1-3.2 4.1M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7c1 0 1.9-.2 2.7-.5"/>'),
  check: svg('<path d="m5 12 4 4L19 6"/>'),
  flame: svg('<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-2-2-3-4-3-6-3 3-5 6-5 10 0 4 3 7 8 7z"/><path d="M12 22c-2 0-3-2-3-4 0-1 1-3 3-4 0 2 2 3 2 5 0 2-1 3-2 3z"/>')
};
