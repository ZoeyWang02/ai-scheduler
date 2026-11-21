import { API_BASE } from './config.js';
import { state } from './state.js';
import { translations } from './i18n.js';
import { escapeHtml, getUtcOffsetLabel, linkify, showToast } from './utils.js';
import { celebrateBuddyProgress, renderBuddyMoodBadge, renderBuddyStatus } from './buddy.js';
import { getActiveAnalysisPeriod, loadLifestyleAnalysis, taskDisplayText } from './analytics.js';
import { translateTasks } from './taskTranslate.js';
import { addAuthParams, getAuthToken, getUserId, requireUser } from './auth.js';
import { refreshUserScopedViews } from './app.js';
import { toggleTranslate, triggerAutoAiPlanner } from './chat.js';
import { extractDocumentText, fileExtension, isDocumentFile } from './docExtract.js';
import { chatComplete, describeAiError, hasOwnKey } from './llmClient.js';
import { spanText, timeLine } from './timeSpan.js';
import { splitDescription } from './descriptionParts.js';
import { askConfirm } from './confirmDialog.js';

import { pixelIcon } from './pixelIcons.js';
export function taskApiUrl(timezone) {
            const params = new URLSearchParams({ timezone });
            return `${API_BASE}/api/tasks?${addAuthParams(params).toString()}`;
        }

export function courseApiUrl(timezone) {
            const params = new URLSearchParams({ timezone });
            return getUserId() ? `${API_BASE}/api/courses?${addAuthParams(params).toString()}` : `${API_BASE}/api/courses?userId=-1&authToken=guest`;
        }

export async function loadTimezones(defaultTimezone) {
            try {
                const zones = Intl.supportedValuesOf('timeZone')
                    .filter(zone => zone.includes('/') && !zone.startsWith('Etc/') && !zone.startsWith('SystemV/'));

                const groups = {};
                zones.forEach(zone => {
                    const region = zone.split('/')[0];
                    if (!groups[region]) groups[region] = [];
                    groups[region].push(zone);
                });

                const select = document.getElementById('timezoneSelect');
                select.innerHTML = '';
                Object.keys(groups).sort().forEach(region => {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = region;
                    groups[region].sort().forEach(zone => {
                        const option = document.createElement('option');
                        option.value = zone;
                        option.innerText = `${zone.split('/').slice(1).join('/').replace(/_/g, ' ')} (${getUtcOffsetLabel(zone)})`;
                        optgroup.appendChild(option);
                    });
                    select.appendChild(optgroup);
                });

                const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
                select.value = zones.includes(defaultTimezone) ? defaultTimezone : fallback;
            } catch (e) {
                console.error("加载时区失败", e);
            }
        }

export function taskToCalendarEvent(task) {
            const lang = localStorage.getItem('appLang') || 'zh';
            const { title: transTitle, description: transDesc } = taskDisplayText(task, lang);

            let evColor = task.color || '#3b82f6';
            if ((task.title.includes('[AI]') || task.title.includes('[智能规划]')) && !task.color) evColor = '#8b5cf6';

            // An event has a real start and end. A task is a deadline: it gets no end, and the calendar
            // draws it as a short block (defaultTimedEventDuration) instead of pretending it lasts hours.
            const isEvent = !!(task.endDate && spanText(task.dueDate, task.endDate));
            let startIso = task.localDueDate;
            let endIso;
            try {
                if (task.localDueDate) {
                    let parsed = new Date(task.localDueDate.replace(' ', 'T'));
                    if (!isNaN(parsed.valueOf())) startIso = parsed.toISOString();
                }
                if (isEvent) {
                    const parsedEnd = new Date(task.endDate.replace(' ', 'T'));
                    if (!isNaN(parsedEnd.valueOf())) endIso = parsedEnd.toISOString();
                }
            } catch (e) { }

            return {
                id: task.id,
                title: transTitle,
                start: startIso,
                end: endIso,
                extendedProps: {
                    taskId: task.id,
                    description: transDesc,
                    color: task.color,
                    kind: isEvent ? 'event' : 'task',
                    // The times as the server wrote them (local, no zone), for the details box and the edit form.
                    localStart: task.dueDate,
                    localEnd: isEvent ? task.endDate : null
                },
                color: evColor,
                classNames: isEvent ? ['fc-kind-event'] : ['fc-kind-task'],
                editable: true,
                durationEditable: isEvent
            };
        }

export function courseToCalendarEvent(event) {
            let startIso = event.start;
            let endIso = event.end;
            try {
                if (event.start) {
                    let parsedStart = new Date(event.start.replace(' ', 'T'));
                    if (!isNaN(parsedStart.valueOf())) startIso = parsedStart.toISOString();
                }
                if (event.end) {
                    let parsedEnd = new Date(event.end.replace(' ', 'T'));
                    if (!isNaN(parsedEnd.valueOf())) endIso = parsedEnd.toISOString();
                }
            } catch (e) { console.warn('课程时间解析失败', e); }

            return {
                id: 'course-' + event.id,
                title: event.title,
                start: startIso,
                end: endIso,
                extendedProps: {
                    courseId: event.id, // 涓撻棬鐨勮绋?ID 鏍囪
                    description: event.location || '',
                    kind: 'course',
                    localStart: event.start,
                    localEnd: event.end
                },
                color: '#16b99a',
                editable: false
            };
        }

