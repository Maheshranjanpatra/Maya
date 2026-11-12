export function sidebar() {
  const button = document.querySelector('#menu-btn');
  const panel = document.querySelector('#sidebar');
  if (!button || !panel) return;

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'sidebar-backdrop';
  backdrop.setAttribute('aria-label', 'Close navigation menu');
  panel.before(backdrop);

  const closeMenu = () => {
    panel.classList.remove('open');
    backdrop.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    backdrop.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
  });
  backdrop.addEventListener('click', closeMenu);
  panel.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
  });
}
