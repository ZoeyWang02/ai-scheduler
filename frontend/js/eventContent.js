/* What an entry looks like in the month view and the list view, so a task, an event and a class can be told apart
 * at a glance. (The week and day views already do: they draw an event or class with its real length.)
 *
 *   month:  [☐] Due 17:00        [■] 13:00-14:30       [■] 10:00-10:50
 *               Homework             Study group           STAT 400 lecture
 *   list:   [Due] Homework       [Event] Study group    [Class] STAT 400 lecture
 *
 * A task gets a check box (ticked once it is done) because it is something to finish; an event or class gets a
 * solid square in its colour because it is a stretch of time. */

import { clockText } from './timeSpan.js';

const TAG_KEYS = { task: 'tagDue', event: 'tagEvent', course: 'tagClass' };

/** The words for one entry: {kind, tag, time, done}. `time` is "17:00" for a task, "13:00-14:30" otherwise. */
export function describeEntry(props, dict) {
    const kind = TAG_KEYS[props.kind] ? props.kind : 'task';
    const time = clockText(props.localStart, kind === 'task' ? null : props.localEnd);
    return { kind, tag: dict[TAG_KEYS[kind]], time, done: kind === 'task' && !!props.completed };
}

const element = (className, text = '') => {
    const el = document.createElement('span');
    el.className = className;
    if (text) el.textContent = text;
    return el;
};

/** FullCalendar's eventContent hook. Returns true (keep the standard drawing) outside the month and list views. */
export function calendarEventContent(arg, dict) {
    const view = arg.view.type;
    const month = view.startsWith('dayGrid');
    if (!month && !view.startsWith('list')) return true;

    const { kind, tag, time, done } = describeEntry(arg.event.extendedProps, dict);
    const root = element(`entry entry-${kind}${done ? ' entry-done' : ''}${month ? ' entry-month' : ' entry-list'}`);
    if (!month) {
        root.append(element('entry-tag', tag), element('entry-title', arg.event.title));
        return { domNodes: [root] };
    }
    const mark = element('entry-mark', done ? '✓' : '');
    if (kind !== 'task') mark.style.background = arg.event.backgroundColor || '';
    const meta = element('entry-meta');
    meta.append(mark, element('entry-time', kind === 'task' ? `${tag} ${time}`.trim() : time));
    root.append(meta, element('entry-title', arg.event.title));
    return { domNodes: [root] };
}
