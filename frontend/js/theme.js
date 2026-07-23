import { state } from './state.js';
import { API_BASE } from './config.js';
import { getUserId, getAuthToken } from './auth.js';

export function setTheme(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('appTheme', theme);
            const select = document.getElementById('themeSelect');
            if (select) select.value = theme;
        }

export function previewTheme(theme) {
            state.pendingTheme = theme;
            document.documentElement.setAttribute('data-theme', theme);
        }

/* Rail moon button: flip between day Stardew and its late-night variant.
   Only toggles within the Stardew family — from any other theme it drops into
   night Stardew (its own family) rather than trying to "night" light/dark,
   which have no night variant. Persists via setTheme (localStorage +
   #themeSelect) and best-effort syncs to the account so it survives across
   devices, matching how the Settings dropdown saves. */
export function toggleNightMode() {
            const current = localStorage.getItem('appTheme') || 'stardew';
            const next = current === 'stardew-night' ? 'stardew' : 'stardew-night';
            setTheme(next);
            state.pendingTheme = next;
            if (getUserId()) {
                // The backend replaces the whole preferences map on PUT, so
                // resend the current studyBuddy alongside theme or it gets wiped.
                const studyBuddy = localStorage.getItem('studyBuddy') || 'junimo';
                fetch(`${API_BASE}/api/auth/preferences?userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ theme: next, studyBuddy })
                }).catch(e => console.error('Night-mode preference sync failed', e));
            }
        }
