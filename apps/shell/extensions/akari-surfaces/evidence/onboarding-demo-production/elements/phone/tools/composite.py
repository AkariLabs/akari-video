# 断片の透過 PNG を clip.mp4 の同時刻フレームに重ねる（phone-screen の段も計画の幾何で再現する）。
# 使い方: python composite.py <frames_dir> <render_dir> <prefix> <out_dir> seek1,seek2,...
import sys, os
from PIL import Image, ImageDraw, ImageFont

frames_dir, render_dir, prefix, out_dir, seeks = sys.argv[1:6]
AT = 809  # フレーム
SCREEN_AT, SCREEN_END = 833, 977
CROP_X, CROP_W = 0.2080 * 1280, 0.2645 * 1280
SCALE = 0.6607
CX, CY = 640 + 372, 360 - 24
BW, BH = CROP_W * SCALE, 720 * SCALE
X0, Y0 = CX - BW / 2, CY - BH / 2
os.makedirs(out_dir, exist_ok=True)


def screen_layer(src):
    # 出力 (X, Y) → 素材 (sx, sy) の逆写像。箱の外は透明
    a = 1 / SCALE
    img = src.convert("RGBA").transform(
        (1280, 720), Image.AFFINE, (a, 0, CROP_X - X0 * a, 0, a, -Y0 * a), resample=Image.BICUBIC)
    mask = Image.new("L", (1280 * 4, 720 * 4), 0)
    ImageDraw.Draw(mask).rectangle([X0 * 4, Y0 * 4, (X0 + BW) * 4 - 1, (Y0 + BH) * 4 - 1], fill=255)
    mask = mask.resize((1280, 720), Image.LANCZOS)
    img.putalpha(mask)
    return img


for s in [float(x) for x in seeks.split(",")]:
    frame = AT + round(s * 30)
    base = Image.open(os.path.join(frames_dir, f"f{frame:04d}.png")).convert("RGBA")
    if SCREEN_AT <= frame < SCREEN_END:
        base = Image.alpha_composite(base, screen_layer(Image.open(os.path.join(frames_dir, f"f{frame:04d}.png"))))
    ov = Image.open(os.path.join(render_dir, f"{prefix}-{s:.3f}.png")).convert("RGBA")
    out = Image.alpha_composite(base, ov)
    d = ImageDraw.Draw(out)
    label = f"local {s:.3f}s / abs {frame / 30:.3f}s (f{frame})"
    d.rectangle([8, 8, 8 + 8 * len(label), 30], fill=(0, 0, 0, 180))
    d.text((12, 12), label, fill=(255, 255, 255, 255))
    out.convert("RGB").save(os.path.join(out_dir, f"{prefix}-{s:.3f}-on-clip.png"))
    print(os.path.join(out_dir, f"{prefix}-{s:.3f}-on-clip.png"))
