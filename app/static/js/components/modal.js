import { ICONS } from './icons.js';

export function modal(html) {
  const root = document.querySelector('#modal-root');
  root.innerHTML = `<div class="card">${html}<button id="close-modal" class="icon-button" type="button" aria-label="Close">${ICONS.close}</button></div>`;
  root.querySelector('#close-modal').onclick = () => root.replaceChildren();
}