export function initCalendar(timezone) {
            const calendarEl = document.getElementById('calendar');
            state.calendar = new FullCalendar.Calendar(calendarEl, {
                initialView: 'dayGridMonth',
                // The zh-cn locale pack defaults to Monday-first; keep the existing Sunday-first grid.
                firstDay: 0,
                height: '100%',
                // A task is a deadline with no end; draw it as a short block. Events and classes carry their real end.
                defaultTimedEventDuration: '00:30',
                // Tasks and events can be dragged (and events stretched); each change is confirmed first.
                editable: true,
                allDaySlot: false,
                eventDrop: (info) => confirmAndSaveEventChange(info),
                eventResize: (info) => confirmAndSaveEventChange(info),
                headerToolbar: {
                    left: 'prev,next today',
                    center: 'title',
                    right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
                },
                eventSources: [
                    { url: taskApiUrl(timezone), eventDataTransform: taskToCalendarEvent },
                    { url: courseApiUrl(timezone), eventDataTransform: courseToCalendarEvent }
                ],
                // ... 淇濇寔 eventDidMount 鐨?tippy 鎻愮ず璇嶄笉鍙?...
                eventDidMount: function (info) {
                    const lang = localStorage.getItem('appLang') || 'zh';
                    const desc = info.event.extendedProps.description || translations[lang].noDetails;
                    const when = timeLine(info.event.extendedProps.localStart, info.event.extendedProps.localEnd, lang);
                    tippy(info.el, {
                        content: `<div style="font-family: Inter; padding: 4px;">
                                <strong style="font-size: 13px;">${escapeHtml(info.event.title)}</strong><br>
                                <div style="font-size:12px; margin-top: 2px;">${escapeHtml(when)}</div>
                                <div style="font-size:12px; margin-top: 4px; color:#94a3b8; max-height:60px; overflow:hidden; white-space: pre-line;">${linkify(desc)}</div>
                              </div>`,
                        allowHTML: true, interactive: true, theme: 'dark', appendTo: () => document.body, placement: 'top',
                    });
                },
                eventClick: function (info) {
                    const ext = info.event.extendedProps;
                    showModal(
                        info.event.title,
                        timeLine(ext.localStart, ext.localEnd, localStorage.getItem('appLang') || 'zh'),
                        info.event.extendedProps.description,
                        info.event.extendedProps.taskId,
                        // FullCalendar's EventApi has no `.color` getter — the
                        // `color` shorthand from taskToCalendarEvent is stored
                        // as backgroundColor, so reading `.color` here would
                        // always be undefined and the picker would fall back
                        // to the default blue on every reopen.
                        info.event.backgroundColor,
                        info.event.extendedProps.courseId,
                        ext.localStart,
                        ext.localEnd
                    );
                }
            });
            state.calendar.render();
            setTimeout(() => { state.calendar.updateSize(); }, 100);
        }

/** `date` is the finished time line (see timeLine in timeSpan.js); `rawDate` / `rawEnd` are the local start and end the edit form opens with. */
/** A Date as the local wall-clock text the API uses ("YYYY-MM-DDTHH:MM:SS"). The calendar shows tasks at the
 *  wall-clock time the server gave, so its dates read back the same way. */
export function localWallClock(date) {
            const p = (n) => String(n).padStart(2, '0');
            return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:00`;
        }

/** After a task or event is dragged or resized: ask, then save the new time; "No" puts it back. */
export async function confirmAndSaveEventChange(info) {
            const lang = localStorage.getItem('appLang') || 'zh';
            const dict = translations[lang];
            const ext = info.event.extendedProps;
            const existing = (state.lastLoadedTasks || []).find(t => Number(t.id) === Number(ext.taskId));
            if (!ext.taskId || !existing || !info.event.start) { info.revert(); return; }

            const start = localWallClock(info.event.start);
            const end = ext.kind === 'event' && info.event.end ? localWallClock(info.event.end) : null;
            const confirmed = await askConfirm({
                title: info.event.title,
                detail: timeLine(start, end, lang),
                question: dict.confirmDragEdit,
                yes: dict.confirmYes,
                no: dict.confirmNo
            });
            if (!confirmed) { info.revert(); return; }

            const currentTz = document.getElementById('timezoneSelect').value;
            try {
                // Title and description are sent as they are, so the saved translations stay.
                const res = await fetch(`${API_BASE}/api/tasks/${existing.id}?authToken=${encodeURIComponent(getAuthToken())}&timezone=${encodeURIComponent(currentTz)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: existing.title, description: existing.description, dueDate: start, endDate: end })
                });
                if (!res.ok) throw new Error(String(res.status));
                state.calendar.refetchEvents();
                loadTasks(currentTz);
                loadLifestyleAnalysis(getActiveAnalysisPeriod(), currentTz, true);
                showToast(dict.taskSavedToast, 'success');
            } catch (e) {
                info.revert();
                showToast(dict.alertSaveFailed, 'error');
            }
        }

