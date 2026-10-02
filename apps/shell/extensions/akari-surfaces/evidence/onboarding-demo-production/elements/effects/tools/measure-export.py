# ミニ書き出し（本編 16.8〜22.3 s ＋ 閃光 ＋ パンチイン ＋ 効果音 3 本 ＋ この断片）と、
# 同じ条件で断片だけ外した書き出しを比べて、断片の各見せ場が最初に見えたコマを測る。
#   寄与 C(n) = |E(n) − B(n)|（断片が足した絵）。見せ場の箱の中で、
#   (a) 何も無かった所に出るもの（札）: C の平均が初めて閾値を越えたコマ
#   (b) 既にある絵が動き出すもの（ほら・こんな感じで）: C(n) と C(n−1) の差の平均が静止区間の後で初めて閾値を越えたコマ
# さらに、書き出しとハーネス描画（透過 PNG を同じ本編のコマに重ねたもの）の舞台での差（MAD）を全コマで出す。
# 使い方: python measure-export.py <ex_dir> <exb_dir> <harness_dir> <out.json>
import json
import sys

import numpy as np
from PIL import Image

ex, exb, hdir, out = sys.argv[1:5]
START = 16.8
AT = 20                     # 断片の at（ミニ書き出しのコマ）
N = 165


def load(d, prefix, n):
    return np.asarray(Image.open(f"{d}/{prefix}{n + 1:04d}.png").convert("RGB")).astype(np.float32)


E = [load(ex, "e", n) for n in range(N)]
B = [load(exb, "b", n) for n in range(N)]
C = [np.abs(e - b).mean(axis=2) for e, b in zip(E, B)]


def box_mean(img, box):
    x0, y0, x1, y1 = box
    return float(img[y0:y1, x0:x1].mean())


PARTS = [
    # (名前, 語, 語頭, 箱, 方式, 探す範囲（ミニ書き出しのコマ）, 閾値)
    ("札「♪ 効果音」", "効果音", 17.50, (740, 88, 940, 160), "appear", (15, 40), 2.0),
    ("札「✦ エフェクト」（✦ の軌跡のキラッを含む）", "エフェクト", 18.74, (940, 40, 1210, 160), "appear", (50, 80), 2.0),
    ("擬音「パッ!」＋放射線＋衝撃の輪", "パッ", 19.70, (820, 230, 1200, 440), "appear", (80, 100), 2.0),
    ("ほら: 擬音の跳ね＋キラッ 12 個＋紙吹雪", "ほら", 20.55, (760, 160, 1240, 600), "change", (100, 125), 1.0),
    ("こんな感じで: ✓ バッジ（札 1）", "こんな感じで", 21.10, (905, 72, 960, 118), "change", (120, 145), 2.0),
]
rows = []
for name, word, word_s, box, mode, (a, b), th in PARTS:
    series = []
    first = None
    for n in range(a, b):
        v = box_mean(C[n], box) if mode == "appear" else box_mean(np.abs(C[n] - C[n - 1]), box)
        series.append(round(v, 2))
        if first is None and v > th:
            first = n
    fs = round(START + first / 30, 3) if first is not None else None
    rows.append({"part": name, "word": word, "word_s": word_s, "box": box, "method": mode, "threshold": th,
                 "first_visible_frame_in_mini": first, "first_visible_s": fs,
                 "delta_s": round(fs - word_s, 3) if fs is not None else None,
                 "within_0.15": fs is not None and abs(fs - word_s) <= 0.15,
                 "series_from_frame": a, "series": series})

# 書き出しとハーネスのパリティ（舞台 700-1280 × 40-620）
par = []
for n in range(AT, AT + 135):
    k = n - AT
    base = Image.fromarray(B[n].astype(np.uint8)).convert("RGBA")
    ov = Image.open(f"{hdir}/fx-{k / 30:.3f}.png").convert("RGBA")
    H = np.asarray(Image.alpha_composite(base, ov).convert("RGB")).astype(np.float32)
    d = np.abs(H - E[n]).mean(axis=2)[40:620, 700:1280]
    par.append(round(float(d.mean()), 3))
bg = [round(float(np.abs(E[n] - B[n]).mean(axis=2)[400:700, 0:600].mean()), 3) for n in range(AT, AT + 135)]
res = {"parts": rows,
       "export_vs_harness_stage_mad": {"mean": round(float(np.mean(par)), 3), "max": max(par), "argmax_local_frame": int(np.argmax(par)), "per_frame": par},
       "export_vs_base_person_area_mad": {"mean": round(float(np.mean(bg)), 3), "max": max(bg),
                                          "note": "人物側（x 0-600・y 400-700）で、断片あり／なしの書き出しの差 = 圧縮の揺らぎの大きさ"}}
json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for r in rows:
    print(r["word"], r["word_s"], "->", r["first_visible_s"], "delta", r["delta_s"], r["within_0.15"])
print("parity stage MAD mean", res["export_vs_harness_stage_mad"]["mean"], "max", res["export_vs_harness_stage_mad"]["max"],
      "@", res["export_vs_harness_stage_mad"]["argmax_local_frame"], "| person-area noise", res["export_vs_base_person_area_mad"])
