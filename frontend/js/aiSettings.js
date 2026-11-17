/* The "Use your own AI key" part of the settings dialog. The key is kept in this browser only (see llmClient.js). */

import { state } from './state.js';
import { translations } from './i18n.js';
import { showToast } from './utils.js';
import { refreshAiAvailability } from './chat.js';
import { clearConfig, DEFAULT_PROVIDER, describeAiError, hasOwnKey, loadConfig, maskKey, PROVIDERS, saveConfig, testConnection } from './llmClient.js';

const el = (id) => document.getElementById(id);
const dictionary = () => translations[localStorage.getItem('appLang') || 'zh'];

function setStatus(text, kind = '') {
    const status = el('aiKeyStatus');
    if (!status) return;
    status.textContent = text;
    status.dataset.kind = kind; // '' | 'ok' | 'error'
}

/** Fills the provider list once, and shows the saved settings (the key itself only masked). */
export function renderAiSettings() {
    const select = el('aiProviderSelect');
    if (!select) return;
    if (!select.options.length) {
        for (const [id, provider] of Object.entries(PROVIDERS)) select.add(new Option(provider.label, id));
    }
    const saved = loadConfig();
    select.value = saved ? saved.provider : DEFAULT_PROVIDER;
    el('aiKeyInput').value = '';
    el('aiModelInput').value = saved ? saved.model : '';
    el('aiRememberCheck').checked = saved ? saved.remember : false;
    showProviderDetails(select.value);
    const dict = dictionary();
    setStatus(saved ? `${dict.aiKeySavedAs} ${maskKey(saved.apiKey)}` : dict.aiKeyNone);
}

function showProviderDetails(providerId) {
    const provider = PROVIDERS[providerId] || PROVIDERS[DEFAULT_PROVIDER];
    el('aiModelInput').placeholder = provider.model;
    const link = el('aiKeyLink');
    link.href = provider.keyUrl;
    el('aiKeyInput').placeholder = loadConfig() && loadConfig().provider === providerId ? dictionary().aiKeyKeepPlaceholder : 'API key';
}

export function aiProviderChanged(providerId) {
    showProviderDetails(providerId);
}

/** What the fields say right now, or an { error } for the user. A blank key field keeps the saved key, but only for the
 *  same provider: a key for one provider is useless (and wrong to send) to another. */
function readFields() {
    const dict = dictionary();
    const provider = el('aiProviderSelect').value;
    const typed = el('aiKeyInput').value.trim();
    const saved = loadConfig();
    const apiKey = typed || (saved && saved.provider === provider ? saved.apiKey : '');
    if (!apiKey) return { error: dict.aiKeyMissing };
    const model = el('aiModelInput').value.trim();
    return {
        config: { provider, apiKey, model: model === PROVIDERS[provider].model ? '' : model },
        remember: el('aiRememberCheck').checked,
    };
}

function persist({ config, remember }) {
    const ok = saveConfig(config, remember);
    if (!ok) setStatus(dictionary().aiKeyStoreFail, 'error');
    refreshAiAvailability();
    return ok;
}

/** Called by "Save" in the settings dialog: stores the key fields when a key is entered (nothing to do otherwise). */
export function saveAiSettings() {
    if (!el('aiKeyInput').value.trim() && !hasOwnKey()) return true;
    const fields = readFields();
    if (fields.error) { setStatus(fields.error, 'error'); return false; }
    return persist(fields);
}

/** Tries the key with a tiny request; keeps it when it works. */
export async function testAiKey() {
    const dict = dictionary();
    const fields = readFields();
    if (fields.error) { setStatus(fields.error, 'error'); return; }
    const button = el('aiTestBtn');
    button.disabled = true;
    setStatus(dict.aiTesting);
    try {
        await testConnection(fields.config);
        if (persist(fields)) {
            el('aiKeyInput').value = '';
            setStatus(`${dict.aiTestOk} ${maskKey(fields.config.apiKey)}`, 'ok');
            showToast(dict.aiKeySaved, 'success');
        }
    } catch (error) {
        setStatus(describeAiError(error, dict, { dailyLimit: state.aiDailyLimit }), 'error');
    } finally {
        button.disabled = false;
    }
}

export function clearAiKey() {
    clearConfig();
    el('aiKeyInput').value = '';
    el('aiModelInput').value = '';
    el('aiRememberCheck').checked = false;
    refreshAiAvailability();
    showProviderDetails(el('aiProviderSelect').value);
    setStatus(dictionary().aiKeyNone);
    showToast(dictionary().aiKeyRemoved, 'info');
}
