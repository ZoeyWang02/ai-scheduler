import { API_BASE } from './config.js';
import { state } from './state.js';
import { translations } from './i18n.js';
import { escapeHtml, linkify, showToast } from './utils.js';
import { getChatAvatarSrc } from './buddy.js';
import { getAuthToken, getUserId, requireUser } from './auth.js';
import { getActiveAnalysisPeriod, loadLifestyleAnalysis } from './analytics.js';
import { buildImportRow, confirmImportRequest, describeImportPreview, importResultMessage, loadTasks, requestImportPreview } from './scheduler.js';
import { refreshUserScopedViews } from './app.js';
import { addMessage, deleteConversation, getConversation, loadConversations, updateMessage } from './chatHistory.js';

import { pixelIcon } from './pixelIcons.js';

/* The conversation currently shown in the chat window. null = a fresh chat that has no
   saved record yet; it is created when the first message is stored. */
let currentConversationId = null;

export async function sendMessage() {
            const input = document.getElementById('userInput');
            const message = input.value;
            const lang = localStorage.getItem('appLang') || 'zh';
            if (!message) return;
            if (!state.aiConfigured) {
                showToast(lang === 'zh' ? 'AI 服务离线，暂时无法发送' : 'AI service is offline, cannot send right now', 'error');
                return;
            }

            // Taken before this message is stored, so it holds only the earlier turns.
            const history = buildChatHistory();
            appendMessage('user', message);
            input.value = '';
            // The reply belongs to this conversation even if the user navigates away while waiting.
            const conversationId = currentConversationId;

            const messagesContainer = document.getElementById('messages');
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'message ai';
            loadingDiv.id = 'ai-loading-placeholder';
            loadingDiv.innerHTML = `<div class="typing-loader"><span></span><span></span><span></span></div>`;
            messagesContainer.appendChild(loadingDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;

            const removeLoading = () => {
                const placeholder = document.getElementById('ai-loading-placeholder');
                if (placeholder) placeholder.remove();
            };

            try {
                const response = await fetch(`${API_BASE}/api/ai/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: message,
                        userId: getUserId() ? String(getUserId()) : '',
                        authToken: getAuthToken(),
                        timezone: document.getElementById('timezoneSelect').value,
                        lang: lang,
                        history: history
                    })
                });
                if (!response.ok) throw new Error('AI request failed: ' + response.status);
                const data = await response.text();

                // The request is done: remove the typing indicator right away.
                removeLoading();

                deliverAiReply(data, message, conversationId);
            } catch (e) {
                removeLoading();
                appendMessage('ai', translations[lang].aiConnectFail, true, { conversationId });
                if (conversationId === currentConversationId) input.value = message;
            }
        }

/* The earlier turns of the open conversation, in the shape the chat API expects, so the AI can
   follow up on them ("move them to the evening"). A plan box becomes one short line listing its
   steps: "[Proposed plan]" until the user applies it, "[Applied plan]" afterwards. */
const HISTORY_TURNS = 8;

export function describePlan(planJson, applied = false) {
            let tasks;
            try { tasks = JSON.parse(planJson); } catch (e) { return ''; }
            if (!Array.isArray(tasks) || !tasks.length) return '';
            const steps = tasks.map(t => (t.action || 'add') === 'delete'
                ? `delete "${t.step || ''}" (taskId ${t.taskId || ''})`
                : `${t.step || ''} (${t.estimatedHours || 1}h) @ ${t.suggestedDate || 'unscheduled'}`);
            return `${applied ? '[Applied plan]' : '[Proposed plan]'} ${steps.join('; ')}`;
        }

export function buildChatHistory(conversation = currentConversationId ? getConversation(currentConversationId) : null) {
            if (!conversation) return [];
            const turns = [];
            for (const m of conversation.messages) {
                if (m.error) continue;
                if (m.role === 'user' && m.text) turns.push({ role: 'user', content: m.text });
                else if (m.role === 'ai' && m.text) turns.push({ role: 'assistant', content: m.text });
                else if (m.role === 'plan') {
                    const line = describePlan(m.plan, !!m.applied);
                    if (line) turns.push({ role: 'assistant', content: line });
                }
            }
            return turns.slice(-HISTORY_TURNS);
        }

// Shows (and stores) an AI reply: prose first, then the plan box when the reply carries a JSON plan.
function deliverAiReply(data, request, conversationId) {
            const jsonMatch = extractJsonArray(data);
            if (jsonMatch) {
                const textBefore = textBeforePlan(data, jsonMatch);
                if (textBefore.trim()) appendMessage('ai', textBefore, false, { conversationId });
                appendAiPlanner(jsonMatch, { request, conversationId });
            } else {
                appendMessage('ai', data, false, { conversationId });
            }
        }

export function triggerAutoAiPlanner(type) {
            const platform = type === 'canvas' ? 'Canvas' : 'Coursera';
            const lang = localStorage.getItem('appLang') || 'zh';

            // The trigger prompt follows the current UI language.
            const autoMessage = lang === 'zh'
                ? `我刚导入了最新的 ${platform} 作业数据。请结合我的作息和课程忙碌时间，找出未来一周最紧急的任务，拆成每天的 To-Do List，并推荐具体执行时间。`
                : `I have just imported the latest ${platform} assignment data. Please evaluate the most urgent assignments over the next week based on my routine profile, decompose them into structured daily tasks, and recommend specific execution hours.`;

            const shownMessage = translations[lang].sysNotifyImport + platform + translations[lang].sysNotifyRequest;
            appendMessage('user', shownMessage);
            const conversationId = currentConversationId;

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
                .then(data => deliverAiReply(data, shownMessage, conversationId))
                .catch(err => appendMessage('ai', translations[lang].aiAnalysisFail, false, { conversationId }));
        }

/* Renders a plan box. `persist` stores it in the chat history; replaying a saved chat passes
   persist:false plus the saved `applied` flag and message id. `request` is the user message the
   plan answers, so the tasks it creates can say where they came from. */
export function appendAiPlanner(jsonString, { request = '', conversationId, persist = true, applied = false, messageId = '' } = {}) {
            try {
                const tasks = JSON.parse(jsonString);
                const showNow = persist ? (conversationId === undefined || conversationId === currentConversationId) : true;
                let storedId = messageId;
                if (persist) {
                    const saved = addMessage(conversationId === undefined ? currentConversationId : conversationId,
                        { role: 'plan', plan: jsonString, request });
                    if (conversationId === undefined || conversationId === currentConversationId) currentConversationId = saved.conversationId;
                    storedId = saved.messageId;
                }
                if (!showNow) return;

                const messagesContainer = document.getElementById('messages');
                const plannerDiv = document.createElement('div');
                const lang = localStorage.getItem('appLang') || 'zh';
                const dict = translations[lang];

                plannerDiv.className = 'ai-planner-box';
                plannerDiv.dataset.messageId = storedId;
                plannerDiv.dataset.request = request;
                plannerDiv.innerHTML = `
            <div class="planner-header">${dict.plannerHeader}</div>
            ${tasks.map((t, i) => `
                <div class="planner-item">
                    <input type="checkbox" id="ai-step-${storedId}-${i}" checked
                           data-action="${escapeHtml(t.action || 'add')}" data-task-id="${escapeHtml(t.taskId || '')}"
                           data-title="${escapeHtml(t.step || '')}" data-hours="${escapeHtml(t.estimatedHours || 1)}" data-date="${escapeHtml(t.suggestedDate || '')}"
                           data-description="${escapeHtml(t.description || '')}">
                    <label for="ai-step-${storedId}-${i}">
                        ${escapeHtml((t.action || 'add') === 'delete' ? dict.deleteLabel : dict.addLabel)}: ${escapeHtml(t.step || dict.unnamedPlan)} ${(t.action || 'add') === 'delete' ? '' : `(${escapeHtml(t.estimatedHours || 1)}h)`}
                        <br><span>${escapeHtml((t.action || 'add') === 'delete' ? (t.reason || dict.aiSuggestCancel) : `${dict.suggestedExecution}${t.suggestedDate ? t.suggestedDate.replace('T', ' ') : dict.scheduleLater}`)}</span>
                    </label>
                </div>
            `).join('')}
            <button class="sync-btn" data-click="syncSelectedTasks" data-args='["@this"]'>${dict.applyPlanBtn}</button>
        `;
                if (applied) {
                    const btn = plannerDiv.querySelector('.sync-btn');
                    btn.innerText = dict.syncDone;
                    btn.disabled = true;
                    plannerDiv.querySelectorAll('input').forEach(input => { input.disabled = true; });
                }
                messagesContainer.appendChild(plannerDiv);
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            } catch (e) {
                console.error("解析 AI 计划失败", e);
            }
        }

// The prose before the plan JSON. Some models wrap the JSON in a ```json fence, and the
// opening fence would otherwise show up as a stray line at the end of the chat bubble.
export function textBeforePlan(data, jsonMatch) {
            return data.split(jsonMatch)[0].replace(/`{3}[a-zA-Z]*\s*$/, '');
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

/* The description saved on a task the AI created: what the step is (written by the AI from the
   user's request), where it came from, and the time estimate. */
export function buildTaskDescription({ description = '', request = '', hours = 1, lang = 'zh' }) {
            const parts = [];
            if (description.trim()) parts.push(description.trim());
            const quoted = request.replace(/\s+/g, ' ').trim();
            if (quoted) {
                const short = quoted.length > 120 ? quoted.slice(0, 120) + '…' : quoted;
                parts.push(lang === 'zh' ? `来自对话："${short}"` : `From chat: "${short}"`);
            }
            parts.push(lang === 'zh' ? `预计耗时 ${hours} 小时` : `Estimated: ${hours} h`);
            return parts.join('\n');
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
                    description: buildTaskDescription({
                        description: item.dataset.description,
                        request: container.dataset.request || '',
                        hours: item.dataset.hours,
                        lang
                    }),
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
            if (container.dataset.messageId && currentConversationId) {
                updateMessage(currentConversationId, container.dataset.messageId, { applied: true });
            }
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

/* `persist` stores the message in the chat history (the welcome line is not stored).
   `conversationId` targets the conversation a late reply belongs to: when the user has moved to
   another view meanwhile, the message is only saved, not drawn. */
export function appendMessage(role, text, isError = false, { persist = true, conversationId } = {}) {
            let messageId = '';
            if (persist) {
                const target = conversationId === undefined ? currentConversationId : conversationId;
                const saved = addMessage(target, { role, text, error: isError || undefined });
                messageId = saved.messageId;
                if (conversationId === undefined || conversationId === currentConversationId) {
                    currentConversationId = saved.conversationId;
                } else {
                    return;
                }
            }
            const row = document.createElement('div');
            row.className = `message-row ${role}`;
            row.dataset.messageId = messageId;
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
                translateBtn.innerHTML = pixelIcon('languages');
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
                btn.innerHTML = pixelIcon('languages');
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
                btn.innerHTML = pixelIcon('undo');
                btn.dataset.translated = '1';
            } catch (e) {
                showToast(lang === 'zh' ? '翻译失败' : 'Translation failed', 'error');
                btn.innerHTML = pixelIcon('languages');
            } finally {
                btn.disabled = false;
            }
        }

/* ---- Importing a file from the chat -------------------------------------------------------------
   The paperclip next to the message box takes a timetable (.ics), a Canvas / Coursera export (.json) or a
   document (PDF, Word, text). The file shows up as a message, the server works out what it contains (an
   AI reads documents), and a card lists what was found with checkboxes. Nothing is added to the calendar
   until "Import selected" is pressed. */

export function initChatAttach() {
            const button = document.getElementById('chatAttachBtn');
            const input = document.getElementById('chatFileInput');
            if (!button || !input) return;
            button.addEventListener('click', () => { if (requireUser()) input.click(); });
            input.addEventListener('change', async () => {
                const file = input.files[0];
                input.value = ''; // so choosing the same file again still fires 'change'
                if (file) await importFileFromChat(file);
            });
        }

function showTypingIndicator() {
            const container = document.getElementById('messages');
            const loading = document.createElement('div');
            loading.className = 'message ai';
            loading.id = 'ai-loading-placeholder';
            loading.innerHTML = `<div class="typing-loader"><span></span><span></span><span></span></div>`;
            container.appendChild(loading);
            container.scrollTop = container.scrollHeight;
            return () => loading.remove();
        }

async function importFileFromChat(file) {
            const dict = translations[localStorage.getItem('appLang') || 'zh'];
            appendMessage('user', dict.chatAttachedFile.replace('{name}', file.name));
            const conversationId = currentConversationId;
            const removeTyping = showTypingIndicator();
            try {
                const preview = await requestImportPreview(file);
                removeTyping();
                if (!(preview.items || []).length) {
                    appendMessage('ai', dict.chatImportNone, false, { conversationId });
                    return;
                }
                appendImportCard(preview, file.name);
            } catch (error) {
                removeTyping();
                appendMessage('ai', dict.chatImportFail + error.message, true, { conversationId });
            }
        }

function appendImportCard(preview, fileName) {
            const dict = translations[localStorage.getItem('appLang') || 'zh'];
            const conversationId = currentConversationId;
            const card = document.createElement('div');
            card.className = 'ai-planner-box import-card';

            const header = document.createElement('div');
            header.className = 'planner-header';
            header.textContent = dict.chatImportHeader.replace('{name}', fileName);
            const summary = document.createElement('div');
            summary.className = 'import-card-summary';
            summary.textContent = describeImportPreview(preview);
            const list = document.createElement('div');
            list.className = 'import-card-list';
            preview.items.forEach(item => list.appendChild(buildImportRow(item, preview)));
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'sync-btn';
            button.textContent = dict.chatImportConfirmBtn;

            const refreshButton = () => {
                const selected = list.querySelectorAll('.import-item-check:checked').length;
                button.disabled = selected === 0;
            };
            list.addEventListener('change', refreshButton);
            refreshButton();

            button.addEventListener('click', async () => {
                const itemIds = Array.from(list.querySelectorAll('.import-item-check:checked')).map(box => box.value);
                if (!itemIds.length) { showToast(dict.importNothingSelected, 'info'); return; }
                button.disabled = true;
                try {
                    const result = await confirmImportRequest(preview.importId, itemIds);
                    const { message, wrote } = importResultMessage(result);
                    showToast(message, wrote ? 'success' : 'info');
                    button.textContent = dict.chatImportDoneBtn;
                    list.querySelectorAll('input').forEach(box => { box.disabled = true; });
                    appendMessage('ai', message, false, { conversationId });
                    refreshUserScopedViews();
                } catch (error) {
                    button.disabled = false;
                    showToast(dict.importConfirmFail + error.message, 'error');
                }
            });

            card.append(header, summary, list, button);
            const container = document.getElementById('messages');
            container.appendChild(card);
            container.scrollTop = container.scrollHeight;
        }

/* ---- Chat history: a list of saved conversations, and the conversation itself ---- */

function setChatView(view) {
            const container = document.getElementById('chat-container');
            if (container) container.dataset.view = view;
        }

function formatChatTime(timestamp, lang) {
            const d = new Date(timestamp);
            const sameDay = d.toDateString() === new Date().toDateString();
            const pad = n => String(n).padStart(2, '0');
            const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
            return sameDay ? clock : `${d.getMonth() + 1}/${d.getDate()} ${clock}`;
        }

export function renderChatList() {
            const lang = localStorage.getItem('appLang') || 'zh';
            const dict = translations[lang];
            const listEl = document.getElementById('chatList');
            if (!listEl) return;
            listEl.innerHTML = '';

            const newBtn = document.createElement('button');
            newBtn.type = 'button';
            newBtn.className = 'chat-new-btn';
            newBtn.innerHTML = pixelIcon('plus') + `<span>${escapeHtml(dict.chatNew)}</span>`;
            newBtn.onclick = () => startNewChat();
            listEl.appendChild(newBtn);

            const conversations = loadConversations().sort((a, b) => b.updatedAt - a.updatedAt);
            if (!conversations.length) {
                const empty = document.createElement('p');
                empty.className = 'chat-list-empty';
                empty.textContent = dict.chatEmptyList;
                listEl.appendChild(empty);
                return;
            }

            conversations.forEach(conv => {
                const row = document.createElement('div');
                row.className = 'chat-list-row';

                const open = document.createElement('button');
                open.type = 'button';
                open.className = 'chat-list-item';
                const title = document.createElement('span');
                title.className = 'chat-list-title';
                title.textContent = conv.title || dict.chatUntitled;
                const meta = document.createElement('span');
                meta.className = 'chat-list-meta';
                meta.textContent = `${formatChatTime(conv.updatedAt, lang)} · ${dict.chatMessageCount.replace('{n}', conv.messages.length)}`;
                open.append(title, meta);
                open.onclick = () => openConversation(conv.id);

                const del = document.createElement('button');
                del.type = 'button';
                del.className = 'chat-list-delete';
                del.title = dict.chatDelete;
                del.setAttribute('aria-label', dict.chatDelete);
                del.innerHTML = pixelIcon('trash');
                del.onclick = () => {
                    if (!window.confirm(dict.chatDeleteConfirm)) return;
                    deleteConversation(conv.id);
                    if (conv.id === currentConversationId) currentConversationId = null;
                    renderChatList();
                };

                row.append(open, del);
                listEl.appendChild(row);
            });
        }

export function showChatList() {
            renderChatList();
            setChatView('list');
        }

export function startNewChat() {
            currentConversationId = null;
            document.getElementById('messages').innerHTML = '';
            const lang = localStorage.getItem('appLang') || 'zh';
            appendMessage('ai', translations[lang].aiWelcome, false, { persist: false });
            setChatView('chat');
            const input = document.getElementById('userInput');
            if (input) input.focus();
        }

export function openConversation(id) {
            const conversation = getConversation(id);
            if (!conversation) { showChatList(); return; }
            currentConversationId = id;
            document.getElementById('messages').innerHTML = '';
            conversation.messages.forEach(m => {
                if (m.role === 'plan') {
                    appendAiPlanner(m.plan, { request: m.request || '', persist: false, applied: !!m.applied, messageId: m.id });
                } else {
                    appendMessage(m.role, m.text, !!m.error, { persist: false });
                }
            });
            setChatView('chat');
            const input = document.getElementById('userInput');
            if (input) input.focus();
        }
