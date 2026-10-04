# demo-bgm の足あと（透明背景で撮った全フレームのアルファ）を、構成表の置き場所のルールで数える。
# 人物の届く範囲 = y<470 で x<690、y 470〜660 で x<815。字幕帯 = x 300〜980・y>=628。
# 右の舞台 = y<460 は x 720〜1240、y 460〜610 は x 830〜1240（それ以外は舞台の外）。
# 使い方: python footprint.py <透明フレームの dir> <prefix> <out.json>
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

src, prefix, out = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
report = json.loads((src / f"{prefix}-report.json").read_text(encoding="utf-8"))
H, W = 720, 1280
yy, xx = np.mgrid[0:H, 0:W]
person = ((yy < 470) & (xx < 690)) | ((yy >= 470) & (yy < 660) & (xx < 815))
caption = (xx >= 300) & (xx <= 980) & (yy >= 628)
stage = ((yy < 460) & (xx >= 720) & (xx <= 1240)) | ((yy >= 460) & (yy < 610) & (xx >= 830) & (xx <= 1240))
res = {"frames": 0, "per_frame": []}
union3 = np.zeros((H, W), bool)
union25 = np.zeros((H, W), bool)
tot = {"person_3": 0, "caption_3": 0, "outside_stage_3": 0, "outside_stage_25": 0}
frames_out25 = []
for row in report[1:]:
    a = np.asarray(Image.open(src / row["out"]).convert("RGBA"))[:, :, 3].astype(np.float32) / 255
    m3, m25 = a > 0.03, a > 0.25
    union3 |= m3
    union25 |= m25
    p3 = int((m3 & person).sum())
    c3 = int((m3 & caption).sum())
    o3 = int((m3 & ~stage).sum())
    o25 = int((m25 & ~stage).sum())
    tot["person_3"] += p3
    tot["caption_3"] += c3
    tot["outside_stage_3"] += o3
    tot["outside_stage_25"] += o25
    if o25:
        frames_out25.append(row["frame"])
    ys, xs = np.nonzero(m25)
    bbox25 = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None
    res["per_frame"].append({"frame": row["frame"], "person_px": p3, "caption_px": c3,
                             "outside_stage_px_a3": o3, "outside_stage_px_a25": o25, "bbox_a25": bbox25})
    res["frames"] += 1


def bbox(m):
    ys, xs = np.nonzero(m)
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None


res["union_bbox_alpha_gt_3pct"] = bbox(union3)
res["union_bbox_alpha_gt_25pct"] = bbox(union25)
res["totals"] = tot
res["frames_with_body_outside_stage"] = frames_out25
out.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps({k: res[k] for k in ("frames", "union_bbox_alpha_gt_3pct", "union_bbox_alpha_gt_25pct", "totals", "frames_with_body_outside_stage")}, ensure_ascii=False))
