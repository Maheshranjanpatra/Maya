
export function sidebar() {
    const button = document.querySelector('#menu-btn');
    const panel = document.querySelector('#sidebar');

    if (!button || !panel) {
        console.error('Menu button or sidebar not found');
        return;
    }

    const closeMenu = () => {
        panel.classList.remove('open');
        button.setAttribute('aria-expanded', 'false');
    };

    button.setAttribute('aria-expanded', 'false');

    button.addEventListener('click', () => {
        const isOpen = panel.classList.toggle('open');
        button.setAttribute('aria-expanded', String(isOpen));
    });

    // Close after clicking a sidebar link
    panel.addEventListener('click', (event) => {
        if (event.target.closest('a')) {
            closeMenu();
        }
    });

    // Close when clicking outside
    document.addEventListener('click', (event) => {
        if (
            panel.classList.contains('open') &&
            !panel.contains(event.target) &&
            !button.contains(event.target)
        ) {
            closeMenu();
        }
    });

    // Close with Escape
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeMenu();
        }
    });
}
