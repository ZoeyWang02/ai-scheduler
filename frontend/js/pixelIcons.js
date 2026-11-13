import { PIXELARTICONS } from './pixelIconData.js';
import { SPRITES, SPRITE_PALETTE } from './pixelSprites.js';

/* Pixel icon system. Two kinds, picked by name:
   - UI glyphs  (pixelarticons, 24x24, single color via currentColor): close, plus, ...
   - sprites    (our own 16x16, fixed colors): sprout, mailbox, mood faces, egg, ...
   Both render as inline <svg> with crisp edges, so they follow the same integer-scale
   rule as the rest of the pixel UI: glyphs at 24px, sprites at 16px (x1), 32px (x2),
   48px (x3). Never an emoji and never a stroked/anti-aliased icon. */

const spriteCache = new Map();

function spriteRects(name) {
    if (spriteCache.has(name)) return spriteCache.get(name);
    const rows = SPRITES[name];
    const rects = [];
    rows.forEach((row, y) => {
        let x = 0;
        while (x < row.length) {
            const ch = row[x];
            if (ch === '.') { x++; continue; }
            let run = 1;
            while (x + run < row.length && row[x + run] === ch) run++;
            rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${SPRITE_PALETTE[ch]}"/>`);
            x += run;
        }
    });
    const markup = rects.join('');
    spriteCache.set(name, markup);
    return markup;
}

export function hasPixelIcon(name) {
    return Boolean(PIXELARTICONS[name] || SPRITES[name]);
}

/** Inline-SVG markup for an icon. `size` is the rendered px size (use whole multiples of the
 *  native grid: 24 for glyphs, 16/32/48 for sprites). `className` is added for styling. */
export function pixelIcon(name, { size, className = '' } = {}) {
    const cls = `px-icon px-icon-${name}${className ? ' ' + className : ''}`;
    const base = 'xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" shape-rendering="crispEdges"';
    if (PIXELARTICONS[name]) {
        const px = size || 24;
        return `<svg class="${cls}" ${base} width="${px}" height="${px}" viewBox="0 0 24 24" fill="currentColor">${PIXELARTICONS[name]}</svg>`;
    }
    if (SPRITES[name]) {
        const px = size || 16;
        return `<svg class="${cls}" ${base} width="${px}" height="${px}" viewBox="0 0 16 16">${spriteRects(name)}</svg>`;
    }
    console.warn(`pixelIcon: unknown icon "${name}"`);
    return '';
}

/** Fills every <span data-icon="name"> (optionally data-icon-size) under `root` with its icon.
 *  Safe to call repeatedly; already-filled slots are skipped. */
export function initPixelIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach(slot => {
        if (slot.dataset.iconReady) return;
        const size = slot.dataset.iconSize ? Number(slot.dataset.iconSize) : undefined;
        slot.innerHTML = pixelIcon(slot.dataset.icon, { size });
        slot.dataset.iconReady = '1';
    });
}
