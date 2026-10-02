# 検証用（ラッパー所掌）: 前段（OSR）と今回（GPU）の書き出しを全フレーム比較し、目に見える変化（16px ブロックの平均差 > 24）の場所と時刻を出す
import subprocess, json
import numpy as np
FF = "C:/Users/kyach/akari-wt/onboarding-demo-rich/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
W, H = 1280, 720
def frames(path):
    p = subprocess.Popen([FF, '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    while True:
        b = p.stdout.read(W * H * 3)
        if len(b) < W * H * 3: break
        yield np.frombuffer(b, np.uint8).reshape(H, W, 3).astype(np.int16)
A = frames('C:/t/odt-1001/full/exports/full.mp4'); B = frames('C:/t/odg-1002/full/exports/full.mp4')
rows = []
for n, (a, b) in enumerate(zip(A, B)):
    d = np.abs(a - b).mean(2)
    blocks = d.reshape(H // 16, 16, W // 16, 16).mean((1, 3))
    hot = np.argwhere(blocks > 24)
    rows.append({'n': n, 't': round(n / 30, 3), 'mad': round(float(d.mean()), 3), 'hot': int(len(hot)),
                 'bbox': None if len(hot) == 0 else [int(hot[:, 1].min() * 16), int(hot[:, 0].min() * 16), int(hot[:, 1].max() * 16 + 16), int(hot[:, 0].max() * 16 + 16)]})
json.dump(rows, open('C:/t/odg-1002/k/fdiff.json', 'w'), indent=0)
print('frames', len(rows))
hotrows = [r for r in rows if r['hot']]
print('frames with visible change:', len(hotrows))
outside = [r for r in hotrows if not (30.6 <= r['t'] <= 32.6)]
print('outside karaoke 30.6-32.6:', len(outside))
for r in outside[:40]: print('  ', r)
inside = [r for r in hotrows if (30.6 <= r['t'] <= 32.6)]
print('inside bbox union:', [min(r['bbox'][0] for r in inside), min(r['bbox'][1] for r in inside), max(r['bbox'][2] for r in inside), max(r['bbox'][3] for r in inside)] if inside else None)
mads = [r['mad'] for r in rows]
print('mad p50/p95/max', np.percentile(mads, 50), np.percentile(mads, 95), max(mads))