export function showModal(title, date, desc, taskId, color, courseId = null, rawDate = null, rawEnd = null) {
            const lang = localStorage.getItem('appLang') || 'zh';
            state.currentOpenedTaskId = taskId;

            document.getElementById('modalTitle').innerText = title;
            document.getElementById('modalDate').innerText = date;
            const { main, notes } = splitDescription(desc);
            document.getElementById('modalDescription').innerHTML = (main ? `<div>${linkify(main)}</div>` : '')
                + (notes ? `<div class="modal-desc-notes">${linkify(notes)}</div>` : '')
                || (lang === 'zh' ? "暂无详细描述。" : "No description.");
            document.getElementById('taskColorPicker').value = color || '#3b82f6';

            const deleteBtn = document.getElementById('deleteTaskBtn');
            const editBtn = document.getElementById('editTaskBtn');

            if (taskId) {
                deleteBtn.style.display = 'inline-block';
                editBtn.style.display = 'inline-block';
                deleteBtn.onclick = function () { deleteTask(taskId); };
                editBtn.onclick = function () { closeModal(); openEditModal(taskId, title, desc, rawDate, rawEnd); };
            } else if (courseId) {
                deleteBtn.style.display = 'inline-block';
                editBtn.style.display = 'none'; // 课程暂不支持前端修改
                deleteBtn.onclick = function () { deleteCourse(courseId); };
            } else {
                deleteBtn.style.display = 'none';
                editBtn.style.display = 'none';
            }
            document.getElementById('taskModal').style.display = 'block';
        }

/** The title as the edit box shows it: without the planner's "[AI] " tag. */
const editBoxTitle = (title) => title.replace('[AI] ', '').replace('[智能] ', '');

export function openEditModal(taskId = null, title = '', desc = '', rawDate = '', endDate = '') {
            if (!requireUser()) return;
            document.getElementById('editTaskId').value = taskId || '';
            document.getElementById('editTaskName').value = editBoxTitle(title);
            document.getElementById('editTaskDesc').value = desc;
            
            // 鍥炴樉鏃讹紝涓㈠純甯︽椂鍖虹殑 'Z'锛屼繚鐣欑函鍑€鐨?'YYYY-MM-DDTHH:mm' 鏍煎紡璧嬪€肩粰 input
            document.getElementById('editTaskDate').value = rawDate ? rawDate.substring(0, 16) : '';
            // 濡傛灉鍚庣鏈夌粨鏉熸椂闂村垯鏄剧ず锛屾病鏈夌殑璇濋粯璁ゅ～璧峰鏃堕棿
            document.getElementById('editTaskEndDate').value = endDate ? endDate.substring(0, 16) : '';
            // An existing event opens as an event; a task (and a new item) opens as a task.
            document.getElementById('editTaskKind').value = endDate ? 'event' : 'task';
            onEditKindChange();
            
            document.getElementById('editTaskModal').style.display = 'block';
        }

