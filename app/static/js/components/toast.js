export function toast(message, options = {}) {
  const container = document.querySelector('#toast-container');
  container.replaceChildren();
  const element = document.createElement('div');
  element.classList.add('toast');
  if (options.variant) element.classList.add(`toast-${options.variant}`);
  const text = document.createElement('span');
  text.textContent = message;
  element.append(text);

  if (options.action && options.label) {
    const action = document.createElement('button');
    action.type = 'button';
    action.textContent = options.label;
    action.addEventListener('click', () => {
      options.action();
      element.remove();
    }, { once: true });
    element.append(action);
  }

  container.append(element);
  if (options.duration !== 0) {
    window.setTimeout(() => element.remove(), options.duration ?? 5000);
  }
  return element;
}
