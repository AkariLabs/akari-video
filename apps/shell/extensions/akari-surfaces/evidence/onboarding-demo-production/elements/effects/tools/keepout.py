# 透過描画の各コマについて、alpha > 8 の画素の外接矩形と、禁止域に入った画素数を数える。
# 禁止域: 人物の届く範囲（y<470 で x<690、y 470〜660 で x<815）・字幕帯（x 300〜980・y≥628）・
#         右の舞台の外（y<460 は x 720〜1240、y 460〜610 は x 830〜1240 の外）
# 使い方: python keepout.py <dir> <prefix> <frame_a> <frame_b> [--json out.json]
import json
import sys

import numpy as np
from PIL import Image

d, prefix, a, b = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
out_json = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
H, W = 720, 1280
yy, xx = np.mgrid[0:H, 0:W]
person = ((yy < 470) & (xx < 690)) | ((yy >= 470) & (yy < 660) & (xx < 815))
caption = (xx >= 300) & (xx < 980) & (yy >= 628)
stage = ((yy < 460) & (xx >= 720) & (xx < 1240)) | ((yy >= 460) & (yy < 610) & (xx >= 830) & (xx < 1240))
rows = []
union = None
for n in range(a, b + 1):
    im = np.asarray(Image.open(f"{d}/{prefix}-{n / 30:.3f}.png").convert("RGBA"))
    m = im[:, :, 3] > 8
    if m.any():
        ys, xs = np.where(m)
        bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
        union = bbox if union is None else [min(union[0], bbox[0]), min(union[1], bbox[1]), max(union[2], bbox[2]), max(union[3], bbox[3])]
    else:
        bbox = None
    row = {"frame": n, "local_s": round(n / 30, 3), "abs_s": round(17.4667 + n / 30, 3), "px": int(m.sum()), "bbox": bbox,
           "person_px": int((m & person).sum()), "caption_px": int((m & caption).sum()), "outside_stage_px": int((m & ~stage).sum())}
    rows.append(row)
worst = {k: max(r[k] for r in rows) for k in ("person_px", "caption_px", "outside_stage_px")}
bad = [r for r in rows if r["person_px"] or r["caption_px"] or r["outside_stage_px"]]
for r in bad[:40]:
    print("BAD", r)
print(json.dumps({"frames": len(rows), "union_bbox": union, "max": worst}))
if out_json:
    json.dump({"frames": rows, "union_bbox": union, "max": worst}, open(out_json, "w"), indent=1)