/** The type picker: a task has one time (its deadline), an event has a start and an end. */
export function onEditKindChange() {
            const lang = localStorage.getItem('appLang') || 'zh';
            const isEvent = document.getElementById('editTaskKind').value === 'event';
            const endInput = document.getElementById('editTaskEndDate');
            endInput.style.display = isEvent ? '' : 'none';
            document.getElementById('editTimeLabel').innerText = translations[lang][isEvent ? 'editTimeLabel' : 'editDueLabel'];
            const startInput = document.getElementById('editTaskDate');
            // Switching to an event with a start but no end: suggest one hour, which the person can change.
            if (isEvent && startInput.value && !endInput.value) {
                const start = new Date(startInput.value);
                if (!isNaN(start.valueOf())) {
                    const end = new Date(start.getTime() + 60 * 60 * 1000);
                    const pad = (n) => String(n).padStart(2, '0');
                    endInput.value = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`;
                }
            }
        }

export async function saveManualTask() {
            const taskId = document.getElementById('editTaskId').value;
            const title = document.getElementById('editTaskName').value.trim();
            const startStr = document.getElementById('editTaskDate').value;
            const endStr = document.getElementById('editTaskEndDate').value;
            const desc = document.getElementById('editTaskDesc').value.trim();

            const lang = localStorage.getItem('appLang') || 'zh';
            if (!title || !startStr) return alert(translations[lang].alertEnterTaskInfo);
            const isEvent = document.getElementById('editTaskKind').value === 'event';
            if (isEvent && !(endStr && endStr > startStr)) return alert(translations[lang].alertEndAfterStart);
            if (taskId && !confirm(translations[lang].confirmEditTask)) return;
            
            // 缁勮绾噣鏃堕棿瀛楃涓诧紝涓嶈鍦ㄨ繖閲屽仛 new Date()
            const taskData = { 
                title: title, 
                description: desc, 
                dueDate: startStr + ":00", // 琛ラ綈绉掓暟锛岀鍚?LocalDateTime 鏍煎紡
                // 鏆傛椂鍒╃敤 description 鐨勬墿灞曟€у瓨涓€涓嬬粨鏉熸椂闂达紙绋嶅悗鍘诲悗绔敼琛ㄧ粨鏋勬渶褰诲簳锛岃繖閲屾殏鏃跺厛瀛樿捣濮嬶級
            };
            
            // An event sends its end; a task sends null, which also turns an event that is edited into a task back into one.
            taskData.endDate = isEvent ? endStr + ":00" : null;

            const currentTz = document.getElementById('timezoneSelect').value;

            let url = `${API_BASE}/api/tasks?userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}&timezone=${encodeURIComponent(currentTz)}`;
            let method = 'POST';
            if (taskId) {
                url = `${API_BASE}/api/tasks/${taskId}?authToken=${encodeURIComponent(getAuthToken())}&timezone=${encodeURIComponent(currentTz)}`;
                method = 'PUT';
            }

            const saveButton = document.querySelector('#editTaskModal [data-click="saveManualTask"]');
            if (saveButton) saveButton.disabled = true; // the translation below takes a moment; do not save twice
            try {
                // An edit that leaves the text as it was shown keeps the task's original text and translations.
                // Anything else is new text, so the AI writes its other-language version now.
                const existing = taskId ? (state.lastLoadedTasks || []).find(t => String(t.id) === String(taskId)) : null;
                const shown = existing ? taskDisplayText(existing, lang) : null;
                if (shown && title === editBoxTitle(shown.title) && desc === (shown.description || '').trim()) {
                    taskData.title = existing.title;
                    taskData.description = existing.description;
                } else {
                    taskData.i18n = (await translateTasks([{ title, description: desc }]))[0];
                }

                const res = await fetch(url, {
                    method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(taskData)
                });
                if (res.ok) {
                    document.getElementById('editTaskModal').style.display = 'none';
                    state.calendar.refetchEvents();
                    loadTasks(currentTz);
                    loadLifestyleAnalysis(getActiveAnalysisPeriod(), currentTz, true);
                    showToast(translations[lang].taskSavedToast, 'success');
                } else showToast(translations[lang].alertSaveFailed, 'error');
            } catch (e) { showToast(translations[lang].alertNetworkError, 'error'); }
            finally { if (saveButton) saveButton.disabled = false; }
        }

export async function deleteCourse(courseId) {
            const lang = localStorage.getItem('appLang') || 'zh';
            if (!confirm(translations[lang].confirmDeleteCourse)) return;

            try {
                const response = await fetch(`${API_BASE}/api/courses/${courseId}?authToken=${encodeURIComponent(getAuthToken())}`, { method: 'DELETE' });
                if (response.ok) {
                    closeModal();
                    state.calendar.refetchEvents();
                } else {
                    alert(translations[lang].alertDeleteFail);
                }
            } catch (e) {
                console.error("删除课程出错", e);
            }
        }

export async function updateTaskColor() {
            if (!state.currentOpenedTaskId) return;
            const newColor = document.getElementById('taskColorPicker').value;
            const lang = localStorage.getItem('appLang') || 'zh';

            try {
                await fetch(`${API_BASE}/api/tasks/${state.currentOpenedTaskId}/color?authToken=${encodeURIComponent(getAuthToken())}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ color: newColor })
                });

                const currentTz = document.getElementById('timezoneSelect').value;
                state.calendar.refetchEvents();
                loadTasks(currentTz);
                closeModal();
                showToast(translations[lang].colorSavedToast, 'success');
            } catch (e) {
                showToast(translations[lang].alertColorFail, 'error');
            }
        }

export async function deleteTask(taskId) {
            const lang = localStorage.getItem('appLang') || 'zh';
            if (!confirm(translations[lang].confirmDeleteTask)) return;

            try {
                const response = await fetch(`${API_BASE}/api/tasks/${taskId}?authToken=${encodeURIComponent(getAuthToken())}`, { method: 'DELETE' });
                if (response.ok) {
                    closeModal();
                    state.calendar.refetchEvents();
                    const currentTz = document.getElementById('timezoneSelect').value;
                    loadTasks(currentTz);
                    loadLifestyleAnalysis(getActiveAnalysisPeriod(), currentTz);
                } else {
                    alert(translations[lang].alertDeleteFail);
                }
            } catch (e) {
                console.error("鍒犻櫎鍑洪敊", e);
            }
        }

export function closeModal() {
            document.getElementById('taskModal').style.display = 'none';
        }

