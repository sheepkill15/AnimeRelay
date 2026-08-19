from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SIZE = 1024
SCALE = 4


def scaled(point):
    return tuple(int(value * SCALE) for value in point)


canvas = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
pixels = canvas.load()
for y in range(48 * SCALE, 976 * SCALE):
    ratio = (y / SCALE - 48) / 928
    start = (165, 138, 255)
    end = (74, 42, 184)
    color = tuple(round(a + (b - a) * ratio) for a, b in zip(start, end)) + (255,)
    for x in range(48 * SCALE, 976 * SCALE):
        pixels[x, y] = color

mask = Image.new("L", canvas.size, 0)
ImageDraw.Draw(mask).rounded_rectangle(scaled((48, 48, 976, 976)), radius=240 * SCALE, fill=255)
canvas.putalpha(mask)
draw = ImageDraw.Draw(canvas, "RGBA")
draw.ellipse(scaled((208, 208, 816, 816)), fill=(36, 22, 83, 52))

orbit_box = scaled((230, 230, 794, 794))
draw.arc(orbit_box, start=204, end=316, fill=(237, 232, 255, 184), width=46 * SCALE)
draw.arc(orbit_box, start=24, end=136, fill=(237, 232, 255, 184), width=46 * SCALE)
draw.line([scaled((719, 221)), scaled((808, 244)), scaled((741, 309))], fill=(237, 232, 255, 184), width=46 * SCALE, joint="curve")
draw.line([scaled((305, 803)), scaled((216, 780)), scaled((283, 715))], fill=(237, 232, 255, 184), width=46 * SCALE, joint="curve")

shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
shadow_draw = ImageDraw.Draw(shadow, "RGBA")
shadow_draw.polygon([scaled((420, 342)), scaled((718, 531)), scaled((420, 720))], fill=(29, 12, 75, 105))
canvas.alpha_composite(shadow)
draw = ImageDraw.Draw(canvas, "RGBA")
draw.polygon([scaled((420, 323)), scaled((718, 512)), scaled((420, 701))], fill=(255, 255, 255, 255))
draw.ellipse(scaled((711, 593, 867, 749)), fill=(185, 255, 102, 255), outline=(255, 255, 255, 255), width=24 * SCALE)
draw.line([scaled((750, 672)), scaled((778, 700)), scaled((830, 639))], fill=(52, 32, 100, 255), width=24 * SCALE, joint="curve")

master = canvas.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
(ROOT / "assets").mkdir(exist_ok=True)
master.save(ROOT / "assets" / "icon.png")
master.save(ROOT / "assets" / "icon.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])

extension_icons = ROOT / "extension" / "icons"
extension_icons.mkdir(parents=True, exist_ok=True)
for size in (16, 32, 48, 128):
    master.resize((size, size), Image.Resampling.LANCZOS).save(extension_icons / f"icon-{size}.png")
