# 「ほら」のキラッの音（r2 の書き出し）と、demo-effects の放射・紙吹雪のコマを同じ時間軸に並べる（目視用）。
# 使い方: python av-strip.py <clip_frames_dir f%04d.png> <fx_dir fx-<local>.png> <sfxonly.mp4> <measure.json> <out.png>
# 断片のコマは effects 担当の tools/render-effects.mjs（--frames、背景透過）で描いたもの。本編のパンチインは
# 構成表の keyframes（612→633 で 1.06→1 in-out-cubic）を同じ式で掛ける。字幕・閃光は重ねない（この区間に無い）。
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

clip_dir, fx_dir, sfx_mp4, measure_path, out_path = sys.argv[1:6]
FF = "<WORKTREE>/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
SR = 48000
AT = 524  # demo-effects の at（コマ）
FRAMES = list(range(616, 624))
M = json.load(open(measure_path, encoding="utf-8"))
sync = M["sync_render"]["r2"]


def punch_scale(n):
    if n <= 612:
        return 1.06
    if n <= 633:
        u = (n - 612) / 21
        e = 4 * u ** 3 if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2
        return 1.06 - 0.06 * e
    return 1.0


def frame(n):
    base = Image.open(os.path.join(clip_dir, f"f{n:04d}.png")).convert("RGBA")
    k = punch_scale(n)
    w, h = round(1280 * k), round(720 * k)
    big = base.resize((w, h), Image.BICUBIC)
    base = big.crop(((w - 1280) // 2, (h - 720) // 2, (w - 1280) // 2 + 1280, (h - 720) // 2 + 720))
    ov = Image.open(os.path.join(fx_dir, f"fx-{(n - AT) / 30:.3f}.png")).convert("RGBA")
    return Image.alpha_composite(base, ov).convert("RGB")


FB = ImageFont.truetype("C:/Windows/Fonts/YuGothB.ttc", 20)
FS = ImageFont.truetype("C:/Windows/Fonts/YuGothM.ttc", 16)
INK = (23, 19, 15); SUB = (107, 94, 82); OR = (249, 115, 22); DK = (200, 80, 10); BL = (60, 140, 230)
TW = 220
W, H = 40 + TW * len(FRAMES), 760
img = Image.new("RGB", (W, H), (250, 248, 244))
d = ImageDraw.Draw(img)
d.text((20, 12), "「ほら」のキラッ — 音（r2・書き出し）と demo-effects の放射・紙吹雪のコマ（f616〜f623）", font=FB, fill=INK)
d.text((20, 40), "上: 本編＋断片（右の舞台 x 720〜1280・y 40〜600 を切り出し）。下: 効果音だけの書き出しの 5 ms 窓 RMS。縦線 = 各コマの表示時刻", font=FS, fill=SUB)
T0 = FRAMES[0] / 30 - 1 / 60
T1 = FRAMES[-1] / 30 + 1 / 60
X0 = 20


def tx(t):
    return X0 + (t - T0) / (T1 - T0) * (TW * len(FRAMES))


for i, n in enumerate(FRAMES):
    f = frame(n).crop((720, 40, 1280, 600)).resize((TW - 6, TW - 6), Image.LANCZOS)
    x = X0 + i * TW + 3
    img.paste(f, (x, 70))
    d.text((x + 4, 70 + TW - 2), f"f{n}  {n / 30:.3f}s", font=FS, fill=INK)
raw = subprocess.run([FF, "-v", "error", "-i", sfx_mp4, "-vn", "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
                     capture_output=True, check=True).stdout
a = np.frombuffer(raw, dtype="<f4").astype(np.float64).reshape(-1, 2)
p = (a ** 2).mean(axis=1)
n5 = int(0.005 * SR)
cs = np.concatenate([[0.0], np.cumsum(p)])
Y0, Y1 = 330, 720


def ydb(v):
    return Y0 + (-8 - max(-50, min(-8, v))) / 42 * (Y1 - Y0)


for v in (-10, -20, -30, -40, -50):
    d.line([(X0, ydb(v)), (X0 + TW * len(FRAMES), ydb(v))], fill=(225, 220, 212))
    d.text((X0 + TW * len(FRAMES) - 34, ydb(v) - 18), f"{v}", font=FS, fill=SUB)
for n in FRAMES:
    d.line([(tx(n / 30), Y0 - 10), (tx(n / 30), Y1)], fill=(215, 210, 202), width=1)
pts = []
for px in range(int(tx(T0)), int(tx(T1))):
    t = T0 + (px - X0) / (TW * len(FRAMES)) * (T1 - T0)
    i = int(t * SR)
    v = 10 * np.log10((cs[i + n5 // 2] - cs[i - n5 // 2]) / n5 + 1e-20)
    pts.append((px, ydb(v)))
d.line(pts, fill=OR, width=3)
marks = [(20.552, BL, "「ほ」語頭 20.552", 0), (sync["kira_onset_s"], OR, f"キラッの立ち上がり {sync['kira_onset_s']:.3f}", 1),
         (sync["shimmer_swell_peak_s_env50"], DK, f"キラキラの山 {sync['shimmer_swell_peak_s_env50']:.3f}", 2),
         (20.617, SUB, "擬音の跳ね 1.15（20.617）", 3), (20.697, SUB, "放射の最大（20.697〜20.73）", 4)]
for t, col, lab, row in marks:
    x = tx(t)
    d.line([(x, Y0 - 12), (x, Y1)], fill=col, width=2)
    d.text((x + 4, 560 + row * 24), lab, font=FS, fill=col)
img.save(out_path)
print(out_path)
