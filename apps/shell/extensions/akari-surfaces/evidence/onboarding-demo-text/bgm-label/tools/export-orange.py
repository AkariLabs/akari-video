# 札あり / 札なしの書き出し（同じ設定）を舞台の箱で比べ、新たに橙（札の地 #F97316 付近）になった
# 画素を数えて、札の出る / 消えるフレームと本体の左端を測る。符号化の揺れに強い判定。
# 使い方: python export-orange.py <札ありフレームの dir> <札なしフレームの dir> <first> <last> <out.json>
#   （フレームは f<合成フレーム番号>.png。ffmpeg -i x.mp4 -start_number <先頭の合成フレーム> f%d.png で作る）
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

on, off, first, last, out = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), Path(sys.argv[5])
x0, y0, x1, y1 = 600, 40, 1000, 460


def orange(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (r > 200) & (g > 70) & (g < 160) & (b < 90) & (r - b > 140)


rows = []
for f in range(first, last + 1):
    a = np.asarray(Image.open(on / f"f{f}.png").convert("RGB")).astype(np.int16)[y0:y1, x0:x1]
    b = np.asarray(Image.open(off / f"f{f}.png").convert("RGB")).astype(np.int16)[y0:y1, x0:x1]
    m = orange(a) & ~orange(b)
    ys, xs = np.nonzero(m)
    rows.append({"frame": f, "t": round(f / 30, 4), "orange_px": int(m.sum()),
                 "bbox": [int(xs.min()) + x0, int(ys.min()) + y0, int(xs.max()) + x0, int(ys.max()) + y0] if len(xs) else None})
vis = [r for r in rows if r["orange_px"] > 50]
res = {"box": [x0, y0, x1, y1], "first_visible_frame": vis[0]["frame"] if vis else None,
       "last_visible_frame": vis[-1]["frame"] if vis else None, "rows": rows}
out.write_text(json.dumps(res, indent=1), encoding="utf-8")
print(json.dumps({k: v for k, v in res.items() if k != "rows"}))
