/* Talking to an AI provider directly from the browser, with the user's own API key.
 *
 * Why: the key never reaches PlanTriz's servers, and the request does not use the site's shared AI allowance.
 * Only providers that answer browser (CORS) requests and speak the OpenAI chat-completions format are offered;
 * the list is also the `connect-src` allowlist in frontend/_headers, so a page that was somehow tampered with
 * still cannot send the key anywhere else. The URL always comes from this table, never from stored settings.
 *
 * No DOM access here (storage and fetch can be injected), so it is unit-tested with a fake fetch. */

export const PROVIDERS = {
    groq: {
        label: 'Groq',
        url: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'openai/gpt-oss-120b',
        fallbackModel: 'openai/gpt-oss-20b',
        keyUrl: 'https://console.groq.com/keys',
    },
    openai: {
        label: 'OpenAI',
        url: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o-mini',
        fallbackModel: '',
        keyUrl: 'https://platform.openai.com/api-keys',
    },
    gemini: {
        label: 'Google Gemini',
        url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        model: 'gemini-2.5-flash',
        fallbackModel: 'gemini-2.5-flash-lite',
        keyUrl: 'https://aistudio.google.com/apikey',
    },
    openrouter: {
        label: 'OpenRouter',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        model: 'openai/gpt-4o-mini',
        fallbackModel: '',
        keyUrl: 'https://openrouter.ai/keys',
    },
    deepseek: {
        label: 'DeepSeek',
        url: 'https://api.deepseek.com/chat/completions',
        model: 'deepseek-chat',
        fallbackModel: '',
        keyUrl: 'https://platform.deepseek.com/api_keys',
    },
};

export const DEFAULT_PROVIDER = 'groq';
export const STORAGE_KEY = 'plantrizAi';
const REQUEST_TIMEOUT_MS = 50000;

/** kind: 'auth' (key rejected) | 'rate' (limit reached) | 'model' (unknown model) | 'network' (unreachable,
 *  or blocked by the provider's CORS rules) | 'timeout' | 'bad' (any other HTTP error) | 'empty' | 'config'. */
export class LlmClientError extends Error {
    /** @param {string} kind  @param {number | null} [status]  @param {string} [detail] */
    constructor(kind, status = null, detail = '') {
        super(`${kind}${status ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}`);
        this.name = 'LlmClientError';
        this.kind = kind;
        this.status = status;
    }
}

// ---- stored settings ------------------------------------------------------------------------------------------
// By default the key lives in sessionStorage (gone when the tab closes). "Remember on this device" uses
// localStorage instead. Storage can be unavailable (private mode, blocked), so every access is guarded.

function defaultStorages() {
    const pick = (name) => { try { return globalThis[name] || null; } catch (e) { return null; } };
    return { session: pick('sessionStorage'), local: pick('localStorage') };
}

function readFrom(storage) {
    try {
        const raw = storage && storage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.apiKey !== 'string' || !parsed.apiKey.trim()) return null;
        return {
            provider: Object.prototype.hasOwnProperty.call(PROVIDERS, parsed.provider) ? parsed.provider : DEFAULT_PROVIDER,
            apiKey: parsed.apiKey.trim(),
            model: typeof parsed.model === 'string' ? parsed.model.trim() : '',
        };
    } catch (e) {
        return null;
    }
}

/** The saved settings, or null when no key is saved. `remember` says it came from the long-lived storage. */
export function loadConfig(storages = defaultStorages()) {
    const fromSession = readFrom(storages.session);
    if (fromSession) return { ...fromSession, remember: false };
    const fromLocal = readFrom(storages.local);
    return fromLocal ? { ...fromLocal, remember: true } : null;
}

export function hasOwnKey(storages = defaultStorages()) {
    return loadConfig(storages) !== null;
}

/** Saves the settings (replacing any earlier ones). Returns false when the browser would not store them. */
export function saveConfig({ provider, apiKey, model }, remember, storages = defaultStorages()) {
    const value = JSON.stringify({
        provider: Object.prototype.hasOwnProperty.call(PROVIDERS, provider) ? provider : DEFAULT_PROVIDER,
        apiKey: String(apiKey || '').trim(),
        model: String(model || '').trim(),
    });
    const target = remember ? storages.local : storages.session;
    const other = remember ? storages.session : storages.local;
    try {
        if (!target) return false;
        target.setItem(STORAGE_KEY, value);
        try { if (other) other.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
        return true;
    } catch (e) {
        return false;
    }
}

export function clearConfig(storages = defaultStorages()) {
    for (const storage of [storages.session, storages.local]) {
        try { if (storage) storage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    }
}

/** For showing a saved key: the start and end only, never the whole thing. */
export function maskKey(key) {
    const k = String(key || '');
    if (k.length <= 12) return k ? '••••••••' : '';
    return `${k.slice(0, 3)}••••••••${k.slice(-4)}`;
}

// ---- requests ---------------------------------------------------------------------------------------------------

function kindForStatus(status) {
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate';
    if (status === 404) return 'model';
    return 'bad';
}

function timeoutSignal(ms) {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
}

async function postOnce(provider, apiKey, model, messages, temperature, fetchImpl, timeoutMs) {
    const send = (withTemperature) => fetchImpl(provider.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(withTemperature ? { model, temperature, messages } : { model, messages }),
        signal: timeoutSignal(timeoutMs),
    });
    let response;
    try {
        response = await send(true);
        if (response.status === 400) {
            // Some models (the newest OpenAI ones) accept only the default temperature: ask again without it.
            const detail = await response.text().catch(() => '');
            if (!/temperature/i.test(detail)) throw new LlmClientError(/model/i.test(detail) ? 'model' : 'bad', 400);
            response = await send(false);
        }
    } catch (error) {
        if (error instanceof LlmClientError) throw error;
        if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new LlmClientError('timeout');
        throw new LlmClientError('network');
    }
    if (!response.ok) throw new LlmClientError(kindForStatus(response.status), response.status);
    let data;
    try { data = await response.json(); } catch (e) { throw new LlmClientError('empty'); }
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== 'string') throw new LlmClientError('empty');
    return content;
}

