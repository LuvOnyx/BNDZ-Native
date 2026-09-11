from PIL import Image
from pathlib import Path

src = Path(r"C:\Users\mikey\Projects\BNDZ-Native\public\Bndz-main.png")
img = Image.open(src).convert("RGBA")


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


sizes = [16, 24, 32, 48, 64, 128, 256]
icons = [fill_square(img, s) for s in sizes]
out_paths = [
    Path(r"C:\Users\mikey\Projects\BNDZ-Native\public\BNDZ.ico"),
    Path(r"C:\Users\mikey\Projects\BNDZ-Native\BNDZBackend\Assets\BNDZ.ico"),
]
for out in out_paths:
    icons[-1].save(
        out,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=icons[:-1],
    )
    print(f"wrote {out} ({out.stat().st_size} bytes)")
print("src", img.size)
