import { API_BASE } from './config.js';
import { state } from './state.js';
import { translations } from './i18n.js';
import { refreshBuddyState, renderBuddyMoodBadge, renderBuddyStatus } from './buddy.js';
import { applyServerPreferences } from './settings.js';
import { refreshUserScopedViews } from './app.js';

export function getUserId() {
            return state.currentUser && state.currentUser.id ? state.currentUser.id : null;
        }

export function getAuthToken() {
            return state.currentUser && state.currentUser.token ? state.currentUser.token : '';
        }

export function addAuthParams(params) {
            if (getUserId()) {
                params.set('userId', getUserId());
                params.set('authToken', getAuthToken());
            }
            return params;
        }

export function requireUser() {
            if (getUserId()) return true;
            const lang = localStorage.getItem('appLang') || 'zh';
            alert(translations[lang].alertRequireUser);
            return false;
        }

export function renderAuthState() {
            const authForm = document.getElementById('authForm');
            const authUser = document.getElementById('authUser');
            const authGuestNav = document.getElementById('authGuestNav');
            const authUserNav = document.getElementById('authUserNav');

            if (state.currentUser) {
                authForm.style.display = 'none';
                authUser.style.display = 'flex';
                document.getElementById('authUserName').innerText = state.currentUser.username || state.currentUser.name || 'Student';
                document.getElementById('authUserEmail').innerText = state.currentUser.email || '';

                if (authGuestNav) authGuestNav.style.display = 'none';
                if (authUserNav) authUserNav.style.display = 'flex';
                document.getElementById('topAuthName').innerText = state.currentUser.username || state.currentUser.name || 'Student';
            } else {
                authForm.style.display = 'flex';
                authUser.style.display = 'none';

                if (authGuestNav) authGuestNav.style.display = 'flex';
                if (authUserNav) authUserNav.style.display = 'none';
            }
        }

export function openAuthModal(mode) {
            document.getElementById('authModal').style.display = 'block';
            if (state.currentUser || mode === 'account') {
                document.getElementById('authForm').style.display = 'none';
                document.getElementById('authUser').style.display = 'flex';
                const lang = localStorage.getItem('appLang') || 'zh';
                document.getElementById('authModalTitle').innerText = lang === 'zh' ? '账户中心' : 'Account Center';
            } else {
                document.getElementById('authForm').style.display = 'flex';
                document.getElementById('authUser').style.display = 'none';
                setAuthMode(mode);
            }
        }

export function closeAuthModal() {
            document.getElementById('authModal').style.display = 'none';
        }

export function setAuthMode(mode) {
            state.authMode = mode;
            const isSignUp = mode === 'signup';
            const isReset = mode === 'reset';
            const lang = localStorage.getItem('appLang') || 'zh';
            const dict = translations[lang];

            document.getElementById('authModalTitle').innerText = isReset ? dict.forgotPasswordLink : (isSignUp ? dict.btnSignUpTab : dict.btnSignInTab);
            document.getElementById('authSubmitBtn').innerText = isReset ? dict.resetPasswordBtn : (isSignUp ? dict.btnSignUpTab : dict.btnSignInTab);

            document.getElementById('authSignInTab').classList.toggle('active', !isSignUp && !isReset);
            document.getElementById('authSignUpTab').classList.toggle('active', isSignUp);
            document.getElementById('authUsername').style.display = isSignUp ? 'block' : 'none';
            document.getElementById('authEmail').style.display = isSignUp ? 'block' : 'none';
            document.getElementById('authIdentifier').style.display = (!isSignUp && !isReset) ? 'block' : 'none';
            document.getElementById('authPassword').style.display = isReset ? 'none' : 'block';
            document.getElementById('forgotPasswordRow').style.display = (!isSignUp && !isReset) ? 'flex' : 'none';
            document.getElementById('resetFields').style.display = isReset ? 'flex' : 'none';
            document.getElementById('socialAuthBlock').style.display = isReset ? 'none' : 'flex';
            document.getElementById('socialAuthGrid').style.display = isReset ? 'none' : 'grid';

            document.getElementById('authHint').innerText = isReset ? dict.alertResetEmail : (isSignUp ? dict.alertSignUp : dict.authHint);
        }

export async function submitCurrentAuth() {
            if (state.authMode === 'signup') {
                await signUp();
            } else if (state.authMode === 'reset') {
                await resetPassword();
            } else {
                await signIn();
            }
        }

export async function signUp() {
            const username = document.getElementById('authUsername').value.trim();
            const email = document.getElementById('authEmail').value.trim();
            const password = document.getElementById('authPassword').value;
            const lang = localStorage.getItem('appLang') || 'zh';
            if (!username || !email || password.length < 6) {
                alert(translations[lang].alertSignUp);
                return;
            }
            await submitAuth(`${API_BASE}/api/auth/signup`, { username, email, password });
        }

