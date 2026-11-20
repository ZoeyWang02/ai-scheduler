/* What the assistant's reply is made of, and what applying a plan does.
 *
 * The assistant answers in prose and, when it proposes a change, appends a JSON plan: a list of items
 *   {action: "add",    kind: "task"|"event", step, description, estimatedHours, suggestedDate}
 *   {action: "update", taskId, step?, description?, suggestedDate?, estimatedHours?, kind?}
 *   {action: "delete", taskId, step, reason}
 * Models are not tidy: the JSON can come without brackets, with a trailing comma, cut off, or inside a code
 * fence. splitReply() reads whatever plan objects it can and always keeps JSON out of the text the person sees.
 *
 * Times are local date-times as text ("YYYY-MM-DDTHH:MM[:SS]"); no zone is ever applied here. */

const ACTIONS = ['add', 'update', 'delete'];
const DATE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
const PLAN_KEYS = ['action', 'step', 'taskId', 'suggestedDate'];
const TEXT_KEYS = ['reply', 'message', 'answer', 'response', 'text', 'content'];
const MAX_HOURS = 24 * 7;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** JSON.parse that also accepts a trailing comma before } or ]. Returns undefined when it is not JSON. */
export function parseLoose(text) {
    for (const candidate of [text, text.replace(/,\s*([}\]])/g, '$1')]) {
        try { return JSON.parse(candidate); } catch (e) { /* try the next form */ }
    }
    return undefined;
}

/** The top-level {...} blocks of a text, string-aware: [{start, end (exclusive)}]. An unfinished block is ignored. */
export function findObjects(text) {
    const spans = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inString) {
            if (c === '\\') i++;
            else if (c === '"') inString = false;
        } else if (c === '"' && depth > 0) {
            inString = true;
        } else if (c === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (c === '}' && depth > 0) {
            depth--;
            if (depth === 0) spans.push({ start, end: i + 1 });
        }
    }
    return spans;
}

/** "2026-11-23 14:00" -> "2026-11-23T14:00:00"; '' when it is not a date-time. */
export function cleanDateTime(value) {
    const m = DATE.exec(typeof value === 'string' ? value.trim() : '');
    return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}` : '';
}

const toMinutes = (text) => {
    const m = DATE.exec(text || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null;
};

/** `local` plus some minutes, as local text. Plain calendar arithmetic, so a daylight-saving change cannot shift it. */
export function addMinutes(local, minutes) {
    const base = toMinutes(local);
    if (base === null) return '';
    const d = new Date((base + Math.round(minutes)) * 60000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00`;
}

/** Minutes from `start` to `end`, or null when either is not a date-time. */
export function minutesBetween(start, end) {
    const a = toMinutes(start);
    const b = toMinutes(end);
    return a === null || b === null ? null : b - a;
}

/** One plan item cleaned up, or null when it is not usable (no valid action, or an update/delete with no task id). */
export function normalizeItem(raw) {
    if (!isObject(raw) || !PLAN_KEYS.some((key) => key in raw)) return null;
    const action = typeof raw.action === 'string' && ACTIONS.includes(raw.action.trim().toLowerCase()) ? raw.action.trim().toLowerCase() : 'add';
    const taskId = Number(raw.taskId);
    if (action !== 'add' && !(Number.isInteger(taskId) && taskId > 0)) return null;
    const hours = Number(raw.estimatedHours);
    const item = { action };
    if (action !== 'add') item.taskId = taskId;
    if (typeof raw.step === 'string' && raw.step.trim()) item.step = raw.step.trim().slice(0, 200);
    if (typeof raw.description === 'string' && raw.description.trim()) item.description = raw.description.trim().slice(0, 500);
    if (typeof raw.reason === 'string' && raw.reason.trim()) item.reason = raw.reason.trim().slice(0, 300);
    if (Number.isFinite(hours) && hours > 0) item.estimatedHours = Math.min(hours, MAX_HOURS);
    const date = cleanDateTime(raw.suggestedDate);
    if (date) item.suggestedDate = date;
    const kind = typeof raw.kind === 'string' ? raw.kind.trim().toLowerCase() : '';
    if (kind === 'event' || kind === 'task') item.kind = kind;
    else if (action === 'add') item.kind = 'task';
    return item;
}

/** Reply text -> {text, plan, after}. `plan` is the JSON of the cleaned items (null when there are none);
 *  `text` is the prose before it and `after` any prose after it. Never contains JSON-looking leftovers. */
