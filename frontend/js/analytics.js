import { API_BASE } from './config.js';
import { state } from './state.js';
import { translations } from './i18n.js';
import { addAuthParams } from './auth.js';
import { escapeHtml } from './utils.js';

export function openLifePanelModal() {
            document.getElementById('lifePanelModal').style.display = 'block';
        }

export function closeLifePanelModal() {
            document.getElementById('lifePanelModal').style.display = 'none';
        }

export function analyticsApiUrl(period) {
            const userTz = (state.currentUser && state.currentUser.timezone) ? state.currentUser.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone;
            const currentLang = localStorage.getItem('appLang') || 'zh';
            // 馃専 鏍稿績淇锛氬悜鍚庣鍚屾閫忎紶褰撳墠璇█鍙傛暟 lang
            const params = new URLSearchParams({ period, timezone: userTz, lang: currentLang });
            return `${API_BASE}/api/analytics/lifestyle?${addAuthParams(params).toString()}`;
        }

export function getActiveAnalysisPeriod() {
            const activeTab = document.querySelector('.analysis-tabs button.active');
            return activeTab ? activeTab.dataset.period : 'day';
        }

export function switchAnalysisPeriod(period, button) {
            document.querySelectorAll('.analysis-tabs button').forEach(tab => tab.classList.remove('active'));
            button.classList.add('active');
            loadLifestyleAnalysis(period);
        }

export function translateDynamicText(text, type, lang) {
            if (!text) return text;
            if (type === 'title') {
                if (lang === 'en' && text.startsWith('[智能规划]')) return text.replace('[智能规划]', '[AI]');
                if (lang === 'zh' && text.startsWith('[AI]')) return text.replace('[AI]', '[智能规划]');
            } else if (type === 'desc') {
                if (lang === 'en') return text.replace(/Nexus 生成子任务，预计耗时 ([\d.]+) 小时/, 'Nexus subtask, estimated: $1 hrs');
                if (lang === 'zh') return text.replace(/Nexus subtask, estimated: ([\d.]+) hrs/, 'Nexus 生成子任务，预计耗时 $1 小时');
            }
            return text;
        }

export async function loadLifestyleAnalysis(period, timezone, isSilent = false) {
            const barsEl = document.getElementById('rhythmBars');
            const lang = localStorage.getItem('appLang') || 'zh';
            const dict = translations[lang];

            if (!isSilent) {
                document.getElementById('rhythmLabel').innerText = dict.analyzing;
                document.getElementById('focusStyle').innerText = dict.analyzing;
                document.getElementById('lifeRecommendation').innerText = dict.loadingRhythm || 'Loading...';
                barsEl.innerHTML = '';
            }
            try {
                const response = await fetch(analyticsApiUrl(period, timezone));
                const data = await response.json();

                document.getElementById('rhythmLabel').innerText = data.rhythmLabel || dict.analyzing;
                document.getElementById('focusStyle').innerText = data.focusStyle || dict.analyzing;
                document.getElementById('peakWindow').innerText = data.peakWindow || dict.analyzing;
                document.getElementById('taskCompletion').innerText = `${data.completedTasks ?? 0}/${data.totalTasks ?? 0}`;
                document.getElementById('lifeRecommendation').innerText = data.recommendation || dict.defaultReco;

                const bucketsEl = document.getElementById('timeBuckets');
                const buckets = data.timeBuckets || [];
                if (!buckets.length) {
                    bucketsEl.innerHTML = '';
                } else {
                    const bucketColors = ['var(--color-primary)', 'var(--color-highlight)', 'var(--color-positive-soft)', 'var(--text-muted)'];
                    bucketsEl.innerHTML = `
                        <div class="time-buckets-bar">
                            ${buckets.map((b, i) => `<span style="width:${b.percentage}%;background:${bucketColors[i % bucketColors.length]};"></span>`).join('')}
                        </div>
                        <div class="time-buckets-legend">
                            ${buckets.map((b, i) => `
                                <span class="time-buckets-legend-item">
                                    <span class="time-buckets-legend-dot" style="background:${bucketColors[i % bucketColors.length]};"></span>
                                    ${escapeHtml(b.label)} ${b.percentage}%
                                </span>
                            `).join('')}
                        </div>`;
                }

                const hourly = data.hourlyStudy || [];

                if (!hourly.length || Math.max(...hourly.map(item => item.hours || 0)) === 0) {
                    barsEl.innerHTML = `
                        <div class="empty-state-box" style="width: 100%; grid-column: span 24;">
                            <div class="empty-state-icon" style="font-size:24px;">📊</div>
                            <div style="font-size: 11px;">${lang === 'zh' ? '暂无统计数据。' : 'No data tracked yet.'}</div>
                        </div>`;
                    return;
                }

                const maxHours = Math.max(1, ...hourly.map(item => item.hours || 0));
                barsEl.innerHTML = `
                    <div class="chart-y-axis"><span>${maxHours.toFixed(1)}h</span><span>0h</span></div>
                    ${hourly.map(item => `
                        <div class="hour-bar-wrap" data-tippy-content="<div style='font-size:11px;font-weight:600;'>${item.hour}:00</div><div style='color:var(--mint);font-size:12px;font-weight:700;margin-top:2px;'>${item.hours.toFixed(1)} hrs</div>">
                            <div class="hour-bar" style="height:${Math.max(2, (item.hours / maxHours) * 118)}px"></div>
                            <span class="hour-label">${item.hour}</span>
                        </div>
                    `).join('')}
                `;

                // 馃専 鏍稿績浼樺寲锛氬浘琛ㄧ粍浠跺姩鎬佹寕杞界簿鑷寸殑 Tippy.js 榛戝簳姘旀场鍗＄墖
                tippy('.hour-bar-wrap', {
                    allowHTML: true,
                    theme: 'dark',
                    placement: 'top',
                    animation: 'shift-away',
                    duration: [150, 100],
                    appendTo: () => document.body
                });

            } catch (e) {
                document.getElementById('rhythmLabel').innerText = dict.serviceUnavailable;
                document.getElementById('focusStyle').innerText = dict.tryLater;
                document.getElementById('lifeRecommendation').innerText = dict.analyticsNoResponse;
                barsEl.innerHTML = '';
            }
        }