export async function signIn() {
            const identifier = document.getElementById('authIdentifier').value.trim();
            const password = document.getElementById('authPassword').value;
            const lang = localStorage.getItem('appLang') || 'zh';
            if (!identifier || !password) {
                alert(translations[lang].alertSignIn);
                return;
            }
            await submitAuth(`${API_BASE}/api/auth/signin`, { identifier, password });
        }

export async function requestPasswordCode() {
            const email = document.getElementById('resetEmail').value.trim();
            const lang = localStorage.getItem('appLang') || 'zh';
            if (!email) {
                alert(translations[lang].alertResetEmail);
                return;
            }
            const response = await fetch(`${API_BASE}/api/auth/password-reset/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const result = await response.json().catch(async () => ({ message: await response.text() }));
            alert(response.ok ? (result.message || translations[lang].resetCodeSent) : (result.message || translations[lang].checkInput));
        }

export async function resetPassword() {
            const email = document.getElementById('resetEmail').value.trim();
            const code = document.getElementById('resetCode').value.trim();
            const password = document.getElementById('resetPassword').value;
            const lang = localStorage.getItem('appLang') || 'zh';
            if (!email || !code || password.length < 6) {
                alert(translations[lang].alertResetCode);
                return;
            }
            const response = await fetch(`${API_BASE}/api/auth/password-reset/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code, password })
            });
            const result = await response.json().catch(async () => ({ message: await response.text() }));
            if (!response.ok) {
                alert(result.message || translations[lang].checkInput);
                return;
            }
            alert(result.message || translations[lang].resetDone);
            setAuthMode('signin');
        }

export async function startExternalAuth(provider) {
            const lang = localStorage.getItem('appLang') || 'zh';
            if (provider === 'google') {
                window.location.href = `${API_BASE}/api/auth/oauth/google/start`;
                return;
            }
            const response = await fetch(`${API_BASE}/api/auth/oauth/${encodeURIComponent(provider)}/start`, { method: 'POST' });
            const result = await response.json().catch(async () => ({ message: await response.text() }));
            alert(result.message || translations[lang].alertExternalAuth);
        }

export async function submitAuth(url, payload) {
            const timezone = document.getElementById('timezoneSelect').value;
            const lang = localStorage.getItem('appLang') || 'zh';
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, timezone })
            });

            if (!response.ok) {
                const error = await response.json().catch(async () => ({ message: await response.text() }));
                alert(translations[lang].alertAuthFail + (error.message || translations[lang].checkInput));
                return;
            }

            state.currentUser = await response.json();
            localStorage.setItem('nexusUser', JSON.stringify(state.currentUser));
            applyServerPreferences(state.currentUser.preferences);
            if (state.currentUser.timezone) {
                document.getElementById('timezoneSelect').value = state.currentUser.timezone;
            }
            renderAuthState();
            closeAuthModal();
            refreshUserScopedViews();
            refreshBuddyState();
        }

export function consumeOAuthRedirect() {
            const hash = window.location.hash;
            if (!hash.startsWith('#oauthUser=') && !hash.startsWith('#oauthError=')) return;
            const [key, rawValue] = hash.slice(1).split('=');
            history.replaceState(null, '', window.location.pathname + window.location.search);
            // The backend encodes this fragment with Java's URLEncoder, which
            // uses the application/x-www-form-urlencoded convention (space
            // becomes '+'), not JS's encodeURIComponent convention (space
            // becomes %20). decodeURIComponent alone doesn't undo the '+'
            // form, so it must be converted back to a literal space first —
            // otherwise any field with a space (e.g. a Google profile's real
            // display name) comes back corrupted.
            const decodedValue = decodeURIComponent(rawValue.replace(/\+/g, ' '));

            if (key === 'oauthError') {
                alert(decodedValue);
                return;
            }

            state.currentUser = JSON.parse(decodedValue);
            localStorage.setItem('nexusUser', JSON.stringify(state.currentUser));
            applyServerPreferences(state.currentUser.preferences);
            if (state.currentUser.timezone) {
                document.getElementById('timezoneSelect').value = state.currentUser.timezone;
            }
            renderAuthState();
            refreshUserScopedViews();
            refreshBuddyState();
        }

export function signOut() {
            state.currentUser = null;
            localStorage.removeItem('nexusUser');
            state.lastBuddyState = null;
            renderBuddyStatus();
            renderBuddyMoodBadge();
            renderAuthState();
            refreshUserScopedViews();
        }