export function splitReply(reply) {
    const whole = String(reply || '').trim();
    if (!whole) return { text: '', plan: null, after: '' };

    const items = [];
    let first = -1;
    let last = -1;
    for (const span of findObjects(whole)) {
        const value = parseLoose(whole.slice(span.start, span.end));
        const item = normalizeItem(value);
        if (!item) continue;
        items.push(item);
        if (first < 0) first = span.start;
        last = span.end;
    }

    if (items.length) {
        // The plan may sit inside [ ... ] and / or a code fence: take those delimiters off the prose too.
        const before = whole.slice(0, first).replace(/\[\s*$/, '').replace(/`{3}[a-zA-Z]*\s*$/, '');
        const after = whole.slice(last).replace(/^\s*\]/, '').replace(/^\s*`{3}/, '');
        return { text: tidy(before), plan: JSON.stringify(items), after: tidy(after) };
    }

    // Not a plan. Some models answer with a JSON object that wraps the text ({"reply": "..."}); otherwise a
    // fenced or bare JSON block is dropped so the person never reads raw JSON.
    const spans = findObjects(whole);
    if (spans.length === 1 && whole.slice(0, spans[0].start).replace(/`{3}[a-zA-Z]*/g, '').trim() === '' && whole.slice(spans[0].end).replace(/`{3}/g, '').trim() === '') {
        const value = parseLoose(whole.slice(spans[0].start, spans[0].end));
        const key = isObject(value) ? TEXT_KEYS.find((k) => typeof value[k] === 'string' && value[k].trim()) : undefined;
        if (key) return { text: value[key].trim(), plan: null, after: '' };
    }
    return { text: tidy(stripJsonBlocks(whole)), plan: null, after: '' };
}

const tidy = (text) => text.replace(/\n{3,}/g, '\n\n').trim();

/** Takes out fenced code blocks that hold JSON, JSON objects/arrays that look like plan data, and empty "[]". */
function stripJsonBlocks(text) {
    let out = text.replace(/`{3}(?:json|JSON)?\s*[\[{][\s\S]*?`{3}/g, '');
    for (const span of findObjects(out).reverse()) {
        const block = out.slice(span.start, span.end);
        if (/"\s*:/.test(block)) out = out.slice(0, span.start) + out.slice(span.end);
    }
    return out.replace(/`{3}[a-zA-Z]*\s*$/, '').replace(/\[\s*\]/g, '').replace(/^\s*[\[\]]\s*$/gm, '');
}

/** True when the reply held something that looked like a plan or JSON but nothing usable came out of it, and no
 *  prose is left: the caller then says so instead of showing an empty bubble. */
export const isUnreadable = (original, parsed) => !parsed.text && !parsed.plan && String(original || '').trim() !== '';

/** The finished new task for an `add` item: what to POST (without the translations). */
export function newTaskFromItem(item) {
    const start = item.suggestedDate || '';
    const isEvent = item.kind === 'event' && !!start;
    return {
        dueDate: start,
        endDate: isEvent ? addMinutes(start, (item.estimatedHours || 1) * 60) : null,
    };
}

/** The request body for an `update` item applied to the task as the list has it ({title, description, dueDate,
 *  endDate}), plus whether the text changed (so its translations have to be made again). */
export function buildUpdate(existing, item) {
    const tag = /^\s*(\[AI\]|\[智能规划\])\s*/.exec(existing.title || '');
    const bare = (existing.title || '').replace(/^\s*(\[AI\]|\[智能规划\])\s*/, '').trim();
    const newBare = item.step && item.step.replace(/^\s*(\[AI\]|\[智能规划\])\s*/, '').trim() !== bare ? item.step.replace(/^\s*(\[AI\]|\[智能规划\])\s*/, '').trim() : bare;
    const title = tag ? `${tag[1]} ${newBare}` : newBare;
    const description = item.description !== undefined ? item.description : (existing.description ?? null);

    const start = item.suggestedDate || cleanDateTime(existing.dueDate) || '';
    let end = null;
    const wasEvent = !!existing.endDate;
    if (item.kind === 'task') end = null;
    else if (item.kind === 'event' || wasEvent) {
        const oldLength = wasEvent ? minutesBetween(existing.dueDate, existing.endDate) : null;
        const minutes = item.estimatedHours ? item.estimatedHours * 60 : oldLength && oldLength > 0 ? oldLength : 60;
        end = addMinutes(start, minutes);
    }
    return {
        body: { title, description, dueDate: start, endDate: end },
        textChanged: title !== (existing.title || '') || (description || '') !== (existing.description || ''),
    };
}
