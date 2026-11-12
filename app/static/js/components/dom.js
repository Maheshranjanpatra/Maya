export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

export function showSheet(content, onClose = () => {}) {
  const root = document.querySelector('#modal-root');
  root.innerHTML = `<div class="sheet-backdrop"><section class="bottom-sheet" role="dialog" aria-modal="true">${content}</section></div>`;
  const close = () => {
    root.replaceChildren();
    onClose();
  };
  root.querySelectorAll('[data-close-sheet]').forEach(button => button.addEventListener('click', close));
  root.querySelector('.sheet-backdrop').addEventListener('click', event => {
    if (event.target.classList.contains('sheet-backdrop')) close();
  });
  root.querySelector('.bottom-sheet')?.querySelector('input,textarea,select,button')?.focus();
  return { root, close };
}
