# 擬音「パッ！」の墨の縁が閃光で飛んでいないかを数える（ラッパー側の道具）
# python measure_ink.py <before.mp4> <after.mp4> <src.mp4> <out.json>
import subprocess, sys, json
import numpy as np
FF = "<WORKTREE>/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
before, after, src, out = sys.argv[1:5]
N0, N1 = 586, 606
def grab(path, n0=N0, n1=N1):
    cmd = [FF, "-v", "error", "-i", path, "-vf", f"select='between(n,{n0},{n1-1})',format=rgb24", "-vsync", "0", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, 720, 1280, 3).astype(np.int16)
B, A, S = grab(before), grab(after), grab(src)
BOX = (780, 220, 1230, 440)   # 擬音「パッ！」＋放射線（1280x720）
x0, y0, x1, y1 = BOX
def ink(f, thr):
    r = f[y0:y1, x0:x1]
    return int(np.sum(r.max(axis=2) < thr))
def luma(f):
    r = f[y0:y1, x0:x1].astype(np.float64)
    return 0.2126 * r[..., 0] + 0.7152 * r[..., 1] + 0.0722 * r[..., 2]
# 閃光の α を右下の壁（擬音・字幕から離れた場所）で逆算: (出力−元)/(光の色−元)
WALL = (1230, 560, 1270, 600)
LIGHT = np.array([255, 250, 235], dtype=np.float64)
def flash_alpha(f, s):
    wx0, wy0, wx1, wy1 = WALL
    o = f[wy0:wy1, wx0:wx1].astype(np.float64).mean(axis=(0, 1))
    b = s[wy0:wy1, wx0:wx1].astype(np.float64).mean(axis=(0, 1))
    return float(np.mean((o - b) / np.maximum(LIGHT - b, 1)))
rows = []
for i in range(len(A)):
    n = N0 + i
    rows.append({
        "frame": n, "t": round(n / 30, 3),
        "ink_px_lt60_before": ink(B[i], 60), "ink_px_lt60_after": ink(A[i], 60),
        "ink_px_lt90_before": ink(B[i], 90), "ink_px_lt90_after": ink(A[i], 90),
        "ink_px_lt60_source": ink(S[i], 60),
        "darkest_luma_before": round(float(np.percentile(luma(B[i]), 0.5)), 1),
        "darkest_luma_after": round(float(np.percentile(luma(A[i]), 0.5)), 1),
        "flash_alpha_wall_before": round(flash_alpha(B[i], S[i]), 3),
        "flash_alpha_wall_after": round(flash_alpha(A[i], S[i]), 3),
    })
json.dump({"box": BOX, "wall_for_flash_alpha": WALL, "rows": rows}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("frame  t      ink<60 before/after  ink<90 before/after  src  p0.5luma b/a   flashα b/a")
for r in rows:
    print(f"{r['frame']}  {r['t']:.3f}  {r['ink_px_lt60_before']:6d} / {r['ink_px_lt60_after']:6d}   {r['ink_px_lt90_before']:6d} / {r['ink_px_lt90_after']:6d}   {r['ink_px_lt60_source']:4d}  {r['darkest_luma_before']:6.1f}/{r['darkest_luma_after']:6.1f}  {r['flash_alpha_wall_before']:.3f}/{r['flash_alpha_wall_after']:.3f}")
