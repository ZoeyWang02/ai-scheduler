/* Asks an AI for the other-language version of tasks as they are saved (see taskI18n.js).
 * With your own API key the browser asks your provider directly; otherwise it asks the site's built-in assistant,
 * which counts as one request against the daily allowance per save, however many tasks are in it. */

import { API_BASE } from './config.js';
import { getAuthToken } from './auth.js';
import { chatComplete, hasOwnKey } from './llmClient.js';
import { buildTaskTranslations, parseTranslationReply, translationMessages } from './taskI18n.js';

const SERVER_TIMEOUT_MS = 25000;

async function viaOwnKey(items) {
    return parseTranslationReply(await chatComplete(translationMessages(items), { temperature: 0.2 }), items.length);
}

async function viaServer(items) {
    const response = await fetch(`${API_BASE}/api/ai/translate-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authToken: getAuthToken(), items }),
        signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data && Array.isArray(data.items) ? data.items : null;
}

/** The `i18n` to save with each of `tasks` ({title, description}), in order; null where the translation failed
 *  (the task is then saved and shown as written). Never throws. */
export function translateTasks(tasks) {
    if (!tasks.length) return Promise.resolve([]);
    return buildTaskTranslations(tasks, hasOwnKey() ? viaOwnKey : viaServer);
}
