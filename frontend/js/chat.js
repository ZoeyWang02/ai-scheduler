import { API_BASE } from './config.js';
import { state } from './state.js';
import { translations } from './i18n.js';
import { escapeHtml, linkify, showToast } from './utils.js';
import { getChatAvatarSrc } from './buddy.js';
import { getAuthToken, getUserId, requireUser } from './auth.js';
import { getActiveAnalysisPeriod, loadLifestyleAnalysis } from './analytics.js';
import { loadTasks } from './scheduler.js';

export async function sendMessage() {
            const input = document.getElementById('userInput');
            const message = input.value;
            const lang = localStorage.getItem('appLang') || 'zh';
            if (!message) return;
            if (!state.aiConfigured) {
                showToast(lang === 'zh' ? 'AI 服务离线，暂时无法发送' : 'AI service is offline, cannot send right now', 'error');
                return;
            }

            appendMessage('user', message);
            input.value = '';

            const messagesContainer = document.getElementById('messages');
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'message ai';
            loadingDiv.id = 'ai-loading-placeholder';
            loadingDiv.innerHTML = `<div class="typing-loader"><span></span><span></span><span></span></div>`;
            messagesContainer.appendChild(loadingDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;

            try {
                const response = await fetch(`${API_BASE}/api/ai/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: message,
                        userId: getUserId() ? String(getUserId()) : '',
                        authToken: getAuthToken(),
                        timezone: document.getElementById('timezoneSelect').value,
                        lang: lang
                    })
                });
                if (!response.ok) throw new Error('AI request failed: ' + response.status);
                const data = await response.text();

                // 馃専 璇锋眰缁撴潫锛岀珛鍒绘懅姣佸姞杞芥
                if (document.getElementById('ai-loading-placeholder')) {
                    document.getElementById('ai-loading-placeholder').remove();
                }

                const jsonMatch = extractJsonArray(data);
                if (jsonMatch) {
                    const textBefore = data.split(jsonMatch)[0];
                    if (textBefore.trim()) appendMessage('ai', textBefore);
                    appendAiPlanner(jsonMatch);
                } else {
                    appendMessage('ai', data);
                }
            } catch (e) {
                if (document.getElementById('ai-loading-placeholder')) {
                    document.getElementById('ai-loading-placeholder').remove();
                }
                appendMessage('ai', translations[lang].aiConnectFail, true);
                input.value = message;
            }
        }

export function triggerAutoAiPlanner(type) {
            const platform = type === 'canvas' ? 'Canvas' : 'Coursera';
            const lang = localStorage.getItem('appLang') || 'zh';

            // 馃専 鏍稿績浼樺寲锛氬ぇ妯″瀷瑙﹀彂 Prompt 浼氭牴鎹綋鍓嶇郴缁熻瑷€鑷姩鍒囨崲涓嫳鐗堟湰
            const autoMessage = lang === 'zh'
                ? `我刚导入了最新的 ${platform} 作业数据。请结合我的作息和课程忙碌时间，找出未来一周最紧急的任务，拆成每天的 To-Do List，并推荐具体执行时间。`
                : `I have just imported the latest ${platform} assignment data. Please evaluate the most urgent assignments over the next week based on my routine profile, decompose them into structured daily tasks, and recommend specific execution hours.`;

            appendMessage('user', translations[lang].sysNotifyImport + platform + translations[lang].sysNotifyRequest);

            fetch(`${API_BASE}/api/ai/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: autoMessage,
                    userId: getUserId() ? String(getUserId()) : '',
                    authToken: getAuthToken(),
                    timezone: document.getElementById('timezoneSelect').value,
                    lang: lang
                })
            })
                .then(res => res.text())
                .then(data => {
                    const jsonMatch = extractJsonArray(data);
                    if (jsonMatch) {
                        const textBefore = data.split(jsonMatch)[0];
                        if (textBefore.trim()) appendMessage('ai', textBefore);
                        appendAiPlanner(jsonMatch);
                    } else {
                        appendMessage('ai', data);
                    }
                })
                .catch(err => appendMessage('ai', translations[lang].aiAnalysisFail));
        }

export function appendAiPlanner(jsonString) {
            try {
                const tasks = JSON.parse(jsonString);
                const messagesContainer = document.getElementById('messages');
                const plannerDiv = document.createElement('div');
                const lang = localStorage.getItem('appLang') || 'zh';
                const dict = translations[lang];

                plannerDiv.className = 'ai-planner-box';
                plannerDiv.innerHTML = `
            <div class="planner-header">${dict.plannerHeader}</div>
            ${tasks.map((t, i) => `
                <div class="planner-item">
                    <input type="checkbox" id="ai-step-${i}" checked
                           data-action="${escapeHtml(t.action || 'add')}" data-task-id="${escapeHtml(t.taskId || '')}"
                           data-title="${escapeHtml(t.step || '')}" data-hours="${escapeHtml(t.estimatedHours || 1)}" data-date="${escapeHtml(t.suggestedDate || '')}">
                    <label for="ai-step-${i}">
                        ${escapeHtml((t.action || 'add') === 'delete' ? dict.deleteLabel : dict.addLabel)}: ${escapeHtml(t.step || dict.unnamedPlan)} ${(t.action || 'add') === 'delete' ? '' : `(${escapeHtml(t.estimatedHours || 1)}h)`}
                        <br><span>${escapeHtml((t.action || 'add') === 'delete' ? (t.reason || dict.aiSuggestCancel) : `${dict.suggestedExecution}${t.suggestedDate ? t.suggestedDate.replace('T', ' ') : dict.scheduleLater}`)}</span>
                    </label>
                </div>
            `).join('')}
            <button class="sync-btn" onclick="syncSelectedTasks(this)">${dict.applyPlanBtn}</button>
        `;
                messagesContainer.appendChild(plannerDiv);
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            } catch (e) {
                console.error("解析 AI 计划失败", e);
            }
        }

