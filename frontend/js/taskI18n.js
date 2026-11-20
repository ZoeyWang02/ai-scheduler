/* Task titles and descriptions in both languages.
 *
 * When a task is created or edited, an AI translates its title and description into the other language
 * (Chinese <-> English) and the result is saved next to the original as `task.i18n`:
 *
 *     { zh: { title, description }, en: { title, description } }
 *
 * The calendar then shows the text in the interface language. A task without `i18n` (an old task, a task
 * from an import, or one whose translation failed) is simply shown as written.
 *
 * This file is pure (no DOM, no network) and is used by the browser and by the Worker, so both build the
 * same prompt and read the reply the same way. */

export const LANGUAGES = ['zh', 'en'];
export const MAX_ITEMS = 40;
export const MAX_TITLE_CHARS = 300;
export const MAX_DESCRIPTION_CHARS = 2000;

const CJK = /[㐀-鿿]/;
const PLAN_PREFIX = /^\[(?:AI|智能规划|智能)\]\s*/;

/** The language a piece of text is written in: 'zh' if it has any Chinese characters, otherwise 'en'. */
export function languageOf(text) {
    return CJK.test(text || '') ? 'zh' : 'en';
}

export const otherLanguage = (lang) => (lang === 'zh' ? 'en' : 'zh');

/** Splits the "[AI] " tag the planner puts in front of a title (it is shown in the right language by
 *  translateDynamicText, so it never goes through the translator). */
export function splitPlanPrefix(title) {
    const text = typeof title === 'string' ? title : '';
    const match = PLAN_PREFIX.exec(text);
    return match ? { prefix: '[AI] ', rest: text.slice(match[0].length) } : { prefix: '', rest: text };
}

/** What to ask the translator for one task: its title (without the planner tag) and description, and the
 *  language to translate into (the opposite of the one the title is written in). The title decides, because a
 *  description can quote something in the other language (an AI-made task quotes the chat message it came from);
 *  only a title with no letters at all (such as "2") defers to the description. */
export function translationItem(task) {
    const title = splitPlanPrefix(task.title).rest;
    const description = typeof task.description === 'string' ? task.description : '';
    const from = /[A-Za-z㐀-鿿]/.test(title) ? languageOf(title) : languageOf(description);
    return { from, to: otherLanguage(from), title, description };
}

const SYSTEM_PROMPT = 'You translate task titles and descriptions between Chinese and English. '
    + 'You get a JSON array of items {"to", "title", "description"}. Translate each item\'s "title" and "description" '
    + 'into the language named by its "to" field ("zh" = Simplified Chinese, "en" = English). '
    + 'Keep numbers, dates, times, names of people and courses, URLs and line breaks as they are, and do not add or drop anything. '
    + 'An empty string stays an empty string. '
    + 'Reply with ONLY a JSON array with the same number of items in the same order, each exactly {"title": "...", "description": "..."}: '
    + 'no markdown, no explanation.';

/** The chat messages that ask a model to translate `items` (each {to, title, description}).
 *  @param {{to: string, title: string, description: string}[]} items
 *  @returns {{role: 'system' | 'user', content: string}[]} */
export function translationMessages(items) {
    const payload = items.map(({ to, title, description }) => ({ to, title, description }));
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
    ];
}

/** The translations from a model's reply, as [{title, description}] in the order asked, or null when the reply
 *  is not a usable answer (not a JSON array, wrong length, or an item without text). */
export function parseTranslationReply(reply, expectedCount) {
    if (typeof reply !== 'string') return null;
    const first = reply.indexOf('[');
    const last = reply.lastIndexOf(']');
    if (first < 0 || last <= first) return null;
    let parsed;
    try { parsed = JSON.parse(reply.slice(first, last + 1)); } catch (e) { return null; }
    if (!Array.isArray(parsed) || parsed.length !== expectedCount) return null;
    const out = [];
    for (const item of parsed) {
        if (!item || typeof item.title !== 'string') return null;
        out.push({ title: item.title.trim(), description: typeof item.description === 'string' ? item.description.trim() : '' });
    }
    return out;
}

/** The `i18n` value to save for a task, given what was asked (`item`, from translationItem) and the answer.
 *  The original keeps its own language slot; the translation takes the other. Returns null when the
 *  translation has no title. */
export function buildI18n(task, item, translated) {
    if (!translated || typeof translated.title !== 'string' || !translated.title) return null;
    const { prefix } = splitPlanPrefix(task.title);
    return {
        [item.from]: { title: task.title || '', description: typeof task.description === 'string' ? task.description : '' },
        [item.to]: { title: prefix + translated.title, description: translated.description || '' },
    };
}

/** The `i18n` value for each task ({title, description}), in order, or null for a task that could not be
 *  translated. `translate(items)` asks the AI for one batch and returns its answers (an array in the same order,
 *  or null); it may throw. Never throws itself: a failed batch only leaves its tasks untranslated, and they are
 *  shown as written. Batches are at most MAX_ITEMS long.
 *  @param {{title?: string | null, description?: string | null}[]} tasks
 *  @param {(items: {to: string, title: string, description: string}[]) => Promise<{title: string, description: string}[] | null>} translate */
export async function buildTaskTranslations(tasks, translate) {
    const results = tasks.map(() => null);
    const items = tasks.map(translationItem);
    for (let start = 0; start < items.length; start += MAX_ITEMS) {
        const batch = items.slice(start, start + MAX_ITEMS);
        let answers = null;
        try { answers = await translate(batch); } catch (e) { answers = null; }
        if (!Array.isArray(answers) || answers.length !== batch.length) continue;
        batch.forEach((item, i) => { results[start + i] = buildI18n(tasks[start + i], item, answers[i]); });
    }
    return results;
}

/** True for an `i18n` value that is safe to save: only zh/en, each with a text title and description. */
export function isValidI18n(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    if (!keys.length || keys.some((key) => !LANGUAGES.includes(key))) return false;
    return keys.every((key) => {
        const entry = value[key];
        return entry && typeof entry === 'object'
            && typeof entry.title === 'string' && entry.title.length <= MAX_TITLE_CHARS
            && typeof entry.description === 'string' && entry.description.length <= MAX_DESCRIPTION_CHARS;
    });
}

/** The title and description of `task` in `lang`: the saved translation when there is one, else the original. */
export function pickTaskText(task, lang) {
    const saved = task && task.i18n && typeof task.i18n === 'object' ? task.i18n[lang] : null;
    const title = saved && typeof saved.title === 'string' && saved.title ? saved.title : (task && task.title) || '';
    const description = saved && typeof saved.description === 'string' ? saved.description : (task && task.description) || '';
    return { title, description };
}
