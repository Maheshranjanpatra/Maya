export function toast(message, options = {}) {
  const container = document.querySelector('#toast-container');
  const element = document.createElement('div');
  element.className = 'toast';
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
  window.setTimeout(() => element.remove(), options.duration || 5000);
  return element;
}
