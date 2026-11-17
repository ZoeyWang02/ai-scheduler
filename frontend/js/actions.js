// One delegated listener per event type replaces the inline onclick="..." / onchange="..." / onkeydown="..."
// attributes, so the page can run under a Content-Security-Policy that allows scripts from 'self' only
// (inline handlers are blocked by such a policy).
//
//   <button data-click="setAuthMode" data-args='["signin"]'>      calls actions.setAuthMode("signin")
//   <button data-click="switchAnalysisPeriod" data-args='["day", "@this"]'>   "@this" = the element itself
//   <select data-change="previewTheme" data-args='["@value"]'>    "@value" = the element's value
//   <input  data-enter="sendMessage">                             runs on the Enter key
//
// Only functions in the registry passed to initActions can be reached, so markup (including text that ends
// up in the page through some bug) cannot call anything else.

const ARG_THIS = '@this';
const ARG_VALUE = '@value';

export function parseArgs(raw, element) {
    if (!raw) return [];
    let args;
    try {
        args = JSON.parse(raw);
    } catch (error) {
        console.error('Bad data-args', raw);
        return [];
    }
    if (!Array.isArray(args)) return [];
    return args.map((arg) => (arg === ARG_THIS ? element : arg === ARG_VALUE ? element.value : arg));
}

/** Runs the action named by `attribute` on the nearest element at or above `target` that has it. */
export function dispatch(registry, target, attribute) {
    const element = target && typeof target.closest === 'function' ? target.closest(`[${attribute}]`) : null;
    if (!element) return false;
    const name = element.getAttribute(attribute);
    const action = Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : null;
    if (typeof action !== 'function') {
        console.error('Unknown action', name);
        return false;
    }
    action(...parseArgs(element.getAttribute('data-args'), element));
    return true;
}

export function initActions(registry, root = document) {
    root.addEventListener('click', (event) => dispatch(registry, event.target, 'data-click'));
    root.addEventListener('change', (event) => dispatch(registry, event.target, 'data-change'));
    root.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') dispatch(registry, event.target, 'data-enter');
    });
}
