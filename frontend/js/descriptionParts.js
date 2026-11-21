/* A task made from the chat has a description in two parts: what to do (written by the AI), then notes the
 * app adds ("From chat: ..." and "Estimated: 2 h"). The details box shows the notes apart and a little dimmer. */

const NOTES_START = /^\s*(From chat:|来自对话[:：]|Estimated:|预计耗时)/;

/** {main, notes}: the text before the first notes line, and from that line on (both trimmed, '' when absent). */
export function splitDescription(description) {
    const lines = String(description || '').split('\n');
    const at = lines.findIndex((line) => NOTES_START.test(line));
    if (at < 0) return { main: lines.join('\n').trim(), notes: '' };
    return { main: lines.slice(0, at).join('\n').trim(), notes: lines.slice(at).join('\n').trim() };
}
