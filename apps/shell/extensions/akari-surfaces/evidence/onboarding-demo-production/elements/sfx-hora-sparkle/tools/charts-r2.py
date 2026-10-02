import subprocess, json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
FF = "C:/Users/kyach/akari-wt/onboarding-demo-rich/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
SR = 48000
OUT = sys.argv[1]
P = {"r1_sfx": "C:/t/integ/sfxonly/exports/sfxonly.mp4", "r2_sfx": "C:/t/hora-r2/sfxonly/exports/sfxonly-2.mp4",
     "r1_full": "C:/t/integ/full/exports/full.mp4", "r2_mix": "C:/t/hora-r2/mix/exports/mix-2.mp4",
     "clip": "C:/Users/kyach/akari-wt/onboarding-demo-rich/apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/clip.mp4"}
M = json.load(open(sys.argv[2], encoding="utf-8"))


def pcm(path):
    raw = subprocess.run([FF, "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


A = {k: pcm(v) for k, v in P.items()}
FB = "C:/Windows/Fonts/YuGothB.ttc"
FM = "C:/Windows/Fonts/YuGothM.ttc"


def F(sz, b=False):
    return ImageFont.truetype(FB if b else FM, sz)


INK = (23, 19, 15); SUB = (107, 94, 82); OR = (249, 115, 22); GR = (160, 152, 144); BG = (250, 248, 244)
DK = (200, 80, 10)
T0, T1 = 20.20, 22.20
W, H = 1800, 1180
X0, X1 = 170, 1760


def tx(t):
    return X0 + (t - T0) / (T1 - T0) * (X1 - X0)


img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
d.text((24, 16), "sfx-hora-sparkle r2 — 「ほら」(20.55) の瞬間にキラッを当て、キラキラの山を 20.55〜20.70 へ寄せる", font=F(30, True), fill=INK)
d.text((24, 60), "実測 = render-cut の書き出し（効果音だけの書き出し。r1 は組み込み時の書き出し、r2 は同じ edit.json で音源だけ差し替え）。edit.json は r1 と同じ: 段 demo-sfx / at 617 f / duration 44 f / gain_db +2 / out 1.45", font=F(17), fill=SUB)
d.text((24, 86), "r2 の中身: sfx-pop-ding の頭 0.2 s（書き出しで標本ピーク −12 dBFS）＋ sfx-shimmer-sparkle の 0.35〜1.80 s（−8 dB・頭 50 ms フェードイン・τ 0.12〜0.30 で尾を +4 dB）", font=F(17), fill=SUB)
for i in range(0, int((T1 - T0) * 30) + 2):
    t = round(T0 * 30) / 30 + i / 30
    if T0 <= t <= T1:
        d.line([(tx(t), 120), (tx(t), 1080)], fill=(232, 228, 220), width=1)
for t in np.arange(20.2, 22.21, 0.2):
    x = tx(t)
    d.line([(x, 1080), (x, 1090)], fill=INK, width=2)
    d.text((x - 22, 1094), f"{t:.1f}s", font=F(18), fill=SUB)
d.rectangle([tx(20.55), 120, tx(20.70), 1080], fill=(253, 236, 214))
d.text((tx(20.55) + 4, 1056), "山の目標 20.55〜20.70", font=F(16, True), fill=OR)


def wave(y, h, x, col, label, sub=None):
    d.text((20, y - 18), label, font=F(20, True), fill=col)
    if sub:
        d.text((20, y + 10), sub, font=F(15), fill=col)
    d.line([(X0, y), (X1, y)], fill=(200, 195, 188), width=1)
    for px in range(X0, X1):
        a = T0 + (px - X0) / (X1 - X0) * (T1 - T0)
        b = T0 + (px + 1 - X0) / (X1 - X0) * (T1 - T0)
        s = x[int(a * SR):int(b * SR)]
        if len(s) == 0:
            continue
        lo, hi = max(-1.0, s.min() * h / 95) , min(1.0, s.max() * h / 95)
        d.line([(px, y - hi * 95), (px, y - lo * 95)], fill=col, width=1)


yv = 230
wave(yv, 95, A["clip"], INK, "声")
for t, l in [(20.552, "ほ"), (20.66, "ら"), (21.10, "こんな"), (21.40, "感じ"), (21.60, "で")]:
    d.text((tx(t) + 2, 132), l, font=F(20, True), fill=INK)
d.line([(tx(20.552), 130), (tx(20.552), 1080)], fill=INK, width=2)
d.text((tx(20.552) - 160, 312), "「ほ」語頭 20.552", font=F(17, True), fill=INK)
r1 = M["r1_sfx"]; r2 = M["r2_sfx"]; sh = M["r2_shimmer_component"]
y1 = 430
wave(y1, 95 * 2, A["r1_sfx"], GR, "r1（差し戻し前）", "書き出し ×2 表示")
x = tx(r1["env50_peak_s"])
d.line([(x, y1 - 80), (x, y1 + 80)], fill=(120, 112, 104), width=3)
d.text((x + 8, y1 - 100), f"山 {r1['env50_peak_s']:.2f}（「ほら」の {r1['env50_peak_s'] - 20.552:.2f} s 後）・5 ms 窓のピーク {r1['peak_5ms_dbfs']} dBFS", font=F(17, True), fill=SUB)
y2 = 640
wave(y2, 95 * 2, A["r2_sfx"], OR, "r2（直し）", "書き出し ×2 表示")
x = tx(r2["onset_5ms_s"])
d.line([(x, y2 - 95), (x, y2 + 95)], fill=OR, width=2)
d.line([(x, y2 - 95), (tx(20.80) - 6, y2 - 95)], fill=OR, width=1)
d.text((tx(20.80), y2 - 106), f"キラッの立ち上がり {r2['onset_5ms_s']:.3f}（語頭 {r2['onset_minus_word_s'] * 1000:+.0f} ms）・5 ms 窓のピーク {r2['peak_5ms_dbfs']} dBFS", font=F(17, True), fill=OR)
x = tx(sh["env50_peak_abs_s"])
d.line([(x, y2 - 70), (x, y2 + 95)], fill=DK, width=3)
d.line([(x, y2 + 95), (tx(20.80) - 6, y2 + 95)], fill=DK, width=1)
d.text((tx(20.80), y2 + 84), f"キラキラの山 {sh['env50_peak_abs_s']:.3f}（f{sh['env50_peak_abs_s'] * 30:.1f}）・合計の標本ピーク {r2['sample_peak_s']:.3f} で {r2['sample_peak_dbfs']} dBFS", font=F(17, True), fill=DK)
ye0, ye1 = 780, 1060
d.text((20, ye0 + 10), "包絡", font=F(20, True), fill=INK)
d.text((20, ye0 + 40), "5 ms 窓 RMS", font=F(15), fill=SUB)
d.text((20, ye0 + 60), "dBFS", font=F(15), fill=SUB)


def ydb(v):
    return ye0 + (-5 - max(-60, min(-5, v))) / 55 * (ye1 - ye0)


for v in (-10, -20, -30, -40, -50, -60):
    d.line([(X0, ydb(v)), (X1, ydb(v))], fill=(225, 220, 212), width=1)
    d.text((X0 - 44, ydb(v) - 10), f"{v}", font=F(15), fill=SUB)


def envline(x, col, width=2, win=0.005):
    n = int(SR * win)
    m = np.convolve(x ** 2, np.ones(n) / n, 'same')
    pts = []
    for px in range(X0, X1, 2):
        t = T0 + (px - X0) / (X1 - X0) * (T1 - T0)
        pts.append((px, ydb(10 * np.log10(m[int(t * SR)] + 1e-20))))
    d.line(pts, fill=col, width=width)


envline(A["clip"], (200, 194, 186), 2)
envline(A["r1_sfx"], GR, 3)
envline(A["r2_sfx"], OR, 3)
d.text((X1 - 330, ye0 + 4), "── 声（参考）", font=F(16, True), fill=(180, 174, 166))
d.text((X1 - 330, ye0 + 24), "── r1 のキラキラ", font=F(16, True), fill=GR)
d.text((X1 - 330, ye0 + 44), "── r2 のキラッ＋キラキラ", font=F(16, True), fill=OR)
d.rectangle([tx(617 / 30), 1112, tx(661 / 30), 1122], outline=OR, width=2)
d.text((tx(661 / 30) - 330, 1128), "item 617–661 f（20.567–22.033）", font=F(15), fill=OR)
for f in range(616, 623):
    x = tx(f / 30)
    d.line([(x, 1112), (x, 1150)], fill=SUB, width=1)
    d.text((x + 2, 1136), f"f{f}", font=F(13), fill=SUB)
img.save(OUT + "/sfx-hora-sparkle-r2-sync.png")


def spectro(x, t0, t1, w, h, fmax=8000):
    n = 1024; hop = 96
    s0 = int(t0 * SR); s1 = int(t1 * SR)
    seg = x[s0 - n // 2:s1 + n // 2]
    win = np.hanning(n)
    cols = [20 * np.log10(np.abs(np.fft.rfft(seg[i:i + n] * win)) + 1e-9) for i in range(0, len(seg) - n, hop)]
    S = np.array(cols).T
    f = np.fft.rfftfreq(n, 1 / SR)
    S = S[f <= fmax]
    S = np.clip((S - (S.max() - 65)) / 65, 0, 1)
    g = Image.fromarray((255 * (1 - S[::-1])).astype(np.uint8)).resize((w, h), Image.BILINEAR)
    return Image.merge("RGB", [g.point(lambda v: int(23 + (250 - 23) * v / 255)),
                               g.point(lambda v: int(19 + (248 - 19) * v / 255)),
                               g.point(lambda v: int(15 + (244 - 15) * v / 255))])


TS0, TS1 = 20.30, 21.40
W2, H2 = 1800, 1010
im2 = Image.new("RGB", (W2, H2), BG)
d2 = ImageDraw.Draw(im2)
d2.text((24, 16), "sfx-hora-sparkle — 声＋BGM＋効果音の書き出しのスペクトログラム（0〜8 kHz・65 dB 幅・20.30〜21.40 s）", font=F(28, True), fill=INK)
d2.text((24, 52), "上 r1（組み込み時の書き出し）/ 下 r2（同じ edit.json で音源だけ差し替えて render-cut）", font=F(17), fill=SUB)
d2.text((24, 74), "r2: キラッ = 2.1 kHz → 2.66 kHz の 2 音の頭が「ほ」に当たる。キラキラ = 2〜3 kHz の上昇音列と 4 kHz 以上の粒。r1: 同じ上昇音列が 20.6〜21.0 にかけて遅れて膨らむ", font=F(17), fill=SUB)
SX0, SX1 = 150, 1760


def stx(t):
    return SX0 + (t - TS0) / (TS1 - TS0) * (SX1 - SX0)


for idx, (k, lab) in enumerate([("r1_full", "r1"), ("r2_mix", "r2")]):
    top = 110 + idx * 440; hh = 372
    im2.paste(spectro(A[k], TS0, TS1, SX1 - SX0, hh), (SX0, top))
    d2.text((20, top + hh // 2 - 14), lab, font=F(30, True), fill=OR if lab == "r2" else GR)
    for fr in (1000, 2000, 3000, 4000, 6000, 8000):
        y = top + hh - (fr / 8000) * hh
        d2.line([(SX0 - 8, y), (SX0, y)], fill=INK, width=2)
        d2.text((SX0 - 72, y - 10), f"{fr / 1000:g} kHz", font=F(15), fill=SUB)
    marks = [(20.552, (60, 140, 230))]
    if lab == "r1":
        marks.append((r1["env50_peak_s"], (120, 112, 104)))
    else:
        marks += [(r2["onset_5ms_s"], OR), (sh["env50_peak_abs_s"], DK)]
    for t, col in marks:
        x = stx(t)
        d2.line([(x, top - 4), (x, top + 12)], fill=col, width=3)
        d2.line([(x, top + hh - 12), (x, top + hh + 4)], fill=col, width=3)
    d2.text((stx(20.552) - 118, top + hh + 6), "「ほ」20.552", font=F(16, True), fill=(60, 140, 230))
    if lab == "r1":
        d2.text((stx(r1["env50_peak_s"]) + 6, top + hh + 6), f"r1 の山 {r1['env50_peak_s']:.2f}", font=F(16, True), fill=(90, 84, 78))
    else:
        d2.text((stx(r2["onset_5ms_s"]) + 6, top + hh + 6), f"キラッ {r2['onset_5ms_s']:.3f}", font=F(16, True), fill=OR)
        d2.text((stx(sh["env50_peak_abs_s"]) + 6, top + hh + 26), f"キラキラの山 {sh['env50_peak_abs_s']:.3f}", font=F(16, True), fill=DK)
for t in np.arange(20.4, 21.41, 0.2):
    x = stx(t)
    d2.line([(x, 962), (x, 970)], fill=INK, width=2)
    d2.text((x - 22, 972), f"{t:.1f}s", font=F(18), fill=SUB)
im2.save(OUT + "/sfx-hora-sparkle-r2-spectrogram.jpg", quality=90)
print("ok")
