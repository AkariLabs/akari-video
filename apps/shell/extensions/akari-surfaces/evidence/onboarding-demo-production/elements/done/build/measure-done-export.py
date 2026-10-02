# demo-done の書き出し（render-cut --engine osr、本編 11.0〜15.0 秒・demo-done at 8）の実測。
#   python measure-done-export.py <out.json> <フレームを書き出すフォルダ> [書き出した mp4]
# 語頭ごとに「元素材との差が箱の中で立ち上がる最初のフレーム」、最後に見えるフレーム、人物・字幕帯の差を出す
import subprocess, json, sys
import numpy as np
FF = "C:/Users/kyach/akari-wt/onboarding-demo-rich/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
EXP = sys.argv[3] if len(sys.argv) > 3 else "C:/t/done-r2/proj/exports/done-osr.mp4"
SRC = "C:/Users/kyach/akari-wt/onboarding-demo-rich/apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/clip.mp4"
def frames(path, start, count):
    cmd = [FF, "-v", "error", "-i", path, "-vf", f"select='between(n,{start},{start+count-1})',format=rgb24", "-vsync", "0", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, 720, 1280, 3).astype(np.int16)
ex = frames(EXP, 0, 120)
src = frames(SRC, 330, 120)
print(ex.shape, src.shape)
OFF = 330
diff = np.abs(ex - src).mean(axis=3)  # (n,720,1280)
out = {"export": "render-cut --engine osr（隔離プロジェクト C:/t/done-r2/proj。本編 11.0〜15.0 秒を 120 フレームに切り出し、demo-done を at 8 / duration 108 = 本番 at 338 と同じ局所時刻。正解音 at 72 = 本番 402）。edit-lint PASS（0 findings）→ render-cut PASS", "rows": []}
parts = [
  ("lead", "喋ってるだけで（強調テロップ・マイク・波形）", 11.30, (760, 130, 1230, 210)),
  ("head", "編集は", 12.57, (760, 245, 1040, 345)),
  ("stamp", "判子「完了」（終わってる 13.42）", 13.42, (1060, 250, 1205, 350)),
]
for pid, label, onset, (x0, y0, x1, y1) in parts:
    series = [(n + OFF, round(float(diff[n, y0:y1, x0:x1].mean()), 2)) for n in range(120)]
    base = [v for f, v in series if f < 336]
    noise = max(base) if base else 0
    first = None
    for f, v in series:
        if v > max(3.0, noise * 3) and first is None and f >= 336:
            first = f
    out["rows"].append({"part": pid, "label": label, "word_onset_s": onset, "first_visible_frame": first,
                        "first_visible_s": round(first / 30, 4), "delta_s": round(first / 30 - onset, 4),
                        "series_around": [v for f, v in series if first - 3 <= f <= first + 3]})
# last visible
vis = [(n + OFF, float(diff[n, 130:400, 760:1230].mean())) for n in range(120)]
last = max(f for f, v in vis if v > 1.5)
out["last_visible_frame"] = last
out["last_visible_s"] = round(last / 30, 4)
out["item_end_frame"] = 446
# keep-out (person x<690 for y<470, x<815 for 470..660) and caption band x300-980 y>=628
active = range(338 - OFF, 446 - OFF)
d = np.abs(ex - src).max(axis=3)
person = max(int(max(d[n, :470, :690].max(), d[n, 470:660, :815].max())) for n in active)
person_mean = max(float(max(d[n, :470, :690].mean(), d[n, 470:660, :815].mean())) for n in active)
cap = max(int(d[n, 628:, 300:980].max()) for n in active)
pre = max(int(max(d[n, :470, :690].max(), d[n, 470:660, :815].max())) for n in range(0, 8))
out["keepout"] = {"person_max_abs_diff_active": person, "person_max_abs_diff_before_item": pre,
                  "person_mean_abs_diff_active_max": round(person_mean, 3), "caption_band_max_abs_diff_active": cap,
                  "note": "差の最大値は書き出しの圧縮ノイズ水準（区間外 f330〜337 と同程度）なら重なり無し"}
# steady union bbox of change during hold
hold = [n for n in range(413 - OFF, 440 - OFF)]
m = np.zeros((720, 1280), bool)
for n in hold:
    m |= d[n] > 24
ys, xs = np.nonzero(m)
out["steady_union_bbox_x0y0x1y1"] = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
# transient bbox during slam frames 401-412
m2 = np.zeros((720, 1280), bool)
for n in range(401 - OFF, 413 - OFF):
    m2 |= d[n] > 24
ys, xs = np.nonzero(m2)
out["transient_bbox_f401_412"] = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
json.dump(out, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
# save frames for sheet
from PIL import Image
for f in [338, 339, 340, 376, 377, 378, 400, 401, 402, 403, 404, 405, 410, 420, 436, 440, 443, 444, 445]:
    Image.fromarray(ex[f - OFF].astype(np.uint8)).save(sys.argv[2] + f"/exf{f}.png")
print(json.dumps(out, ensure_ascii=False, indent=1))
