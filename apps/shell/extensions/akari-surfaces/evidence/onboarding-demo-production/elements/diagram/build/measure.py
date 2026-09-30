# demo-diagram の実測（透明連番 a-f<frame>.png から）: 部品ごとの最初に見えたフレームと語頭の差、置き場所。
#   python measure.py <transparent-seq-dir> <out.json>
# 部品の判定は画素の色で行う（DOM の値ではなく、実際に絵として出たかどうか）。
import glob
import json
import os
import re
import sys

import numpy as np
from PIL import Image

seq, out = sys.argv[1], sys.argv[2]
FPS = 30
AT = 697
frames = {}
for f in glob.glob(os.path.join(seq, "a-f*.png")):
    n = int(re.search(r"a-f(\d+)\.png$", f).group(1))
    frames[n] = f
order = sorted(frames)
cache = {}


def rgba(n):
    if n not in cache:
        cache[n] = np.asarray(Image.open(frames[n]).convert("RGBA")).astype(np.int16)
    return cache[n]


CARD = (724, 112, 1240, 452)          # x0, y0, x1, y1
AXIS = (826, 178, 1216, 398)          # 4 段の中身（時間軸の範囲 830〜1212 ±4）
KNOB = (820, 164, 1220, 178)          # 再生ヘッドの丸い頭（段の上。カードの白地の上なので、半透明の頭は灰色に出る）
FLAG = (990, 126, 1220, 160)          #「いまここ」
COUNTS = (740, 405, 1236, 443)        # 件数の行


def region(a, box):
    x0, y0, x1, y1 = box
    return a[y0:y1, x0:x1]


def visible_any(n, box, thr=20, need=30):
    r = region(rgba(n), box)
    return int((r[..., 3] > thr).sum()) >= need


def orange_or_ink(n, box, need=12):
    r = region(rgba(n), box)
    a = r[..., 3]
    orange = (r[..., 0] - r[..., 2] > 70) & (a > 90)
    ink = (r[..., 0] < 110) & (a > 90)
    return int((orange | ink).sum()) >= need


def dark(n, box, need=6):
    r = region(rgba(n), box)
    return int(((r[..., 0] < 200) & (r[..., 3] > 60)).sum()) >= need


def orange(n, box, need=12):
    r = region(rgba(n), box)
    return int(((r[..., 0] - r[..., 2] > 70) & (r[..., 3] > 90)).sum()) >= need


def counts_text(n, need=20):
    r = region(rgba(n), COUNTS)
    a = r[..., 3]
    # カードの白地（255 近く）から離れた色で、不透明度のある画素 = 文字（墨の補助色のラベル・橙の数字の両方）
    ink = (765 - r[..., 0] - r[..., 1] - r[..., 2]) > 90
    return int((ink & (a > 60)).sum()) >= need


def first(pred, lo=AT):
    for n in order:
        if n >= lo and pred(n):
            return n
    return None


rows = []


def row(name, word, word_s, frame):
    t = frame / FPS
    rows.append({"element": name, "word": word, "word_s": word_s, "word_frame": round(word_s * FPS, 2),
                 "first_visible_frame": frame, "first_visible_s": round(t, 4),
                 "diff_s": round(t - word_s, 4), "diff_frames": round(frame - word_s * FPS, 2),
                 "within_0_15": abs(t - word_s) <= 0.15, "within_target_0_05": abs(t - word_s) <= 0.05})


row("カード＋段のラベル", "こういう", 23.27, first(lambda n: visible_any(n, CARD)))
row("積み上げ（最初の部品）", "図解", 23.78, first(lambda n: orange_or_ink(n, AXIS)))
row("再生ヘッド", "出せます", 24.37, first(lambda n: dark(n, KNOB)))
row("件数", "し", 24.78, first(lambda n: counts_text(n)))
flag = first(lambda n: orange(n, FLAG))

# 積み上げの完了（前のコマと中身が変わらなくなった最初のコマ。ヘッドが走る前まで）
def axis_diff(n):
    a, b = region(rgba(n), AXIS), region(rgba(n - 1), AXIS)
    return int(np.abs(a - b).sum(-1).max())

build_start = rows[1]["first_visible_frame"]
build_end = None
for n in range(build_start + 1, 731):
    if axis_diff(n) < 8 and axis_diff(n + 1) < 8:
        build_end = n - 1
        break

# 抜け
last = max(n for n in order if visible_any(n, (0, 0, 1280, 720), thr=3, need=1))

# 置き場所
ALL = (0, 0, 1280, 720)
rest = rgba(760)
ys, xs = np.nonzero(rest[..., 3] > 64)
rest_bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
person_max = 0
caption_px = 0
outside_stage = []
for n in order:
    if n < AT or n > 806:
        continue
    a = rgba(n)[..., 3]
    p1 = a[:470, :690]
    p2 = a[470:660, :815]
    person_max = max(person_max, int(p1.max()), int(p2.max()))
    caption_px += int((a[628:, 300:980] > 0).sum())
    ys, xs = np.nonzero(a > 64)
    if len(xs) and (xs.max() > 1240 or xs.min() < 720 or ys.max() > 460):
        outside_stage.append({"frame": n, "x": [int(xs.min()), int(xs.max())], "y": [int(ys.min()), int(ys.max())]})

result = {
    "sync": rows,
    "flag_first_visible": {"frame": flag, "s": round(flag / FPS, 4) if flag else None,
                           "note": "「いまここ」は語ではなくヘッドの着地（24.687）に合わせる"},
    "build_window": {"first_frame": build_start, "settled_frame": build_end,
                     "duration_s": round((build_end - build_start + 1) / FPS, 3) if build_end else None},
    "last_visible_frame": last, "last_visible_s": round(last / FPS, 4),
    "rest_bbox_alpha_gt_64_at_f760": rest_bbox,
    "person_zone_max_alpha": person_max,
    "caption_band_pixels": caption_px,
    "frames_outside_stage_alpha_gt_64": outside_stage,
}
json.dump(result, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps(result, ensure_ascii=False, indent=1))
