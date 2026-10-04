# 書き出し（札あり）と書き出し（札なし・ほかは同じ）の差分から、札の出る時刻と足あとを測る。
# 使い方: python export-diff.py <札ありフレームの dir> <札なしフレームの dir> <first> <last> <out.json>
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

on, off, first, last, out = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), Path(sys.argv[5])
H, W = 720, 1280
yy, xx = np.mgrid[0:H, 0:W]
person = ((yy < 470) & (xx < 690)) | ((yy >= 470) & (yy < 660) & (xx < 815))
caption = (xx >= 300) & (xx <= 980) & (yy >= 628)
stage = ((yy < 460) & (xx >= 720) & (xx <= 1240)) | ((yy >= 460) & (yy < 610) & (xx >= 830) & (xx <= 1240))
rows = []
first_visible = None
union = np.zeros((H, W), bool)
strong_union = np.zeros((H, W), bool)
for f in range(first, last + 1):
    a = np.asarray(Image.open(on / f"f{f}.png").convert("RGB")).astype(np.int16)
    b = np.asarray(Image.open(off / f"f{f}.png").convert("RGB")).astype(np.int16)
    d = np.abs(a - b).max(axis=2)
    m = d > 12          # 符号化の揺れ（数値 ≲ 8）より上
    strong = d > 40     # 札の本体（橙の地・白い字）
    n = int(m.sum())
    if n > 300 and first_visible is None:
        first_visible = f
    union |= m
    strong_union |= strong
    ys, xs = np.nonzero(strong)
    rows.append({"frame": f, "t": round(f / 30, 4), "changed_px": n, "strong_px": int(strong.sum()),
                 "bbox_strong": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None,
                 "person_px": int((m & person).sum()), "caption_px": int((m & caption).sum()),
                 "outside_stage_strong_px": int((strong & ~stage).sum())})


def bbox(mask):
    ys, xs = np.nonzero(mask)
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None


res = {
    "first_visible_frame": first_visible,
    "first_visible_t": round(first_visible / 30, 4) if first_visible else None,
    "word_onset_BGM": 29.45,
    "diff_s": round(first_visible / 30 - 29.45, 3) if first_visible else None,
    "union_bbox_changed": bbox(union),
    "union_bbox_strong": bbox(strong_union),
    "person_px_total": sum(r["person_px"] for r in rows),
    "caption_px_total": sum(r["caption_px"] for r in rows),
    "outside_stage_strong_px_total": sum(r["outside_stage_strong_px"] for r in rows),
    "last_changed_frame": max((r["frame"] for r in rows if r["changed_px"] > 300), default=None),
    "rows": rows,
}
out.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps({k: v for k, v in res.items() if k != "rows"}, ensure_ascii=False))
