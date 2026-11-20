let activeSheetClose;

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

export function showSheet(content, onClose = () => {}, { onRequestClose } = {}) {
  activeSheetClose?.();
  const root = document.querySelector('#modal-root');
  root.innerHTML = `<div class="sheet-backdrop"><section class="bottom-sheet" role="dialog" aria-modal="true">${content}</section></div>`;
  const backdrop = root.querySelector('.sheet-backdrop');
  const close = () => {
    if (!root.contains(backdrop)) return;
    document.removeEventListener('keydown', onKeydown);
    root.replaceChildren();
    if (activeSheetClose === close) activeSheetClose = null;
    onClose();
    return true;
  };
  const requestClose = () => {
    if (onRequestClose?.() === false) return false;
    return close();
  };
  const onKeydown = event => {
    if (event.key === 'Escape' && root.contains(backdrop)) requestClose();
  };
  activeSheetClose = close;
  document.addEventListener('keydown', onKeydown);
  backdrop.querySelectorAll('[data-close-sheet]').forEach(button => button.addEventListener('click', requestClose));
  backdrop.addEventListener('click', event => {
    if (event.target.classList.contains('sheet-backdrop')) requestClose();
  });
  backdrop.querySelector('.bottom-sheet')?.querySelector('input,textarea,select,button')?.focus();
  return { root, close };
}
