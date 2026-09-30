# 断片のコマを本編（パンチイン・閃光込み）に重ねて、切り抜いた一覧（コンタクトシート）にする。
# 使い方: python sheet.py <clip_frames_dir> <fx_dir> <flash_dir> <frames: a-b[:step] | n,n,...> <crop: x0,y0,x1,y1> <tile_w> <cols> <out.jpg>
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
clip_dir, fx_dir, flash_dir, frames_arg, crop_arg, tile_w, cols, out = sys.argv[1:9]
AT, FLASH_AT, FLASH_LEN = 524, 590, 12


def punch_scale(n):
    if n <= 590:
        return 1.0
    if n <= 592:
        u = (n - 590) / 2
        return 1 + 0.06 * (1 - 2 ** (-10 * u) if u < 1 else 1)
    if n <= 612:
        return 1.06
    if n <= 633:
        u = (n - 612) / 21
        e = 4 * u ** 3 if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2
        return 1.06 - 0.06 * e
    return 1.0


def frame(n_local):
    n = AT + n_local
    base = Image.open(os.path.join(clip_dir, f"f{n:04d}.png")).convert("RGBA")
    k = punch_scale(n)
    if k != 1.0:
        w, h = round(1280 * k), round(720 * k)
        big = base.resize((w, h), Image.BICUBIC)
        base = big.crop(((w - 1280) // 2, (h - 720) // 2, (w - 1280) // 2 + 1280, (h - 720) // 2 + 720))
    if FLASH_AT <= n < FLASH_AT + FLASH_LEN:
        base = Image.alpha_composite(base, Image.open(os.path.join(flash_dir, f"flash-{(n - FLASH_AT) / 30:.3f}.png")).convert("RGBA"))
    ov = Image.open(os.path.join(fx_dir, f"fx-{n_local / 30:.3f}.png")).convert("RGBA")
    return Image.alpha_composite(base, ov)


if "," in frames_arg and "-" not in frames_arg:
    frames = [int(x) for x in frames_arg.split(",")]
else:
    rng, _, step = frames_arg.partition(":")
    a, b = map(int, rng.split("-"))
    frames = list(range(a, b + 1, int(step or 1)))
x0, y0, x1, y1 = map(int, crop_arg.split(","))
tw = int(tile_w)
th = round(tw * (y1 - y0) / (x1 - x0))
cols = int(cols)
rows = (len(frames) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * th), "white")
for i, n in enumerate(frames):
    im = frame(n).crop((x0, y0, x1, y1)).resize((tw, th), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    label = f"f{AT + n} {(AT + n) / 30:.3f}s (+{n / 30:.3f})"
    d.rectangle([0, 0, 8 + 6 * len(label), 14], fill=(0, 0, 0, 200))
    d.text((4, 2), label, fill=(255, 255, 255, 255))
    sheet.paste(im.convert("RGB"), ((i % cols) * tw, (i // cols) * th))
sheet.save(out, quality=90)
print(out, len(frames), "frames")