export function extractJsonArray(text) {
            if (!text) return null;
            for (let start = text.indexOf('['); start >= 0; start = text.indexOf('[', start + 1)) {
                for (let end = text.lastIndexOf(']'); end > start; end = text.lastIndexOf(']', end - 1)) {
                    const candidate = text.slice(start, end + 1);
                    try {
                        const parsed = JSON.parse(candidate);
                        if (Array.isArray(parsed)) return candidate;
                    } catch (e) { }
                }
            }
            return null;
        }

export async function syncSelectedTasks(btn) {
            if (!requireUser()) return;
            const container = btn.parentElement;
            const checkedItems = container.querySelectorAll('input:checked');
            const lang = localStorage.getItem('appLang') || 'zh';
            if (checkedItems.length === 0) { alert(translations[lang].alertNoTaskChecked); return; }
            btn.innerText = translations[lang].syncing;
            btn.disabled = true;

            for (const item of checkedItems) {
                if (item.dataset.action === 'delete') {
                    if (item.dataset.taskId) {
                        await fetch(`${API_BASE}/api/tasks/${item.dataset.taskId}?authToken=${encodeURIComponent(getAuthToken())}`, { method: 'DELETE' });
                    }
                    continue;
                }
                const taskData = {
                    title: "[AI] " + item.dataset.title,
                    description: lang === 'zh' ? `Nexus 生成子任务，预计耗时 ${item.dataset.hours} 小时` : `Subtask generated by Nexus, estimated duration: ${item.dataset.hours} hours`,
                    dueDate: item.dataset.date || new Date().toISOString()
                };

                const currentTz = document.getElementById('timezoneSelect').value;

                await fetch(`${API_BASE}/api/tasks?userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}&timezone=${encodeURIComponent(currentTz)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(taskData)
                });
            }

            btn.innerText = translations[lang].syncDone;
            btn.style.background = "#64748b";
            state.calendar.refetchEvents();
            loadTasks(document.getElementById('timezoneSelect').value);
            loadLifestyleAnalysis(getActiveAnalysisPeriod(), document.getElementById('timezoneSelect').value);
        }

export async function checkAiStatus() {
            try {
                const response = await fetch(`${API_BASE}/api/ai/status`);
                const data = await response.json();
                state.aiConfigured = !!data.configured;
            } catch (e) {
                state.aiConfigured = false;
            }
            renderChatStatus();
        }

export function renderChatStatus() {
            const statusEl = document.getElementById('chatStatus');
            if (!statusEl) return;
            const lang = localStorage.getItem('appLang') || 'zh';
            statusEl.innerText = state.aiConfigured ? translations[lang].statusOnline : translations[lang].statusOffline;
            statusEl.classList.toggle('offline', !state.aiConfigured);
        }

export function appendMessage(role, text, isError = false) {
            const row = document.createElement('div');
            row.className = `message-row ${role}`;
            if (role === 'ai') {
                const avatar = document.createElement('img');
                avatar.className = 'chat-avatar';
                avatar.src = getChatAvatarSrc();
                avatar.alt = 'Study Buddy';
                row.appendChild(avatar);
            }
            const div = document.createElement('div');
            div.className = `message ${role}` + (isError ? ' error' : '');

            const textSpan = document.createElement('span');
            textSpan.className = 'message-text';
            textSpan.innerHTML = linkify(text).replace(/\n/g, '<br>');
            div.appendChild(textSpan);

            if (role === 'ai') {
                const lang = localStorage.getItem('appLang') || 'zh';
                const translateBtn = document.createElement('button');
                translateBtn.type = 'button';
                translateBtn.className = 'translate-btn';
                translateBtn.title = translations[lang].translateTooltip;
                translateBtn.innerText = '🌐';
                translateBtn.onclick = () => toggleTranslate(translateBtn, textSpan, text, 'chat');
                div.appendChild(translateBtn);
            }

            row.appendChild(div);
            const messagesContainer = document.getElementById('messages');
            messagesContainer.appendChild(row);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

export async function requestTranslation(text) {
            const lang = localStorage.getItem('appLang') || 'zh';
            const response = await fetch(`${API_BASE}/api/ai/translate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, targetLang: lang, authToken: getAuthToken() })
            });
            if (!response.ok) throw new Error(await response.text());
            const data = await response.json();
            return data.translated;
        }

export async function toggleTranslate(btn, targetEl, originalText, mode) {
            const lang = localStorage.getItem('appLang') || 'zh';
            if (btn.dataset.translated === '1') {
                if (mode === 'chat') {
                    targetEl.innerHTML = linkify(originalText).replace(/\n/g, '<br>');
                } else {
                    targetEl.innerText = originalText;
                }
                btn.innerText = '🌐';
                btn.dataset.translated = '0';
                return;
            }
            if (!requireUser()) return;
            btn.disabled = true;
            btn.innerText = '…';
            try {
                const translated = await requestTranslation(originalText);
                if (mode === 'chat') {
                    targetEl.innerHTML = linkify(translated).replace(/\n/g, '<br>');
                } else {
                    targetEl.innerText = translated;
                }
                btn.innerText = '↺';
                btn.dataset.translated = '1';
            } catch (e) {
                showToast(lang === 'zh' ? '翻译失败' : 'Translation failed', 'error');
                btn.innerText = '🌐';
            } finally {
                btn.disabled = false;
            }
        }
