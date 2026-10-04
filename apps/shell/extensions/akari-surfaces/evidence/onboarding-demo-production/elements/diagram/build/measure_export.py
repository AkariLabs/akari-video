# 書き出し（render-cut）の mp4 から切り出したコマ e<frame>.png と、元の本編のコマ bg/f<frame>.png、
# ハーネスの合成コマ p-f<frame>.png を比べる。
#   python measure_export.py <export-dir> <bg-dir> <harness-dir> <out.json>
# (1) 書き出しで部品が最初に見えたフレーム（本編との差分が箱の中で跳ねた最初のコマ）と語頭の差
# (2) ハーネスとのパリティ（舞台の箱での平均絶対差・大きく違う画素の割合）
import json
import os
import sys

import numpy as np
from PIL import Image

ex, bgdir, hdir, out = sys.argv[1:5]
FPS = 30


def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.int16)


def diff_count(n, box, thr=40):
    x0, y0, x1, y1 = box
    a = load(os.path.join(ex, f"e{n}.png"))[y0:y1, x0:x1]
    b = load(os.path.join(bgdir, f"f{n}.png"))[y0:y1, x0:x1]
    return int((np.abs(a - b).sum(-1) > thr).sum())


def first(box, lo, hi, need, thr=40):
    for n in range(lo, hi):
        if diff_count(n, box, thr) >= need:
            return n
    return None


CARD = (724, 112, 1240, 452)
AXIS = (826, 178, 1216, 398)
KNOB = (820, 164, 1220, 178)
COUNTS = (740, 405, 1236, 443)
rows = []
for name, word, ws, box, lo, need, thr in [
    ("カード＋段のラベル", "こういう", 23.27, CARD, 690, 200, 12),
    ("積み上げ（最初の部品）", "図解", 23.78, AXIS, 703, 12, 90),
    ("再生ヘッド", "出せます", 24.37, KNOB, 720, 6, 60),
    ("件数", "し", 24.78, COUNTS, 735, 20, 60),
]:
    # 積み上げ・ヘッド・件数は、その部品の出る前のコマ（カードは出ている）との差分で見る
    if name == "カード＋段のラベル":
        f = first(box, lo, 760, need, thr)
    else:
        ref = load(os.path.join(ex, f"e{lo}.png"))
        x0, y0, x1, y1 = box
        f = None
        for n in range(lo + 1, 780):
            a = load(os.path.join(ex, f"e{n}.png"))[y0:y1, x0:x1]
            b = load(os.path.join(bgdir, f"f{n}.png"))[y0:y1, x0:x1]
            r = ref[y0:y1, x0:x1]
            # 本編の動きではなく、カードの上の変化だけを見る（箱はカードの内側）
            if int((np.abs(a - r).sum(-1) > thr).sum()) >= need:
                f = n
                break
    t = f / FPS
    rows.append({"element": name, "word": word, "word_s": ws, "first_visible_frame": f, "first_visible_s": round(t, 4),
                 "diff_s": round(t - ws, 4), "diff_frames": round(f - ws * FPS, 2), "within_0_15": abs(t - ws) <= .15})

# 最後に見えたコマ
last = None
for n in range(806, 690, -1):
    if diff_count(n, CARD, 12) >= 200:
        last = n
        break

# パリティ（舞台の箱）
STAGE = (700, 100, 1280, 470)
par = []
for n in range(697, 807):
    hp = os.path.join(hdir, f"p-f{n}.png")
    if not os.path.exists(hp):
        continue
    x0, y0, x1, y1 = STAGE
    a = load(os.path.join(ex, f"e{n}.png"))[y0:y1, x0:x1]
    b = load(hp)[y0:y1, x0:x1]
    d = np.abs(a - b)
    par.append({"frame": n, "mean_abs": round(float(d.mean()), 3), "ratio_gt40": round(float((d.sum(-1) > 40).mean()), 5)})
worst = max(par, key=lambda r: r["mean_abs"])
worst_ratio = max(par, key=lambda r: r["ratio_gt40"])
res = {"sync_export": rows, "last_visible_frame": last, "last_visible_s": round(last / FPS, 4) if last else None,
       "parity_vs_harness": {"frames": len(par), "worst_mean_abs": worst, "worst_ratio_gt40": worst_ratio,
                             "mean_of_mean_abs": round(sum(r["mean_abs"] for r in par) / len(par), 3)}}
json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False, indent=1))