/** @typedef {{ config?: any, temperature?: number, fetchImpl?: Function, timeoutMs?: number }} RequestOptions */

/** Sends `messages` ([{role, content}]) and returns the reply text. When the model is rate limited (HTTP 429) the
 *  provider's fallback model is tried once, because free-tier limits are counted per model.
 *  Throws LlmClientError. */
/** @param {{role: string, content: string}[]} messages  @param {RequestOptions} [options] */
export async function chatComplete(messages, { config = loadConfig(), temperature = 0.3, fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    if (!config || !config.apiKey) throw new LlmClientError('config', null, 'no key');
    const provider = Object.prototype.hasOwnProperty.call(PROVIDERS, config.provider) ? PROVIDERS[config.provider] : null;
    if (!provider) throw new LlmClientError('config', null, 'unknown provider');
    const doFetch = fetchImpl || ((...args) => fetch(...args));
    const model = config.model || provider.model;
    try {
        return await postOnce(provider, config.apiKey, model, messages, temperature, doFetch, timeoutMs);
    } catch (error) {
        const fallback = config.model ? '' : provider.fallbackModel; // a model the user typed is theirs to manage
        if (error instanceof LlmClientError && error.kind === 'rate' && fallback && fallback !== model) {
            return postOnce(provider, config.apiKey, fallback, messages, temperature, doFetch, timeoutMs);
        }
        throw error;
    }
}

/** A cheap request that shows whether the key, provider and model work together. */
/** @param {any} config  @param {RequestOptions} [options] */
export async function testConnection(config, options = {}) {
    await chatComplete([{ role: 'user', content: 'Reply with the single word OK.' }], { ...options, config, temperature: 0 });
    return true;
}

/** The same prompts the server uses for its own translate button. */
export function translateMessages(text, targetLang) {
    const system = targetLang === 'en'
        ? "You are a translator. Translate the user's text into English. Return ONLY the translated text, no quotes, no explanation, no markdown."
        : '你是一个翻译助手。请将用户提供的文本翻译成中文。只返回翻译结果，不要引号、不要解释、不要 markdown。';
    return [{ role: 'system', content: system }, { role: 'user', content: text }];
}

/** @param {string} text  @param {string} targetLang  @param {RequestOptions} [options] */
export async function translateWithOwnKey(text, targetLang, options = {}) {
    return (await chatComplete(translateMessages(text, targetLang), { ...options, temperature: 0.2 })).trim();
}

// ---- errors, in words the user can act on -------------------------------------------------------------------------

/** A failed request to PlanTriz's own AI endpoints (the built-in assistant); `status` is the HTTP status. */
export class AssistantRequestError extends Error {
    /** @param {number} status  @param {string} [detail] */
    constructor(status, detail = '') {
        super(`AI request failed: ${status}${detail ? ` ${detail}` : ''}`);
        this.name = 'AssistantRequestError';
        this.status = status;
    }
}

const fill = (template, values) => Object.keys(values).reduce((out, key) => out.split(`{${key}}`).join(values[key]), template || '');

/** The message to show for a failed AI request, in the language of `dict` (a translations table).
 *  `fallback` is used for errors that carry no useful information for the user. */
export function describeAiError(error, dict, { dailyLimit = 0, fallback = '' } = {}) {
    if (error instanceof LlmClientError) {
        switch (error.kind) {
            case 'auth': return dict.aiErrAuth;
            case 'rate': return dict.aiErrRate;
            case 'model': return dict.aiErrModel;
            case 'network': return dict.aiErrNetwork;
            case 'timeout': return dict.aiErrTimeout;
            case 'empty': return dict.aiErrEmpty;
            case 'config': return dict.aiErrNoKey;
            default: return fill(dict.aiErrOther, { status: error.status || '?' });
        }
    }
    const status = error && error.status;
    if (status === 401) return dict.aiNeedKeyOrSignIn;
    if (status === 429) return fill(dict.aiQuotaReached, { n: dailyLimit || '' });
    return fallback || dict.aiConnectFail;
}
