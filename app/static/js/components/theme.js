let mediaQuery;
let mediaListener;

export function applyTheme(theme = 'auto') {
  if (mediaQuery && mediaListener) mediaQuery.removeEventListener('change', mediaListener);
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const set = dark => {
    document.documentElement.dataset.theme = theme === 'auto' ? (dark ? 'dark' : 'light') : theme;
  };
  set(mediaQuery.matches);
  if (theme === 'auto') {
    mediaListener = event => set(event.matches);
    mediaQuery.addEventListener('change', mediaListener);
  } else {
    mediaListener = null;
  }
}
