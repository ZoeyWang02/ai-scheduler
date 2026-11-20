/* How a task's or event's time is written.
 *
 * A task is a deadline: one moment ("Due 2027-03-01 10:00"). An event has a start and an end: a span
 * ("2027-03-01 10:00-11:30, 1.5 h"). Both take local date-times as the API gives them
 * ("YYYY-MM-DDTHH:MM[:SS]" or "YYYY-MM-DD HH:MM") and never convert zones. */

const PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/;

/** {date: 'YYYY-MM-DD', time: 'HH:MM', minutes: minutes since 1970 (as if UTC)} or null. */
function parts(text) {
    const m = PATTERN.exec(typeof text === 'string' ? text : '');
    if (!m) return null;
    const [year, month, day] = m[1].split('-').map(Number);
    return { date: m[1], time: `${m[2]}:${m[3]}`, minutes: Date.UTC(year, month - 1, day, Number(m[2]), Number(m[3])) / 60000 };
}

/** Length of the span in minutes, or null when it is not a valid start and end (end after start). */
export function spanMinutes(start, end) {
    const a = parts(start);
    const b = parts(end);
    return a && b && b.minutes > a.minutes ? b.minutes - a.minutes : null;
}

/** "45 min", "1.5 h", "2 h", "1 day 2 h" in the language. */
export function durationText(minutes, lang) {
    const zh = lang === 'zh';
    if (minutes < 60) return `${minutes} ${zh ? '分钟' : 'min'}`;
    if (minutes < 24 * 60) {
        const hours = Math.round(minutes / 6) / 10; // one decimal
        return `${hours} ${zh ? '小时' : 'h'}`;
    }
    const days = Math.floor(minutes / (24 * 60));
    const rest = Math.round((minutes - days * 24 * 60) / 60);
    if (zh) return `${days} 天${rest ? ` ${rest} 小时` : ''}`;
    return `${days} day${days > 1 ? 's' : ''}${rest ? ` ${rest} h` : ''}`;
}

/** "2027-03-01 10:00-11:30" on one day, "2027-03-01 22:00 - 2027-03-02 01:00" across days. Null when invalid. */
export function spanText(start, end) {
    const a = parts(start);
    const b = parts(end);
    if (!a || !b || b.minutes <= a.minutes) return null;
    return a.date === b.date ? `${a.date} ${a.time}-${b.time}` : `${a.date} ${a.time} - ${b.date} ${b.time}`;
}

/** The line shown in the details box and the tooltip.
 *  - an event or class (has an end): "Time: 2027-03-01 10:00-11:30 (1.5 h)"
 *  - a task (no end): "Due: 2027-03-01 10:00"
 *  `start` alone means a task. An end that is not after the start is ignored, so bad data still shows the start. */
export function timeLine(start, end, lang) {
    const zh = lang === 'zh';
    const span = end ? spanText(start, end) : null;
    if (span) return `${zh ? '时间: ' : 'Time: '}${span} (${durationText(spanMinutes(start, end), lang)})`;
    const a = parts(start);
    const when = a ? `${a.date} ${a.time}` : String(start || '');
    return `${zh ? '截止: ' : 'Due: '}${when}`;
}

/** Just the clock part of a row: "10:00-11:30" for an event, "10:00" for a task, '' when there is no time. */
export function clockText(start, end) {
    const a = parts(start);
    if (!a) return '';
    const b = end ? parts(end) : null;
    return b && b.minutes > a.minutes ? `${a.time}-${b.time}` : a.time;
}
