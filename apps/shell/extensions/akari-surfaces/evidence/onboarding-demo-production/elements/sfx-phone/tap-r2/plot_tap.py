# 使い方（このフォルダで）: python measure_tap.py measure.json seg.npz → python momentary.py → python plot_tap.py ../sfx-phone-tap-r2.png
# 入力の書き出し（リポの外）: 直す前 = C:/t/integ/{full,sfxonly}/exports、直した後 = C:/t/sfxtap-1001/{full,sfxonly}/exports
# （後は前の edit.json から exports/ の自己参照 source を外し、assets/onboarding/sfx-click-mouse-single.m4a だけ差し替えて render-cut で書き出したもの）
# sfx-phone のタップの差し戻しの直しを 1 枚に描く（Pillow）。入力は書き出しの実測（measure.json / momentary.json）と PCM
import json, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FF = "<WORKTREE>/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
SR = 48000
WT = "<WORKTREE>/apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/"
M = json.load(open("measure.json", encoding="utf-8"))
MO = json.load(open("momentary.json", encoding="utf-8"))
MOK = "tap_momentary_max_lufs(400ms windows inside 27.52-28.40)"


def pcm(p):
    r = subprocess.run([FF, "-v", "error", "-i", p, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                       capture_output=True).stdout
    return np.frombuffer(r, dtype=np.float32).astype(np.float64)


def env5(m):
    n = (len(m) - 240) // 48
    idx = np.arange(n) * 48
    c = np.concatenate([[0], np.cumsum(m ** 2)])
    return 20 * np.log10(np.maximum(np.sqrt((c[idx + 240] - c[idx]) / 240), 1e-9))


v = pcm(WT + "clip.mp4")
bg = pcm(WT + "bgm.m4a")
k = min(len(v), len(bg))
mask = v[:k] + bg[:k] * 10 ** (-14 / 20)
tb = pcm("C:/t/integ/sfxonly/exports/sfxonly.mp4")
ta = pcm("C:/t/sfxtap-1001/sfxonly/exports/sfxonly.mp4")
T0, T1 = 27.55, 28.05


def cut(e):
    return e[int(T0 * 1000):int(T1 * 1000)]


em, eb, ea = cut(env5(mask)), cut(env5(tb)), cut(env5(ta))
t = T0 + np.arange(len(em)) / 1000
INK, SUB, OR, SOFT, LINE, GRAY = (23, 19, 15), (107, 94, 82), (249, 115, 22), (253, 186, 116), (230, 224, 218), (196, 188, 180)
W, H = 1600, 1200
img = Image.new("RGB", (W, H), (255, 255, 255))
d = ImageDraw.Draw(img)


def F(sz, bold=False):
    return ImageFont.truetype("C:/Windows/Fonts/YuGothB.ttc" if bold else "C:/Windows/Fonts/YuGothM.ttc", sz)


b, a = M["before"], M["after"]
d.text((40, 28), "sfx-phone：画面点灯のタップ（「モックアップ」27.77）— 目利きの差し戻しの直し", font=F(30, True), fill=INK)
d.text((40, 76), "書き出しの実測（render-cut・同梱 ffmpeg n8.1.2）。直す前 = 組み込み時の書き出し、直した後 = タップのファイルだけ差し替えた同じプロジェクト。"
       "item（at 833・gain_db −6）は変えていない", font=F(17), fill=SUB)

# ---- Panel A: 5 ms 包絡
ax0, ay0, aw, ah = 90, 160, 960, 500
ymin, ymax = -60, 0


def X(tt):
    return ax0 + (tt - T0) / (T1 - T0) * aw


def Y(db):
    return ay0 + (ymax - float(np.clip(db, ymin, ymax))) / (ymax - ymin) * ah


d.text((ax0 - 70, ay0 - 34), "5 ms 包絡 dBFS（measure_audio.py と同じ：-ac 1・5 ms 窓・1 ms 刻み）", font=F(16), fill=SUB)
d.rectangle([X(27.74), ay0 + 1, X(27.80), ay0 + ah - 1], fill=(255, 244, 232))
d.rectangle([ax0, ay0, ax0 + aw, ay0 + ah], outline=LINE)
for db in range(ymin, ymax + 1, 10):
    d.line([ax0, Y(db), ax0 + aw, Y(db)], fill=LINE)
    d.text((ax0 - 50, Y(db) - 10), f"{db}", font=F(16), fill=SUB)
for tt in np.arange(27.6, 28.05, 0.1):
    d.line([X(tt), ay0 + ah, X(tt), ay0 + ah + 6], fill=SUB)
    d.text((X(tt) - 22, ay0 + ah + 10), f"{tt:.2f}", font=F(16), fill=SUB)
d.text((ax0 + aw - 30, ay0 + ah + 34), "秒", font=F(16), fill=SUB)
d.text((X(27.74) + 4, ay0 + 6), "27.77 ±0.03", font=F(15, True), fill=OR)
pts = [(X(tt), Y(e)) for tt, e in zip(t, em)]
d.polygon([(X(T0), Y(ymin))] + pts + [(X(t[-1]), Y(ymin))], fill=(232, 227, 222))
d.line(pts, fill=GRAY, width=2)
for xx in range(int(ax0), int(ax0 + aw), 14):
    d.line([xx, Y(-18), xx + 7, Y(-18)], fill=OR, width=2)
d.text((ax0 + aw - 150, Y(-18) - 26), "目標 −18 前後", font=F(16, True), fill=OR)


def curve(e, col, w, dash=False):
    p = [(X(tt), Y(val)) for tt, val in zip(t, e) if val > ymin - 5]
    if dash:
        for i in range(0, len(p) - 1, 6):
            d.line(p[i:i + 3], fill=col, width=w)
    else:
        d.line(p, fill=col, width=w)


curve(eb, SOFT, 3, dash=True)
curve(ea, OR, 3)
d.line([X(27.765), ay0, X(27.765), ay0 + ah], fill=INK, width=1)
d.text((X(27.765) - 150, ay0 + ah - 60), "「モ」語頭 27.765\n（m の閉鎖）", font=F(15), fill=INK)
d.text((X(27.905) + 6, Y(-15) - 10), "← 「モ」の母音", font=F(15), fill=SUB)
d.text((X(27.866), Y(-27)), "← 離しの音（0.085 s 後）", font=F(14), fill=OR)
pa_i, pb_i = int(np.argmax(ea)), int(np.argmax(eb))
d.ellipse([X(t[pa_i]) - 5, Y(ea[pa_i]) - 5, X(t[pa_i]) + 5, Y(ea[pa_i]) + 5], fill=OR)
d.ellipse([X(t[pb_i]) - 4, Y(eb[pb_i]) - 4, X(t[pb_i]) + 4, Y(eb[pb_i]) + 4], fill=SOFT)
d.text((X(t[pa_i]) + 12, Y(ea[pa_i]) - 30), f"直した後 {a['peak_5ms_dbfs']:.1f}", font=F(18, True), fill=OR)
d.text((X(t[pb_i]) - 150, Y(eb[pb_i]) - 4), f"直す前 {b['peak_5ms_dbfs']:.1f}", font=F(18, True), fill=(214, 150, 90))
lx, ly = ax0 + 560, ay0 + 330
d.rectangle([lx - 12, ly - 12, ax0 + aw - 8, ly + 80], fill=(255, 255, 255), outline=LINE)
d.rectangle([lx, ly, lx + 26, ly + 14], fill=(232, 227, 222), outline=GRAY)
d.text((lx + 34, ly - 4), "声＋BGM（clip.mp4 ＋ bgm.m4a × −14 dB）", font=F(15), fill=SUB)
d.line([lx, ly + 34, lx + 26, ly + 34], fill=SOFT, width=3)
d.text((lx + 34, ly + 24), "タップ 直す前（書き出しの効果音だけ）", font=F(15), fill=SUB)
d.line([lx, ly + 60, lx + 26, ly + 60], fill=OR, width=3)
d.text((lx + 34, ly + 50), "タップ 直した後（同上）", font=F(15), fill=SUB)

# ---- Panel B: 帯域
bx0, by0, bw, bh = 1140, 160, 420, 500
bands = list(b["band_tap_minus_voice_bgm_db_20ms"]["27.767"].keys())
vb = list(b["band_tap_minus_voice_bgm_db_20ms"]["27.767"].values())
va = list(a["band_tap_minus_voice_bgm_db_20ms"]["27.767"].values())
d.text((bx0 - 40, by0 - 34), "帯域ごとの タップ − 声＋BGM（dB・当たりの 20 ms）", font=F(16), fill=SUB)
lo, hi = -30, 50


def BY(val):
    return by0 + (hi - val) / (hi - lo) * bh


d.rectangle([bx0, by0, bx0 + bw, by0 + bh], outline=LINE)
for vv in range(lo, hi + 1, 10):
    d.line([bx0, BY(vv), bx0 + bw, BY(vv)], fill=SUB if vv == 0 else LINE)
    d.text((bx0 - 42, BY(vv) - 10), f"{vv:+d}" if vv else "0", font=F(15), fill=SUB)
gw = bw / len(bands)
for i, (nm, x1, x2) in enumerate(zip(bands, vb, va)):
    cx = bx0 + gw * i + gw / 2
    d.rectangle([cx - 26, min(BY(0), BY(x1)), cx - 2, max(BY(0), BY(x1))], fill=SOFT)
    d.rectangle([cx + 2, min(BY(0), BY(x2)), cx + 26, max(BY(0), BY(x2))], fill=OR)
    lab = nm.replace("Hz", "").replace("16000", "16k").replace("8000", "8k").replace("4000", "4k").replace("2000", "2k").replace("1000", "1k")
    d.text((cx - 28, by0 + bh + 8), lab, font=F(14), fill=SUB)
d.text((bx0, by0 + bh + 34), "Hz　淡橙 = 直す前・橙 = 直した後", font=F(15), fill=SUB)
d.text((bx0 + 8, BY(-24)), "低域は m の鼻音と BGM の側（タップは 1k 以上）", font=F(14), fill=SUB)

# ---- Panel C: フレームと数値
cy0 = 760
strip = Image.open("C:/t/sfxtap-1001/frames/strip.jpg")
d.text((40, cy0), "書き出し（直した後）の右側 x 720〜1280", font=F(16), fill=SUB)
img.paste(strip, (40, cy0 + 30))
for i, lab in enumerate(["27.667 起動画面", "27.767 点灯 = タップ", "27.800", "27.867"]):
    d.text((40 + 280 * i + 8, cy0 + 30 + 360 + 6), lab, font=F(15, i == 1), fill=OR if i == 1 else SUB)
tx, ty = 1190, cy0
rows = [("", "直す前", "直した後"),
        ("5 ms 包絡の山 dBFS", f"{b['peak_5ms_dbfs']:.1f}", f"{a['peak_5ms_dbfs']:.1f}"),
        ("標本ピーク L / R", f"{b['sample_peak_dbfs_LR'][0]:.1f}/{b['sample_peak_dbfs_LR'][1]:.1f}",
         f"{a['sample_peak_dbfs_LR'][0]:.1f}/{a['sample_peak_dbfs_LR'][1]:.1f}"),
        ("momentary 最大 LUFS", f"{MO['before'][MOK]:.1f}", f"{MO['after'][MOK]:.1f}"),
        ("出（山 −30 dB）秒", f"{b['measured_s']:.3f}", f"{a['measured_s']:.3f}"),
        ("当たり（−20 dB）秒", f"{b['attack_minus20db_s']:.3f}", f"{a['attack_minus20db_s']:.3f}"),
        ("27.77 との差", f"{b['attack_minus_word_ms']:+.1f}ms", f"{a['attack_minus_word_ms']:+.1f}ms"),
        ("ミックスの山 27.7–28.0", f"{b['mix_sample_peak_dbfs_27.70-28.00']:.1f}", f"{a['mix_sample_peak_dbfs_27.70-28.00']:.1f}"),
        ("全体 I LUFS / TP", f"{b['loudness_full_0-37.6']['I_lufs']:.1f}/{b['loudness_full_0-37.6']['true_peak_dbfs']:.1f}",
         f"{a['loudness_full_0-37.6']['I_lufs']:.1f}/{a['loudness_full_0-37.6']['true_peak_dbfs']:.1f}")]
for r, row in enumerate(rows):
    yy = ty + 30 + r * 38
    if r:
        d.line([tx, yy - 6, W - 20, yy - 6], fill=LINE)
    d.text((tx, yy), row[0], font=F(14), fill=SUB)
    d.text((tx + 185, yy), row[1], font=F(15), fill=(170, 120, 70))
    d.text((tx + 290, yy), row[2], font=F(15, True), fill=OR if r else INK)
d.text((tx, ty + 30 + len(rows) * 38 + 4), "スウッシュ（スマホ）は momentary −24.8 のまま。\nタップはその 7 LU 下の「細かい音」に収まる",
       font=F(14), fill=SUB)
img.save(sys.argv[1])
print("saved", sys.argv[1])
