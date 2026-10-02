import subprocess, numpy as np, sys
FF = "C:/Users/kyach/akari-wt/onboarding-demo-rich/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
def load(p):
    raw = subprocess.run([FF, "-v", "error", "-i", p, "-vf", "scale=320:180,format=gray", "-vsync", "0", "-f", "rawvideo", "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, 180, 320).astype(np.int16)
a, b = load(sys.argv[1]), load(sys.argv[2])
n = min(len(a), len(b)); print("frames", len(a), len(b))
d = np.abs(a[:n] - b[:n]).max(axis=(1, 2))
m = np.abs(a[:n] - b[:n]).mean(axis=(1, 2))
bad = [i for i in range(n) if d[i] > 24]
print("frames with max diff > 24:", len(bad))
runs = []
for i in bad:
    if runs and i == runs[-1][1] + 1: runs[-1][1] = i
    else: runs.append([i, i])
for r in runs: print(f"  {r[0]}-{r[1]} ({r[0]/30:.3f}-{r[1]/30:.3f}s) max={d[r[0]:r[1]+1].max()} mean={m[r[0]:r[1]+1].max():.2f}")
