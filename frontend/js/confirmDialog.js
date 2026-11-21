/* A confirmation in the app's own style, in place of the browser's confirm(): it matches the theme, it can be
 * screen-recorded, and it does not freeze the page. askConfirm() resolves true on "Confirm" (or Enter) and false on
 * "Cancel", Escape, or a click outside the box. */

export function askConfirm({ title = '', detail = '', question = '', yes = 'OK', no = 'Cancel' }) {
    return new Promise((resolve) => {
        const root = document.createElement('div');
        root.className = 'modal confirm-dialog';
        root.setAttribute('role', 'alertdialog');
        root.setAttribute('aria-modal', 'true');
        root.style.display = 'block';

        const box = document.createElement('div');
        box.className = 'modal-content';
        const make = (tag, className, text) => {
            const el = document.createElement(tag);
            if (className) el.className = className;
            el.textContent = text;
            return el;
        };
        if (title) box.appendChild(make('div', 'confirm-dialog-title', title));
        if (detail) box.appendChild(make('div', 'confirm-dialog-detail', detail));
        if (question) box.appendChild(make('div', 'confirm-dialog-question', question));

        const actions = document.createElement('div');
        actions.className = 'confirm-dialog-actions';
        const noButton = make('button', 'confirm-dialog-no', no);
        const yesButton = make('button', 'btn-sync confirm-dialog-yes', yes);
        noButton.type = 'button';
        yesButton.type = 'button';
        actions.append(noButton, yesButton);
        box.appendChild(actions);
        root.appendChild(box);

        const finish = (answer) => {
            document.removeEventListener('keydown', onKey, true);
            root.remove();
            resolve(answer);
        };
        const onKey = (event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
            else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); finish(true); }
        };
        document.addEventListener('keydown', onKey, true);
        yesButton.addEventListener('click', () => finish(true));
        noButton.addEventListener('click', () => finish(false));
        root.addEventListener('mousedown', (event) => { if (event.target === root) finish(false); });

        document.body.appendChild(root);
        yesButton.focus();
    });
}
