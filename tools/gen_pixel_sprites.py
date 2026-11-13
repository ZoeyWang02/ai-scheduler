"""Draws the app's small colored pixel sprites and writes frontend/js/pixelSprites.js.

Sprites are 16x16. Each one is built from a few filled shapes; the generator then
adds a 1px outline and simple top-left light / bottom-right shade, so every sprite
gets the same lighting without hand-placing each pixel. Output is plain character
grids (one char per pixel, '.' = transparent) that are easy to hand-edit later.

    python tools/gen_pixel_sprites.py                # writes frontend/js/pixelSprites.js
    python tools/gen_pixel_sprites.py --sheet out.html   # also writes a contact sheet to eyeball
"""
import math
import pathlib
import sys

SIZE = 16
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_JS = ROOT / "frontend" / "js" / "pixelSprites.js"

PALETTE = {
    "k": "#3a2412",  # outline
    "y": "#e8b84b", "Y": "#fbe3a0", "Q": "#c58f2c",  # yellow  base / light / shade
    "g": "#5b8c3a", "G": "#8fbf6b", "h": "#3d6624",  # green
    "b": "#7a5230", "B": "#a8743c", "n": "#5a3a1e",  # brown
    "r": "#c1440e", "R": "#e0795a", "s": "#8f2e08",  # red
    "w": "#fffaf0", "W": "#ffffff", "x": "#d8c9a0",  # cream
    "o": "#e08a3c",  # orange (beaks, feet)
    "p": "#e89aa0",  # blush
}


class Canvas:
    def __init__(self):
        self.g = [["."] * SIZE for _ in range(SIZE)]

    def px(self, x, y, c):
        if 0 <= x < SIZE and 0 <= y < SIZE:
            self.g[y][x] = c

    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.px(xx, yy, c)

    def ellipse(self, cx, cy, rx, ry, c):
        for y in range(SIZE):
            for x in range(SIZE):
                dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1.0:
                    self.g[y][x] = c

    def poly(self, pts, c):
        for y in range(SIZE):
            for x in range(SIZE):
                px, py, inside, j = x + 0.5, y + 0.5, False, len(pts) - 1
                for i in range(len(pts)):
                    (xi, yi), (xj, yj) = pts[i], pts[j]
                    if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
                        inside = not inside
                    j = i
                if inside:
                    self.g[y][x] = c

    def bevel(self, base, light, dark):
        """Light on edges facing top/left, shade on edges facing bottom/right."""
        def empty(x, y):
            return not (0 <= x < SIZE and 0 <= y < SIZE) or self.g[y][x] == "."
        out = [row[:] for row in self.g]
        for y in range(SIZE):
            for x in range(SIZE):
                if self.g[y][x] != base:
                    continue
                if empty(x, y - 1) or empty(x - 1, y):
                    out[y][x] = light
                elif empty(x + 1, y) or empty(x, y + 1):
                    out[y][x] = dark
        self.g = out

    def outline(self, c="k"):
        out = [row[:] for row in self.g]
        for y in range(SIZE):
            for x in range(SIZE):
                if self.g[y][x] != ".":
                    continue
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < SIZE and 0 <= ny < SIZE and self.g[ny][nx] != ".":
                        out[y][x] = c
                        break
        self.g = out

    def rows(self):
        return ["".join(r) for r in self.g]


def star_points(cx, cy, outer, inner, points=5):
    pts = []
    for i in range(points * 2):
        ang = math.radians(-90 + 180 / points * i)
        r = outer if i % 2 == 0 else inner
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return pts


def sprout():
    c = Canvas()
    c.ellipse(8, 13.6, 6, 2.4, "b")          # soil mound
    c.bevel("b", "B", "n")
    c.rect(7, 6, 2, 8, "g")                   # stem
    # Leaves sit low and overlap the stem: a wide gap between leaf and stem would be
    # filled solid by the auto-outline and read as a black blob.
    c.ellipse(4.4, 8.2, 3.6, 2.2, "g")        # left leaf
    c.ellipse(11.6, 5.6, 3.6, 2.2, "g")       # right leaf (higher, for asymmetry)
    c.bevel("g", "G", "h")
    c.outline()
    return c.rows()


def mailbox():
    c = Canvas()
    c.rect(5, 12, 2, 4, "b")                  # post
    c.rect(12, 3, 1, 6, "n")                  # flag pole
    c.rect(13, 3, 2, 2, "y")                  # flag (keep 1px free on the right for the outline)
    c.ellipse(6, 6.8, 5, 3.6, "r")            # arched roof
    c.rect(1, 7, 10, 5, "r")                  # body
    c.bevel("r", "R", "s")
    c.rect(7, 8, 1, 3, "s")                   # door seam
    c.outline()
    return c.rows()


def star():
    c = Canvas()
    c.poly(star_points(8, 8.6, 7.4, 3.1), "y")
    c.bevel("y", "Y", "Q")
    c.outline()
    return c.rows()


def sparkle():
    c = Canvas()
    c.poly([(8, 1), (9.7, 6.3), (15, 8), (9.7, 9.7), (8, 15), (6.3, 9.7), (1, 8), (6.3, 6.3)], "y")
    c.bevel("y", "Y", "Q")
    c.rect(7, 7, 2, 2, "W")
    c.outline()
    return c.rows()


def face():
    c = Canvas()
    c.ellipse(8, 8, 6.6, 6.6, "y")
    c.bevel("y", "Y", "Q")
    c.outline()
    return c


