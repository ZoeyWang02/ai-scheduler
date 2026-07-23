import { API_BASE } from './config.js';
import { state } from './state.js';
import { showToast } from './utils.js';
import { setTheme } from './theme.js';
import { refreshBuddyState, renderAvatarPicker, renderBuddyStatus, syncAllBuddyAvatars } from './buddy.js';
import { getAuthToken, getUserId } from './auth.js';

export function openSettingsModal() {
            state.pendingTheme = localStorage.getItem('appTheme') || 'stardew';
            state.pendingBuddy = localStorage.getItem('studyBuddy') || 'junimo';
            const select = document.getElementById('themeSelect');
            if (select) select.value = state.pendingTheme;
            renderAvatarPicker();
            renderBuddyStatus();
            if (getUserId()) refreshBuddyState();
            document.getElementById('settingsModal').style.display = 'block';
        }

export async function saveSettings() {
            if (state.pendingTheme) setTheme(state.pendingTheme);
            if (state.pendingBuddy) {
                localStorage.setItem('studyBuddy', state.pendingBuddy);
                syncAllBuddyAvatars();
            }
            const lang = localStorage.getItem('appLang') || 'zh';
            if (getUserId()) {
                try {
                    const response = await fetch(`${API_BASE}/api/auth/preferences?userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ theme: state.pendingTheme, studyBuddy: state.pendingBuddy })
                    });
                    if (!response.ok) {
                        console.error('Preferences sync failed', response.status, await response.text());
                        showToast(lang === 'zh' ? '设置已保存到本机，但同步到账号失败' : 'Saved locally, but syncing to your account failed', 'error');
                        closeSettingsModal();
                        return;
                    }
                } catch (e) {
                    console.error('Failed to sync preferences to server', e);
                    showToast(lang === 'zh' ? '设置已保存到本机，但同步到账号失败' : 'Saved locally, but syncing to your account failed', 'error');
                    closeSettingsModal();
                    return;
                }
            } else {
                showToast(lang === 'zh' ? '已保存到本机（登录后可跨设备同步）' : 'Saved locally (sign in to sync across devices)', 'info');
                closeSettingsModal();
                return;
            }
            showToast(lang === 'zh' ? '设置已保存' : 'Settings saved', 'success');
            closeSettingsModal();
        }

export function applyServerPreferences(prefs) {
            if (!prefs) return;
            if (prefs.theme) setTheme(prefs.theme);
            if (prefs.studyBuddy) {
                localStorage.setItem('studyBuddy', prefs.studyBuddy);
                syncAllBuddyAvatars();
            }
        }

export function closeSettingsModal() {
            document.documentElement.setAttribute('data-theme', localStorage.getItem('appTheme') || 'stardew');
            document.getElementById('settingsModal').style.display = 'none';
        }
