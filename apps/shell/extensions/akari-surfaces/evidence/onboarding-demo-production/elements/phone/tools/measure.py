# 書き出し（GPU / OSR）の全 179 コマを、素材の同時刻コマと比べて測る。
#  - 最初に見えるフレーム（本体 = 右の舞台に差分が出た最初のコマ）
#  - 画面点灯の最初のコマ（画面の中央 = 起動画面の暗さが崩れた最初のコマ）
#  - 本体の外形（枠の上端 y・左端 x）を毎コマ実測し、27.40〜32.60 で 1px も動かないか
#  - 人物の届く範囲・字幕帯に差分画素があるか（入りと抜けのコマは別に数える）
#  - GPU と OSR の差（同じコマの平均絶対差）
import json, sys
import numpy as np
from PIL import Image
AT = 809; FPS = 30
def load(p): return np.asarray(Image.open(p).convert("RGB")).astype(int)
out = {"frames": []}
first_visible = None; first_screen_change = None
tops = {}; lefts = {}
for n in range(179):
    g = load(f"fin/gpu/e{n+1:03d}.png"); s = load(f"fin/src/s{n:03d}.png"); o = load(f"fin/osr/e{n+1:03d}.png")
    d = np.abs(g - s).max(axis=2)
    stage = d[:, 700:]
    changed = stage > 24
    if first_visible is None and changed.sum() > 200: first_visible = n
    # 本体の外形: 列 x=1012（中央）で上から最初に枠色が出る行、行 y=336 で左から最初の差分列
    col = d[:, 1012]; row = d[336, 820:1012]
    ys = np.nonzero(col > 40)[0]; xs = np.nonzero(row > 40)[0]
    top = int(ys[0]) if len(ys) else None; left = int(820 + xs[0]) if len(xs) else None
    tops[n] = top; lefts[n] = left
    # 画面中央の明るさ（起動画面は暗い）
    center = g[300:372, 980:1044].mean()
    band = (d[628:, 300:981] > 24).sum()
    person = (d[:470, :690] > 24).sum() + (d[470:660, :815] > 24).sum()
    parity = float(np.abs(g - o).mean())
    parity_phone = float(np.abs(g[60:640, 850:1180] - o[60:640, 850:1180]).mean())
    out["frames"].append({"f": n, "abs": round((AT + n) / FPS, 4), "top": top, "left": left, "center_luma": round(float(center), 1),
                          "band_px": int(band), "person_px": int(person), "gpu_osr_mad": round(parity, 3), "gpu_osr_mad_phone": round(parity_phone, 3)})
lum = [fr["center_luma"] for fr in out["frames"]]
base_dark = np.mean(lum[14:22])
for fr in out["frames"][20:40]:
    if fr["center_luma"] > base_dark + 12: first_screen_change = fr["f"]; break
still = [fr for fr in out["frames"] if 12 <= fr["f"] <= 169]
out["summary"] = {
    "first_visible_frame": first_visible, "first_visible_abs": round((AT + first_visible) / FPS, 4), "word_sumaho": 27.07,
    "first_visible_delta_s": round((AT + first_visible) / FPS - 27.07, 4),
    "screen_on_frame": first_screen_change, "screen_on_abs": round((AT + first_screen_change) / FPS, 4) if first_screen_change is not None else None,
    "word_mockup": 27.77, "screen_on_delta_s": round((AT + first_screen_change) / FPS - 27.77, 4) if first_screen_change is not None else None,
    "still_27_40_to_32_60": {"frames": [12, 169], "top_values": sorted(set(fr["top"] for fr in still)), "left_values": sorted(set(fr["left"] for fr in still))},
    "band_px_by_frame_nonzero": {fr["f"]: fr["band_px"] for fr in out["frames"] if fr["band_px"] > 0},
    "person_px_max": max(fr["person_px"] for fr in out["frames"]),
    "gpu_osr_mad_phone_max": max(fr["gpu_osr_mad_phone"] for fr in out["frames"]),
    "gpu_osr_mad_phone_mean": round(float(np.mean([fr["gpu_osr_mad_phone"] for fr in out["frames"]])), 3),
}
json.dump(out, open("fin/measure.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps(out["summary"], ensure_ascii=False, indent=1))
for fr in out["frames"][:16] + out["frames"][20:30] + out["frames"][160:]:
    print(fr)