def mood_calm():
    c = face()
    for x in (4, 5, 6, 9, 10, 11):            # closed, content eyes
        c.px(x, 7, "k")
    for x, y in ((6, 11), (7, 12), (8, 12), (9, 11)):   # small smile
        c.px(x, y, "k")
    return c.rows()


def mood_happy():
    c = face()
    for x in (5, 10):                          # open eyes
        c.px(x, 6, "k")
        c.px(x, 7, "k")
    for x, y in ((4, 9), (5, 10), (6, 11), (7, 11), (8, 11), (9, 11), (10, 10), (11, 9)):  # wide smile
        c.px(x, y, "k")
    for x in (3, 12):                          # blush
        c.px(x, 9, "R")
    return c.rows()


def mood_excited():
    c = face()
    for cx in (5, 10):                         # star eyes
        for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
            c.px(cx + dx, 6 + dy, "o")
        c.px(cx, 6, "r")
    c.rect(6, 10, 4, 3, "k")                   # open mouth
    c.rect(7, 12, 2, 1, "r")                   # tongue
    return c.rows()


def egg():
    c = Canvas()
    c.ellipse(8, 6.8, 3.9, 4.8, "w")
    c.ellipse(8, 10, 5, 4.8, "w")
    c.bevel("w", "W", "x")
    for x, y in ((6, 9), (10, 11), (7, 13), (9, 7), (11, 9)):   # speckles
        c.px(x, y, "Q")
    c.outline()
    return c.rows()


def hatching():
    c = Canvas()
    c.ellipse(8, 6.2, 3.6, 3.6, "y")           # chick head
    c.bevel("y", "Y", "Q")
    c.ellipse(8, 12, 5.6, 4.0, "w")            # lower shell
    for x in range(SIZE):                      # zig-zag crack along the top edge
        top = 9 if x % 2 else 8
        for y in range(0, top):
            if c.g[y][x] == "w":
                c.g[y][x] = "."
    c.bevel("w", "W", "x")
    c.px(6, 5, "k")
    c.px(10, 5, "k")
    c.px(8, 7, "o")
    c.outline()
    return c.rows()


def chick():
    c = Canvas()
    c.ellipse(8, 8.4, 5.6, 5.2, "y")
    c.bevel("y", "Y", "Q")
    for x, y in ((3, 9), (3, 10), (4, 11)):    # wings
        c.px(x, y, "Q")
    for x, y in ((12, 9), (12, 10), (11, 11)):
        c.px(x, y, "Q")
    for x in (5, 6, 9, 10):                    # feet
        c.px(x, 14, "o")
    c.outline()
    c.px(6, 6, "k")
    c.px(10, 6, "k")
    c.px(7, 8, "o")
    c.px(8, 8, "o")
    return c.rows()


SPRITES = {
    "sprout": sprout(), "mailbox": mailbox(), "star": star(), "sparkle": sparkle(),
    "mood-calm": mood_calm(), "mood-happy": mood_happy(), "mood-excited": mood_excited(),
    "egg": egg(), "hatching": hatching(), "chick": chick(),
}


def write_js():
    lines = [
        "// GENERATED by tools/gen_pixel_sprites.py — regenerate there, or hand-edit the grids below.",
        "// 16x16 sprites: one character per pixel, '.' is transparent, other keys are in SPRITE_PALETTE.",
        "export const SPRITE_PALETTE = {",
    ]
    lines += [f"    {k}: '{v}'," for k, v in PALETTE.items()]
    lines += ["};", "", "export const SPRITES = {"]
    for name, rows in SPRITES.items():
        assert len(rows) == SIZE and all(len(r) == SIZE for r in rows), name
        assert all(ch == "." or ch in PALETTE for r in rows for ch in r), name
        lines.append(f"    '{name}': [")
        lines += [f"        '{r}'," for r in rows]
        lines.append("    ],")
    lines.append("};")
    OUT_JS.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT_JS.relative_to(ROOT)} ({len(SPRITES)} sprites)")


def write_sheet(path):
    def svg(rows, scale):
        rects = []
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch != ".":
                    rects.append(f'<rect x="{x}" y="{y}" width="1" height="1" fill="{PALETTE[ch]}"/>')
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="{16*scale}" '
                f'height="{16*scale}" shape-rendering="crispEdges">{"".join(rects)}</svg>')
    cells = []
    for name, rows in SPRITES.items():
        cells.append(f'<div class="c"><div class="big">{svg(rows, 10)}</div>'
                     f'<div class="small">{svg(rows, 1)} {svg(rows, 3)}</div><b>{name}</b></div>')
    html = ("<!doctype html><meta charset=utf-8><style>body{background:#fffaf0;font:12px monospace;margin:16px}"
            ".g{display:flex;flex-wrap:wrap;gap:16px}.c{background:#f0e4c8;padding:8px}"
            ".big{background:#fffaf0}.small{margin:6px 0;display:flex;gap:8px;align-items:flex-end}"
            ".dark .c{background:#2b3048;color:#ece0c4}.dark .big{background:#1b2138}</style>"
            f'<div class="g">{"".join(cells)}</div><hr><div class="g dark">{"".join(cells)}</div>')
    pathlib.Path(path).write_text(html, encoding="utf-8")
    print("wrote contact sheet", path)


if __name__ == "__main__":
    write_js()
    if "--sheet" in sys.argv:
        write_sheet(sys.argv[sys.argv.index("--sheet") + 1])
