export function showToast(message, type = 'info') {
            const container = document.getElementById('toast-container');
            if (!container) return;
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.innerText = message;
            container.appendChild(toast);

            // 瑙﹀彂鍥炴祦瀹炵幇鍔ㄦ晥
            toast.offsetHeight;
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';

            // 3绉掑悗娣″嚭绉婚櫎
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(-20px)';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

window.alert = function (msg) {
            const lang = localStorage.getItem('appLang') || 'zh';
            // 鏍规嵁甯歌涓枃鍏抽敭瀛楁櫤鑳藉尮閰嶉€氱煡棰滆壊
            if (msg.includes('failed') || msg.includes('失败') || msg.includes('error') || msg.includes('请先')) {
                showToast(msg, 'error');
            } else if (msg.includes('success') || msg.includes('成功') || msg.includes('完成')) {
                showToast(msg, 'success');
            } else {
                showToast(msg, 'info');
            }
        };

export function getUtcOffsetLabel(zone) {
            try {
                const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(new Date());
                const offset = parts.find(p => p.type === 'timeZoneName');
                return offset ? offset.value : zone;
            } catch (e) {
                return zone;
            }
        }

export function linkify(text) {
            if (!text) return "";
            const escaped = escapeHtml(text);
            const urlPattern = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
            return escaped.replace(urlPattern, function (url) {
                return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline; font-weight: 500;">${url}</a>`;
            });
        }

export function escapeHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }
