"""Regenerate multi-resolution BNDZ.ico (fill/zoom) for taskbar + ApplicationIcon.

Sizes match BNDZBackend/Services/AppIconService.cs (16–256 including 20/24/60).
Run from repo root: python3 scripts/_gen-bndz-ico-from-main.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "Bndz-main.png"
# Keep in sync with AppIconService.IconSizes
SIZES = [16, 20, 24, 32, 48, 60, 64, 128, 256]
OUT_PATHS = [
    ROOT / "public" / "BNDZ.ico",
    ROOT / "BNDZBackend" / "Assets" / "BNDZ.ico",
]


def fill_square(im: Image.Image, size: int) -> Image.Image:
    bbox = im.getbbox() or (0, 0, im.width, im.height)
    cropped = im.crop(bbox)
    w, h = cropped.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(cropped, ((side - w) // 2, (side - h) // 2), cropped)
    zoom = 1.12
    zw, zh = int(side * zoom), int(side * zoom)
    zoomed = canvas.resize((zw, zh), Image.Resampling.LANCZOS)
    left = (zw - side) // 2
    top = (zh - side) // 2
    filled = zoomed.crop((left, top, left + side, top + side))
    return filled.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    img = Image.open(SRC).convert("RGBA")
    icons = [fill_square(img, s) for s in SIZES]
    for out in OUT_PATHS:
        out.parent.mkdir(parents=True, exist_ok=True)
        icons[-1].save(
            out,
            format="ICO",
            sizes=[(s, s) for s in SIZES],
            append_images=icons[:-1],
        )
        print(f"wrote {out} ({out.stat().st_size} bytes) sizes={SIZES}")
    print("src", img.size)


if __name__ == "__main__":
    main()
