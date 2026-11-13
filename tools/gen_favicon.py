"""Builds the browser-tab icon from the 'sprout' sprite in frontend/js/pixelSprites.js.

Outputs (all in frontend/):
  favicon.svg          crisp-edged vector, used by current browsers
  favicon.ico          16/32/48 px, the fallback browsers and tools request by default
  apple-touch-icon.png 180 px, for iOS home-screen bookmarks

Run from the repo root:  python tools/gen_favicon.py   (needs Pillow)
"""
import pathlib
import re

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPRITES_JS = ROOT / "frontend" / "js" / "pixelSprites.js"
OUT = ROOT / "frontend"
NAME = "sprout"


def read_palette(source: str) -> dict:
    block = re.search(r"SPRITE_PALETTE\s*=\s*\{(.*?)\};", source, re.S).group(1)
    return dict(re.findall(r"(\w+):\s*'(#[0-9a-fA-F]{6})'", block))


def read_rows(source: str, name: str) -> list:
    block = re.search(r"'" + re.escape(name) + r"':\s*\[(.*?)\]", source, re.S).group(1)
    return re.findall(r"'([^']{16})'", block)


def to_rgba(hex_color: str):
    return tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def main() -> None:
    source = SPRITES_JS.read_text(encoding="utf-8")
    palette = read_palette(source)
    rows = read_rows(source, NAME)
    assert len(rows) == 16, f"expected 16 rows, got {len(rows)}"

    # SVG: one run-length rect per colour run, no anti-aliasing.
    rects = []
    for y, row in enumerate(rows):
        x = 0
        while x < len(row):
            ch = row[x]
            if ch == ".":
                x += 1
                continue
            run = 1
            while x + run < len(row) and row[x + run] == ch:
                run += 1
            rects.append(f'<rect x="{x}" y="{y}" width="{run}" height="1" fill="{palette[ch]}"/>')
            x += run
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">'
           + "".join(rects) + "</svg>\n")
    (OUT / "favicon.svg").write_text(svg, encoding="utf-8")

    # Raster: 16x16 master, scaled with nearest-neighbour so pixels stay sharp.
    master = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                master.putpixel((x, y), to_rgba(palette[ch]))
    master.save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    # iOS draws the icon on its own background, so give it a cream tile with padding.
    tile = Image.new("RGBA", (180, 180), to_rgba("#fffaf0"))
    sprite = master.resize((128, 128), Image.NEAREST)
    tile.paste(sprite, (26, 26), sprite)
    tile.convert("RGB").save(OUT / "apple-touch-icon.png")

    print("wrote favicon.svg, favicon.ico, apple-touch-icon.png in", OUT)


if __name__ == "__main__":
    main()