export async function onTimezoneChange() {
            const selectedTz = document.getElementById('timezoneSelect').value;
            refreshUserScopedViews();
            loadTasks(selectedTz);
            loadLifestyleAnalysis(getActiveAnalysisPeriod(), selectedTz);

            const lang = localStorage.getItem('appLang') || 'zh';
            if (getUserId()) {
                try {
                    const response = await fetch(`${API_BASE}/api/auth/timezone?userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ timezone: selectedTz })
                    });
                    if (!response.ok) {
                        console.error('Timezone sync failed', response.status, await response.text());
                        showToast(lang === 'zh' ? '时区已应用，但同步到账号失败' : 'Timezone applied, but syncing to your account failed', 'error');
                        return;
                    }
                    state.currentUser.timezone = selectedTz;
                    localStorage.setItem('nexusUser', JSON.stringify(state.currentUser));
                    showToast(lang === 'zh' ? '时区已同步到账号' : 'Timezone synced to your account', 'success');
                } catch (e) {
                    console.error('Failed to sync timezone to server', e);
                    showToast(lang === 'zh' ? '时区已应用，但同步到账号失败' : 'Timezone applied, but syncing to your account failed', 'error');
                }
            } else {
                showToast(lang === 'zh' ? '时区已应用到本机（登录后可跨设备同步）' : 'Timezone applied locally (sign in to sync across devices)', 'info');
            }
        }

export async function toggleTaskComplete(taskId, completed, itemEl) {
            itemEl.classList.toggle('completed', completed);
            try {
                const response = await fetch(`${API_BASE}/api/tasks/${taskId}/complete?authToken=${encodeURIComponent(getAuthToken())}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ completed })
                });
                if (!response.ok) return;
                const result = await response.json();
                if (result.buddyState) {
                    state.lastBuddyState = result.buddyState;
                    renderBuddyStatus();
                    renderBuddyMoodBadge();
                    celebrateBuddyProgress(result.buddyState);
                }
                // Keep the cached task in sync so the Today band (and any other
                // view reading state.lastLoadedTasks) reflects the new completed
                // state without a full reload, then let them re-render.
                const cached = (state.lastLoadedTasks || []).find(t => String(t.id) === String(taskId));
                if (cached) cached.completed = completed;
                document.dispatchEvent(new Event('nexus:today-refresh'));
            } catch (e) {
                console.error('Failed to update task completion', e);
            }
        }

/** The details-box line for a task from the task list: "Due: ..." for a task, "Time: start-end (length)" for an event. */
export function taskTimeLine(t, lang) {
            if (!t.dueDate) return `${lang === 'zh' ? '截止: ' : 'Due: '}${t.localDueDate}`;
            return timeLine(t.dueDate, t.endDate, lang);
        }

/** The shorter line under a task's name in the list: just the span for an event. */
export function taskRowTime(t, lang) {
            return (t.endDate && spanText(t.dueDate, t.endDate)) || taskTimeLine(t, lang);
        }

export async function loadTasks(timezone) {
            const taskListEl = document.getElementById('taskList');
            const lang = localStorage.getItem('appLang') || 'zh';
            try {
                const response = await fetch(taskApiUrl(timezone));
                const tasks = await response.json();
                state.lastLoadedTasks = tasks;
                document.dispatchEvent(new Event('nexus:today-refresh'));

                if (!tasks.length) {
                    taskListEl.innerHTML = `<div class="empty-state-box"><div class="empty-state-icon">${pixelIcon('sprout', { size: 48 })}</div><div style="font-size: 13px; font-weight: 500;">${escapeHtml(translations[lang].noTasks)}</div></div>`;
                    return;
                }

                taskListEl.innerHTML = '';
                tasks.forEach(t => {
                    const { title: transTitle, description: transDesc } = taskDisplayText(t, lang);
                    const item = document.createElement('div');
                    item.className = 'task-item' + (t.completed ? ' completed' : '');
                    item.addEventListener('click', () => showModal(transTitle, taskTimeLine(t, lang), transDesc, t.id, t.color || '', null, t.dueDate || t.localDueDate, t.endDate));

                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.className = 'task-complete-checkbox';
                    checkbox.checked = !!t.completed;
                    checkbox.onclick = (e) => e.stopPropagation();
                    checkbox.onchange = () => toggleTaskComplete(t.id, checkbox.checked, item);

                    const body = document.createElement('div');
                    body.className = 'task-item-body';
                    const titleEl = document.createElement('strong');
                    titleEl.innerText = transTitle;
                    const dateEl = document.createElement('div');
                    dateEl.className = 'date';
                    dateEl.innerText = taskRowTime(t, lang);
                    body.appendChild(titleEl);
                    body.appendChild(dateEl);

                    const translateBtn = document.createElement('button');
                    translateBtn.type = 'button';
                    translateBtn.className = 'translate-btn';
                    translateBtn.title = translations[lang].translateTooltip;
                    translateBtn.innerHTML = pixelIcon('languages');
                    translateBtn.onclick = (e) => {
                        e.stopPropagation();
                        toggleTranslate(translateBtn, titleEl, transTitle, 'plain');
                    };

                    item.appendChild(checkbox);
                    item.appendChild(body);
                    item.appendChild(translateBtn);
                    taskListEl.appendChild(item);
                });
            } catch (e) { console.error("Failed to load task list", e); }
        }

