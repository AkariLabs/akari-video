# 画面の穴の検査（phone-screen を単色マゼンタに差し替えた書き出しのフレーム）
# はみ出し: 本体の外形（角丸 26.14px・外側へ 1.5px の余裕）の外にマゼンタ寄りの画素があるか
# 隙間:     見える窓（ベゼル内側の角丸）の内側で、マゼンタでもベゼルの黒でもない画素（= 壁）があるか
import sys, json, math
import numpy as np
from PIL import Image
f = sys.argv[1]
a = np.asarray(Image.open(f).convert("RGB")).astype(int)
H, W, _ = a.shape
yy, xx = np.mgrid[0:H, 0:W]
def rr_inside(x0, y0, x1, y1, r, px, py):
    # 角丸長方形の内側か（点は画素中心）
    cx = np.clip(px, x0 + r, x1 - r); cy = np.clip(py, y0 + r, y1 - r)
    return ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) & (px >= x0) & (px <= x1) & (py >= y0) & (py <= y1)
px, py = xx + 0.5, yy + 0.5
L, T, BW, BH, R = 891, 89, 242, 494, 10.8 * 242 / 100
S, OV = 9.15, 1.2
outer = rr_inside(L - 1.5, T - 1.5, L + BW + 1.5, T + BH + 1.5, R + 1.5, px, py)
win = rr_inside(L + S + OV + 1, T + S + OV + 1, L + BW - S - OV - 1, T + BH - S - OV - 1, R - S - OV - 1, px, py)
r_, g_, b_ = a[..., 0], a[..., 1], a[..., 2]
magentaish = (r_ - g_ > 60) & (b_ - g_ > 60)
poke = magentaish & ~outer
inwin_not_mag = win & ~((r_ > 200) & (g_ < 70) & (b_ > 200))
# 窓の中の UI（文字・アイコン・影のグラデ・進捗バー・センサー窓）を除くため、縁から 3px の帯だけ見る
edge_band = win & ~rr_inside(L + S + OV + 4, T + S + OV + 4, L + BW - S - OV - 4, T + BH - S - OV - 4, R - S - OV - 4, px, py)
top_zone = (py < T + S + 40)  # 上端はセンサー窓が帯に近いので別扱いにしない（島は帯から 7px 離れている）
gap = edge_band & inwin_not_mag & ~(py > T + BH - S - 150)  # 下 30% は黒のグラデで色が変わるので除外
gap_bottom = edge_band & (py > T + BH - S - 150) & ~((r_ - g_ > 40) & (b_ - g_ > 40))  # 下はマゼンタが暗くなるだけ
print(json.dumps({"frame": f.split("/")[-1], "poke_px": int(poke.sum()), "edge_band_px": int(edge_band.sum()),
    "gap_px_upper": int(gap.sum()), "gap_px_bottom": int(gap_bottom.sum()),
    "window_px": int(win.sum()), "window_not_magenta_px": int(inwin_not_mag.sum())}))
