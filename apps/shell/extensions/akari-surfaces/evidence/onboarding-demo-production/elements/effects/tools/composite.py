# 断片の透過 PNG を clip.mp4 の同時刻のコマに重ねる（ハーネスでの目視用。本物の書き出しは render-cut）。
# 本編のパンチイン（構成表の keyframes: 590→592 で 1→1.06 out-expo、612→633 で 1.06→1 in-out-cubic）と
# 閃光（demo-flash を同じハーネスで描いた透過 PNG・段は擬音より下）も重ねる。字幕は重ねない。
# 使い方: python composite.py <clip_frames_dir> <fx_dir> <fx_prefix> <flash_dir> <out_dir> <seek,...> [--guides]
import os
import sys
from PIL import Image, ImageDraw

clip_dir, fx_dir, fx_prefix, flash_dir, out_dir, seeks = sys.argv[1:7]
guides = "--guides" in sys.argv
AT = 524          # 断片の at（コマ）
FLASH_AT, FLASH_LEN = 590, 12
os.makedirs(out_dir, exist_ok=True)


def punch_scale(n):
    if n <= 590:
        return 1.0
    if n <= 592:
        u = (n - 590) / 2
        e = 1 - 2 ** (-10 * u) if u < 1 else 1
        return 1 + 0.06 * e
    if n <= 612:
        return 1.06
    if n <= 633:
        u = (n - 612) / 21
        e = 4 * u ** 3 if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2
        return 1.06 - 0.06 * e
    return 1.0


for s in [float(x) for x in seeks.split(",")]:
    n = AT + round(s * 30)
    base = Image.open(os.path.join(clip_dir, f"f{n:04d}.png")).convert("RGBA")
    k = punch_scale(n)
    if k != 1.0:
        w, h = round(1280 * k), round(720 * k)
        big = base.resize((w, h), Image.BICUBIC)
        base = big.crop(((w - 1280) // 2, (h - 720) // 2, (w - 1280) // 2 + 1280, (h - 720) // 2 + 720))
    if FLASH_AT <= n < FLASH_AT + FLASH_LEN:
        fl = os.path.join(flash_dir, f"flash-{(n - FLASH_AT) / 30:.3f}.png")
        base = Image.alpha_composite(base, Image.open(fl).convert("RGBA"))
    ov = Image.open(os.path.join(fx_dir, f"{fx_prefix}-{s:.3f}.png")).convert("RGBA")
    out = Image.alpha_composite(base, ov)
    d = ImageDraw.Draw(out)
    if guides:
        d.rectangle([0, 0, 690, 470], outline=(230, 40, 40, 255), width=2)        # 人物の届く範囲（y<470）
        d.rectangle([0, 470, 815, 660], outline=(230, 40, 40, 255), width=2)      # 人物の届く範囲（y 470〜660）
        d.rectangle([300, 628, 980, 719], outline=(40, 90, 230, 255), width=2)    # 字幕帯
        d.line([(720, 0), (720, 460), (830, 460), (830, 610), (1240, 610), (1240, 0)], fill=(40, 170, 60, 255), width=2)
    label = f"local {s:.3f}s / abs {n / 30:.3f}s (f{n})" + (f" punch {k:.3f}" if k != 1 else "")
    d.rectangle([8, 8, 8 + 7 * len(label), 28], fill=(0, 0, 0, 170))
    d.text((12, 12), label, fill=(255, 255, 255, 255))
    path = os.path.join(out_dir, f"{fx_prefix}-{s:.3f}-on-clip{'-guides' if guides else ''}.png")
    out.convert("RGB").save(path)
    print(path)
