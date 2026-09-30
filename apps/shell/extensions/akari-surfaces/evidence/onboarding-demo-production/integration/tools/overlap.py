# 重なりの実測: python overlap.py <full.mp4> <nooverlay.mp4> <src.mp4> <out.json>
# overlay の画素 = full と nooverlay（本編＋字幕＋パンチインだけ）の差 > 24
# 字幕の画素   = nooverlay と元素材の差 > 24（パンチイン中は除く）
import subprocess, sys, json
import numpy as np
FF = "C:/Users/kyach/akari-wt/onboarding-demo-rich/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
full, noov, src, out = sys.argv[1:5]
W, H = 640, 360  # 半分に縮めて全フレームを流す（座標は ×2）
def reader(path):
    p = subprocess.Popen([FF, "-v", "error", "-i", path, "-vf", f"scale={W}:{H}:flags=area,format=rgb24", "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    n = W * H * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n: break
        yield np.frombuffer(b, np.uint8).reshape(H, W, 3).astype(np.int16)
def erode(m):
    # 3x3 の収縮（孤立した圧縮ノイズの画素を落とし、塊だけ残す）
    r = m.copy()
    r[1:, :] &= m[:-1, :]; r[:-1, :] &= m[1:, :]; r[:, 1:] &= m[:, :-1]; r[:, :-1] &= m[:, 1:]
    return r
PERSON_X = int(0.55 * W)  # x < 55%
EXEMPT = set(range(588, 645))  # 閃光（590-601）・パンチイン（r2: 590-642）は全画面の例外
person_hits = []; cap_hits = []; frames = 0
for n, (a, b, c) in enumerate(zip(reader(full), reader(noov), reader(src))):
    frames += 1
    ov = erode(np.max(np.abs(a - b), axis=2) > 24)
    cap = erode(np.max(np.abs(b - c), axis=2) > 24)
    if n in EXEMPT:
        continue
    pk = int(ov[:, :PERSON_X].sum())
    if pk > 4: person_hits.append((n, pk))
    both = int((ov & cap).sum())
    if both > 4: cap_hits.append((n, both))
res = {"frames": frames, "scale": "640x360（座標は 1/2）", "person_region": "x < 55%（704px）",
       "method": "差 > 24 の画素を 3x3 で収縮してから数える（圧縮ノイズの孤立画素を除く）", "exempt_frames": "588-644（閃光・パンチインは全画面の例外）",
       "overlay_pixels_in_person_region": {"frames_with_hits": len(person_hits), "worst": sorted(person_hits, key=lambda x: -x[1])[:10]},
       "overlay_pixels_on_caption_pixels": {"frames_with_hits": len(cap_hits), "worst": sorted(cap_hits, key=lambda x: -x[1])[:10]}}
json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False))
