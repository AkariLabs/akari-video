# 本体の位置を毎コマ実測する（上端と左端の輪郭をサブピクセルで取る）。
# 上端: x 960〜1060 の平均輝度の縦断面（y 80〜104）で、壁→枠の段差の位置を重心で求める。
# 左端: y 200〜300 の平均輝度の横断面（x 880〜904）で同様。枠（不透明）なので下の映像に左右されない
import json, sys
import numpy as np
from PIL import Image
src = sys.argv[1]
res = []
for n in range(179):
    g = np.asarray(Image.open(f"{src}/e{n+1:03d}.png").convert("L")).astype(float)
    vprof = g[74:98, 960:1060].mean(axis=1)
    hprof = g[200:300, 878:899].mean(axis=0)
    dv = np.abs(np.diff(vprof)); dh = np.abs(np.diff(hprof))
    # 最大の段差（枠の外縁とベゼル）の重心
    def centroid(d, off):
        w = np.where(d > d.max() * 0.35, d, 0)
        return float((w * (np.arange(len(d)) + 0.5)).sum() / w.sum()) + off if w.sum() > 0 else None
    res.append({"f": n, "abs": round((809 + n) / 30, 4), "top_edge_y": round(centroid(dv, 74), 3), "left_edge_x": round(centroid(dh, 878), 3)})
still = [r for r in res if 12 <= r["f"] <= 169]
ty = [r["top_edge_y"] for r in still]; lx = [r["left_edge_x"] for r in still]
summary = {"frames": "12..169 (27.3667〜32.6000)", "top_edge_y_min": min(ty), "top_edge_y_max": max(ty), "top_edge_range_px": round(max(ty) - min(ty), 3),
           "left_edge_x_min": min(lx), "left_edge_x_max": max(lx), "left_edge_range_px": round(max(lx) - min(lx), 3)}
print(json.dumps(summary, ensure_ascii=False))
json.dump({"summary": summary, "frames": res}, open(f"{src}-still.json", "w"), ensure_ascii=False, indent=1)
for r in res[:14] + res[166:]:
    print(r)