export function openImportModal() {
            if (!requireUser()) return;
            state.currentImportPreview = null;
            document.getElementById('importSummary').innerText = '';
            document.getElementById('importPreviewList').innerHTML = '';
            document.getElementById('importTools').style.display = 'none';
            document.getElementById('importSelectedCount').textContent = '';
            document.getElementById('confirmImportBtn').style.display = 'none';
            document.getElementById('confirmImportBtn').disabled = false;
            document.getElementById('importModal').style.display = 'block';
        }

export function closeImportModal() {
            document.getElementById('importModal').style.display = 'none';
        }

// Why a document could not be read, in the UI language.
function documentErrorMessage(error, dict) {
            const known = { tooLarge: dict.importDocTooLarge, unsupported: dict.importDocUnsupported, empty: dict.importDocEmpty };
            return known[error && error.code] || dict.importDocUnreadable;
        }

/* Asks the server what a file would import, without importing anything. Used by the Import dialog and by
   the attach button in the chat. .ics / .json files are uploaded as they are; PDF, Word and text documents
   are read in the browser and only their text is sent, for the AI to pick the tasks and sessions out of.
   Resolves to the preview; rejects with an Error whose message can be shown to the user. */
export async function requestImportPreview(file) {
            const dict = translations[localStorage.getItem('appLang') || 'zh'];
            const timezone = document.getElementById('timezoneSelect').value;
            const query = `userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}&timezone=${encodeURIComponent(timezone)}`;
            // Anything that is neither a document nor a calendar / JSON export: say so here, in plain words.
            if (!isDocumentFile(file) && !['ics', 'json'].includes(fileExtension(file.name))) {
                throw new Error(dict.importDocUnsupported);
            }
            let response;
            if (isDocumentFile(file)) {
                let text;
                try {
                    text = await extractDocumentText(file);
                } catch (error) {
                    throw new Error(documentErrorMessage(error, dict));
                }
                if (hasOwnKey()) return previewDocumentWithOwnKey(file.name, text, query, dict);
                response = await fetch(`${API_BASE}/api/import/preview-text?${query}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fileName: file.name, text })
                });
            } else {
                const formData = new FormData();
                formData.append('file', file);
                response = await fetch(`${API_BASE}/api/import/preview?${query}`, { method: 'POST', body: formData });
            }
            return previewResult(response, dict);
        }

// The preview the server sent, or an Error with a message for the user.
async function previewResult(response, dict) {
            const result = await response.json().catch(() => ({}));
            if (response.ok) return result;
            if (result.code === 'ai_quota') throw new Error(describeAiError({ status: 429 }, dict, { dailyLimit: state.aiDailyLimit }));
            throw new Error(result.message || dict.checkInput);
        }

/* The same document import with the user's own API key: the server prepares the prompt, this browser sends it to the
   provider itself, and the server turns the answer into the preview. The key never leaves the browser. */
async function previewDocumentWithOwnKey(fileName, text, query, dict) {
            const post = (path, body) => fetch(`${API_BASE}/api/import/${path}?${query}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const promptResponse = await post('document-prompt', { fileName, text });
            const prompt = await promptResponse.json().catch(() => ({}));
            if (!promptResponse.ok) throw new Error(prompt.message || dict.checkInput);
            let reply;
            try {
                reply = await chatComplete(prompt.messages, { temperature: 0.1 });
            } catch (error) {
                throw new Error(describeAiError(error, dict, { dailyLimit: state.aiDailyLimit }));
            }
            return previewResult(await post('preview-reply', { fileName, reply, truncated: prompt.truncated === true }), dict);
        }

export async function previewUnifiedImport() {
            if (!requireUser()) return;
            const lang = localStorage.getItem('appLang') || 'zh';
            const fileInput = document.getElementById('unifiedImportFile');
            const file = fileInput.files[0];
            if (!file) {
                alert(translations[lang].alertSelectFile);
                return;
            }
            const summaryEl = document.getElementById('importSummary');
            summaryEl.innerText = isDocumentFile(file) ? translations[lang].importReadingDocument : translations[lang].syncing;

            try {
                const result = await requestImportPreview(file);
                state.currentImportPreview = result;
                renderImportPreview(result);
            } catch (error) {
                state.currentImportPreview = null;
                document.getElementById('confirmImportBtn').style.display = 'none';
                document.getElementById('importTools').style.display = 'none';
                summaryEl.innerText = '';
                alert(translations[lang].importPreviewFail + error.message);
            }
        }

function fillTemplate(template, values) {
            return Object.keys(values).reduce((out, key) => out.split(`{${key}}`).join(values[key]), template);
        }

// The API sends import times as UTC without an offset; show them in the user's
// selected timezone (what the rest of the app shows), not as raw UTC.
function formatImportTime(iso, timezone, lang, timeOnly = false) {
            if (!iso) return '';
            const date = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : iso + 'Z');
            if (isNaN(date.valueOf())) return iso;
            const options = timeOnly
                ? { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }
                : { timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
            try {
                return date.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', options);
            } catch (e) {
                return iso;
            }
        }

/* "Found 3 tasks and 2 class sessions. 1 already imported ... (unchecked by default)" plus the AI warning. */
export function describeImportPreview(preview) {
            const lang = localStorage.getItem('appLang') || 'zh';
            const dict = translations[lang];
            const items = preview.items || [];
            const pastCount = items.filter(item => item.past).length;
            const existingCount = items.filter(item => item.status === 'duplicate').length;
            let line = fillTemplate(dict.importSummaryFound, {
                tasks: items.filter(item => item.kind !== 'course').length,
                courses: items.filter(item => item.kind === 'course').length
            });
            const unchecked = [];
            if (pastCount) unchecked.push(fillTemplate(dict.importPastCount, { n: pastCount }));
            if (existingCount) unchecked.push(fillTemplate(dict.importExistingCount, { n: existingCount }));
            if (unchecked.length) line += ' ' + unchecked.join(lang === 'zh' ? '、' : ', ') + dict.importUncheckedSuffix;
            if (preview.aiFallbackUsed) line += ' ' + dict.importAiWarn;
            return line;
        }

/* One selectable row of an import preview (a checkbox, status badges, title, when, and notes). Shared by the
   Import dialog and the preview card in the chat. */
export function buildImportRow(item, preview) {
            const lang = localStorage.getItem('appLang') || 'zh';
            const dict = translations[lang];
            const timezone = document.getElementById('timezoneSelect').value;
            const badge = (kind, text) => `<span class="import-badge import-badge-${kind}">${escapeHtml(text)}</span>`;

            // Pre-select only what is worth importing: new/changed items that
            // are still ahead of us. A semester export otherwise drops dozens of
            // already-past deadlines into the app as "overdue".
            const suggested = !item.past && item.status !== 'duplicate';
            const row = document.createElement('label');
            row.className = 'import-preview-item' + (item.past ? ' is-past' : '') + (item.status === 'duplicate' ? ' is-duplicate' : '');
            row.dataset.suggested = suggested ? '1' : '0';

            const badges = [];
            if (item.status === 'update') badges.push(badge('update', dict.importBadgeUpdate));
            else if (item.status === 'duplicate') badges.push(badge('exists', dict.importBadgeExists));
            else badges.push(badge('new', dict.importBadgeNew));
            if (item.past) badges.push(badge('past', dict.importBadgePast));

            let when;
            if (item.kind === 'course') {
                when = `${formatImportTime(item.start, timezone, lang)} – ${formatImportTime(item.end, timezone, lang, true)}`;
            } else if (item.dueDate && item.end) {
                when = `${formatImportTime(item.dueDate, timezone, lang)} – ${formatImportTime(item.end, timezone, lang, true)}`;
            } else if (item.dueDate) {
                when = `${dict.importDueLabel} ${formatImportTime(item.dueDate, timezone, lang)}`;
            } else {
                when = dict.importNoDeadline;
            }
            const kindLabel = item.kind === 'course' ? dict.importKindCourse : item.end ? dict.importKindEvent : dict.importKindTask;
            const confidence = preview.aiFallbackUsed
                ? ` · ${dict.importConfidence} ${Math.round((item.confidence || 0) * 100)}%` : '';
            const metaLines = [`${kindLabel} · ${item.source || ''}${confidence}`, when];
            if (item.status === 'update' && item.existingDueDate) {
                metaLines.push(fillTemplate(dict.importUpdateDue, {
                    from: formatImportTime(item.existingDueDate, timezone, lang),
                    to: formatImportTime(item.dueDate, timezone, lang)
                }));
            }
            // Parser notes are developer-facing; only the AI-cleanup ones ("review
            // before confirming") are worth showing to the user.
            if (preview.aiFallbackUsed && item.notes) metaLines.push(item.notes);

            row.innerHTML = `
                <input type="checkbox" class="import-item-check" value="${escapeHtml(item.id)}" ${suggested ? 'checked' : ''}>
                <div>
                    <div class="import-preview-head">${badges.join('')}<span class="import-preview-title">${escapeHtml(item.title || 'Untitled')}</span></div>
                    <div class="import-preview-meta">${metaLines.map(escapeHtml).join('<br>')}</div>
                </div>`;
            return row;
        }

export function renderImportPreview(preview) {
            const lang = localStorage.getItem('appLang') || 'zh';
            const dict = translations[lang];
            const list = document.getElementById('importPreviewList');
            const summary = document.getElementById('importSummary');
            const tools = document.getElementById('importTools');
            list.innerHTML = '';
            const items = preview.items || [];
            if (!items.length) {
                summary.innerText = '';
                tools.style.display = 'none';
                list.innerHTML = `<div class="empty-state-box"><div class="empty-state-icon">${pixelIcon('mailbox', { size: 48 })}</div><div>${escapeHtml(dict.importNoItems)}</div></div>`;
                document.getElementById('confirmImportBtn').style.display = 'none';
                return;
            }

            summary.innerText = describeImportPreview(preview);
            items.forEach(item => list.appendChild(buildImportRow(item, preview)));
            list.onchange = updateImportSelectionCount;
            tools.style.display = 'flex';
            document.getElementById('confirmImportBtn').style.display = 'block';
            updateImportSelectionCount();
        }

export function updateImportSelectionCount() {
            const lang = localStorage.getItem('appLang') || 'zh';
            const boxes = Array.from(document.querySelectorAll('#importPreviewList .import-item-check'));
            const selected = boxes.filter(box => box.checked).length;
            document.getElementById('importSelectedCount').textContent =
                fillTemplate(translations[lang].importSelectedCount, { n: selected, total: boxes.length });
            document.getElementById('confirmImportBtn').disabled = selected === 0;
        }

export function setImportSelection(mode) {
            document.querySelectorAll('#importPreviewList .import-preview-item').forEach(row => {
                row.querySelector('.import-item-check').checked =
                    mode === 'all' ? true : mode === 'none' ? false : row.dataset.suggested === '1';
            });
            updateImportSelectionCount();
        }

/* Writes the chosen items of a preview. Resolves to the server's counts; rejects with a displayable Error. */
export async function confirmImportRequest(importId, itemIds) {
            const dict = translations[localStorage.getItem('appLang') || 'zh'];
            const response = await fetch(`${API_BASE}/api/import/confirm?userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ importId, itemIds })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.message || dict.checkInput);
            return result;
        }

/* Report what was actually written: items that already existed are skipped, so "N selected" and
   "N imported" are different numbers. `wrote` is how many things changed. */
export function importResultMessage(result) {
            const dict = translations[localStorage.getItem('appLang') || 'zh'];
            let message = fillTemplate(dict.importDoneDetail, {
                created: result.tasksCreated || 0,
                updated: result.tasksUpdated || 0,
                courses: result.coursesCreated || 0
            });
            if (result.duplicates) message += fillTemplate(dict.importDoneDup, { n: result.duplicates });
            return { message, wrote: (result.tasksCreated || 0) + (result.tasksUpdated || 0) + (result.coursesCreated || 0) };
        }

export async function confirmUnifiedImport() {
            if (!requireUser() || !state.currentImportPreview) return;
            const lang = localStorage.getItem('appLang') || 'zh';
            const dict = translations[lang];
            const itemIds = Array.from(document.querySelectorAll('.import-item-check:checked')).map(input => input.value);
            if (!itemIds.length) {
                showToast(dict.importNothingSelected, 'info');
                return;
            }
            try {
                const result = await confirmImportRequest(state.currentImportPreview.importId, itemIds);
                const { message, wrote } = importResultMessage(result);
                showToast(message, wrote ? 'success' : 'info');
                closeImportModal();
                refreshUserScopedViews();
            } catch (error) {
                alert(dict.importConfirmFail + error.message);
            }
        }

export async function uploadFile(type) {
            if (!requireUser()) return;
            const fileInput = document.getElementById(type + 'File');
            const file = fileInput.files[0];
            const lang = localStorage.getItem('appLang') || 'zh';
            if (!file) { alert(translations[lang].alertSelectFile); return; }

            const formData = new FormData();
            formData.append("file", file);

            const btn = event.target;
            const originalText = btn.innerText;
            btn.innerText = translations[lang].syncing;
            btn.disabled = true;

            try {
                const response = await fetch(`${API_BASE}/api/tasks/upload/${type}?userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}`, { method: 'POST', body: formData });
                const result = await response.text();

                if (response.ok) {
                    const currentTz = document.getElementById('timezoneSelect').value;
                    state.calendar.refetchEvents();
                    loadTasks(currentTz);
                    loadLifestyleAnalysis(getActiveAnalysisPeriod());
                    triggerAutoAiPlanner(type);
                } else {
                    alert(translations[lang].syncFail + result);
                }
            } catch (e) {
                alert(translations[lang].uploadFail);
            } finally {
                btn.innerText = originalText;
                btn.disabled = false;
                fileInput.value = '';
            }
        }

export async function uploadIcsFile() {
            if (!requireUser()) return;
            const fileInput = document.getElementById('icsFile');
            const file = fileInput.files[0];
            const lang = localStorage.getItem('appLang') || 'zh';
            if (!file) { alert(translations[lang].alertSelectIcs); return; }
            const timezone = document.getElementById('timezoneSelect').value;
            const formData = new FormData();
            formData.append("file", file);
            try {
                const response = await fetch(`${API_BASE}/api/courses/upload/ics?userId=${getUserId()}&authToken=${encodeURIComponent(getAuthToken())}&timezone=${encodeURIComponent(timezone)}`, {
                    method: 'POST',
                    body: formData
                });
                const result = await response.text();
                if (!response.ok) {
                    alert(result);
                    return;
                }
                alert(result);
                state.calendar.refetchEvents();
            } catch (e) {
                alert(translations[lang].icsUploadFail);
            } finally {
                fileInput.value = '';
            }
        }
