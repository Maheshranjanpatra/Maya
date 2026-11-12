import { ICONS } from './icons.js';

const pages = [
  ['Tasks', 'tasks'],
  ['Syllabus', 'syllabus'],
  ['Visuals', 'visuals'],
  ['Profile', 'profile'],
  ['Reviews', 'reviews'],
  ['Plan', 'plan'],
  ['Exams', 'exams'],
  ['Calendar', 'calendar'],
  ['Settings', 'settings'],
  ['Help', 'help']
];

export function nav() {
  const links = document.querySelector('#side-links');
  links.innerHTML = pages.map(([label, route]) =>
    `<a data-route="${route}" href="#/${route}">${ICONS[route]}<span>${label}</span></a>`
  ).join('');

  document.querySelectorAll('#bottom-nav [data-route]').forEach(link => {
    const icon = link.querySelector('.nav-glyph');
    if (icon) icon.innerHTML = ICONS[link.dataset.route];
  });
}

export function activateNav(route) {
  document.querySelectorAll('[data-route]').forEach(link => {
    const active = link.dataset.route === route;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
