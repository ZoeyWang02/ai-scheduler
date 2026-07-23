import { state } from './state.js';
import { translations } from './i18n.js';
import { getChatAvatarSrc, pulseBuddyAvatar } from './buddy.js';
import { pulseBuddyWidget, showBuddyBubble } from './buddyWidget.js';
import { loadTasks } from './scheduler.js';

// Escalation tiers, buddy-voice first: the in-widget stages (pulse + speech
// bubble) always fire regardless of Notification permission — the OS
// notification is a strictly additive extra layer, never a dependency.
// Ordered by lead time so a future tier (e.g. a next-day digest) can be
// appended without restructuring the check loop.
const TIERS = [
    { id: 'headsUp', leadMinutes: 120, notifyOS: false, messageKey: 'reminderHeadsUpMessage' },
    { id: 'urgent', leadMinutes: 30, notifyOS: true, messageKey: 'reminderUrgentMessage' },
];

const ENABLED_KEY = 'remindersEnabled';
const NOTIFIED_KEY = 'notifiedReminders';
const CHECK_INTERVAL_MS = 60 * 1000;
const REFRESH_TASKS_INTERVAL_MS = 5 * 60 * 1000;

let checkIntervalId = null;
let refreshIntervalId = null;

function getNotifiedSet() {
    try {
        return new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]'));
    } catch {
        return new Set();
    }
}

function saveNotifiedSet(set) {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...set]));
}

function formatMessage(key, title) {
    const lang = localStorage.getItem('appLang') || 'zh';
    const template = translations[lang][key];
    return template.replace('{title}', title);
}

function fireTier(task, tier, notifiedSet) {
    const message = formatMessage(tier.messageKey, task.title);
    pulseBuddyAvatar();
    pulseBuddyWidget();
    showBuddyBubble(message);

    if (tier.notifyOS && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const notification = new Notification(task.title, { body: message, icon: getChatAvatarSrc() });
        notification.onclick = () => {
            window.focus();
            const drawer = document.getElementById('taskDrawer');
            if (drawer && !drawer.classList.contains('open') && window.toggleTaskDrawer) {
                window.toggleTaskDrawer();
            }
        };
    }

    notifiedSet.add(`${task.id}:${tier.id}`);
}

function checkDeadlines() {
    if (localStorage.getItem(ENABLED_KEY) !== 'true') return;
    const notifiedSet = getNotifiedSet();
    const now = Date.now();
    let changed = false;

    state.lastLoadedTasks.forEach(task => {
        if (task.completed || !task.dueDate) return;
        const due = new Date(task.dueDate).getTime();
        if (Number.isNaN(due)) return;
        const minutesUntilDue = (due - now) / 60000;

        TIERS.forEach(tier => {
            const key = `${task.id}:${tier.id}`;
            if (notifiedSet.has(key)) return;
            if (minutesUntilDue <= tier.leadMinutes) {
                fireTier(task, tier, notifiedSet);
                changed = true;
            }
        });
    });

    if (changed) saveNotifiedSet(notifiedSet);
}

function startReminderLoop() {
    if (checkIntervalId) return;
    checkDeadlines();
    checkIntervalId = setInterval(checkDeadlines, CHECK_INTERVAL_MS);
    refreshIntervalId = setInterval(() => {
        const tzSelect = document.getElementById('timezoneSelect');
        if (tzSelect && tzSelect.value) loadTasks(tzSelect.value);
    }, REFRESH_TASKS_INTERVAL_MS);
}

function stopReminderLoop() {
    clearInterval(checkIntervalId);
    clearInterval(refreshIntervalId);
    checkIntervalId = null;
    refreshIntervalId = null;
}

function updateStatusText() {
    const statusEl = document.getElementById('remindersStatus');
    const btn = document.getElementById('remindersToggleBtn');
    const lang = localStorage.getItem('appLang') || 'zh';
    const dict = translations[lang];
    const enabled = localStorage.getItem(ENABLED_KEY) === 'true';

    if (btn) btn.textContent = enabled ? dict.remindersDisableBtn : dict.remindersEnableBtn;
    if (!statusEl) return;

    if (!enabled) {
        statusEl.textContent = dict.remindersStatusOff;
    } else if (typeof Notification === 'undefined') {
        statusEl.textContent = dict.remindersStatusUnsupported;
    } else if (Notification.permission === 'granted') {
        statusEl.textContent = dict.remindersStatusGranted;
    } else {
        statusEl.textContent = dict.remindersStatusEnabledNoOS;
    }
}

export function toggleReminders() {
    const isEnabled = localStorage.getItem(ENABLED_KEY) === 'true';
    if (isEnabled) {
        localStorage.setItem(ENABLED_KEY, 'false');
        stopReminderLoop();
        updateStatusText();
        return;
    }

    localStorage.setItem(ENABLED_KEY, 'true');
    startReminderLoop();
    if (typeof Notification !== 'undefined' && Notification.permission !== 'denied') {
        Notification.requestPermission().then(updateStatusText);
    }
    updateStatusText();
}

export function initReminders() {
    updateStatusText();
    if (localStorage.getItem(ENABLED_KEY) === 'true') {
        startReminderLoop();
    }
}
