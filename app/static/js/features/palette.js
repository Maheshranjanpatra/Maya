
const pages = [
    ['Tasks', 'tasks'],
    ['Syllabus', 'syllabus'],
    ['Visuals', 'visuals'],
    ['Profile', 'profile'],
    ['Reviews', 'reviews'],
    ['Study Plan', 'plan'],
    ['Exams', 'exams'],
    ['Calendar', 'calendar'],
    ['Settings', 'settings'],
    ['Help', 'help']
];

export function palette() {
    const button = document.querySelector('#palette-btn');
    const root = document.querySelector('#modal-root');

    if (!button || !root) {
        console.error('Search button or modal root not found');
        return;
    }

    function closePalette() {
        root.innerHTML = '';
    }

    function openPalette() {
        root.innerHTML = `
            <div class="palette-backdrop">
                <section class="palette-dialog"
                         role="dialog"
                         aria-modal="true"
                         aria-label="Search Maya">

                    <div class="palette-head">
                        <input
                            id="palette-search"
                            type="search"
                            placeholder="Search pages..."
                            autocomplete="off"
                        >

                        <button type="button" id="palette-close">
                            Close
                        </button>
                    </div>

                    <div id="palette-results"></div>

                    <p class="palette-hint">
                        Type to search · Press Escape to close
                    </p>
                </section>
            </div>
        `;

        const input = root.querySelector('#palette-search');
        const results = root.querySelector('#palette-results');

        function renderResults() {
            const query = input.value.trim().toLowerCase();

            const filtered = pages.filter(([name, route]) =>
                (name + ' ' + route).toLowerCase().includes(query)
            );

            if (filtered.length === 0) {
                results.innerHTML =
                    '<p class="palette-empty">No matching pages found.</p>';
                return;
            }

            results.innerHTML = filtered.map(([name, route]) => `
                <button
                    type="button"
                    class="palette-result"
                    data-route="${route}"
                >
                    ${name}
                    <span>Open</span>
                </button>
            `).join('');

            results.querySelectorAll('[data-route]').forEach(item => {
                item.addEventListener('click', () => {
                    location.hash = '#/' + item.dataset.route;
                    closePalette();
                });
            });
        }

        input.addEventListener('input', renderResults);

        root.querySelector('#palette-close').addEventListener(
            'click',
            closePalette
        );

        root.querySelector('.palette-backdrop').addEventListener(
            'click',
            event => {
                if (event.target.classList.contains('palette-backdrop')) {
                    closePalette();
                }
            }
        );

        input.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                closePalette();
            }

            if (event.key === 'Enter') {
                const firstResult = results.querySelector('[data-route]');

                if (firstResult) {
                    firstResult.click();
                }
            }
        });

        renderResults();
        input.focus();
    }

    button.addEventListener('click', openPalette);

    // Ctrl + K / Cmd + K
    document.addEventListener('keydown', event => {
        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'k'
        ) {
            event.preventDefault();
            openPalette();
        }
    });
}
