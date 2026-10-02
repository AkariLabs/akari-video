# 書き出した mp4 の実測（ラッパー側の道具）
# python measure-export.py <full.mp4> <novoice.mp4> <out.json>
import subprocess, sys, json, re
import numpy as np

FF = "<WORKTREE>/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
SRC = "<WORKTREE>/apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/clip.mp4"
full, novoice, sfxonly, out = sys.argv[1:5]
BGMFILE = "<WORKTREE>/apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/bgm.m4a"
FPS = 30

def gray_frames(path, start, count, box):
    x0, y0, x1, y1 = box
    x1 -= (x1 - x0) % 2; y1 -= (y1 - y0) % 2
    crop = f"{x1-x0}:{y1-y0}:{x0}:{y0}"
    cmd = [FF, "-v", "error", "-i", path, "-vf", f"select='between(n,{start},{start+count-1})',crop={crop},format=gray", "-vsync", "0", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, y1-y0, x1-x0).astype(np.float32)

def rgb_frame(path, n, box=None):
    vf = f"select='eq(n,{n})'"
    if box:
        x0, y0, x1, y1 = box
        x1 -= (x1 - x0) % 2; y1 -= (y1 - y0) % 2
        box = (x0, y0, x1, y1)
        vf += f",crop={x1-x0}:{y1-y0}:{x0}:{y0}"
    cmd = [FF, "-v", "error", "-i", path, "-vf", vf + ",format=rgb24", "-vsync", "0", "-frames:v", "1", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    w, h = (box[2]-box[0], box[3]-box[1]) if box else (1280, 720)
    return np.frombuffer(raw, dtype=np.uint8).reshape(h, w, 3).astype(np.int32)

# 要素の出（語頭の秒・舞台の箱）。構成表 acceptance_measure.sync_table と各要素の座標から
ONSETS = [
    ("title カード", 0.29, "こんにちは", (760, 60, 1220, 236)),
    ("title 名札", 3.59, "アカリビデオ", (760, 250, 1000, 296)),
    ("chat カード", 8.55, "AI", (770, 140, 1210, 410)),
    ("done 1 行目", 11.30, "喋ってる", (800, 165, 1195, 215)),
    ("done 2 行目", 12.57, "編集", (780, 250, 1020, 345)),
    ("done 判子", 13.18, "終わってる", (1060, 235, 1180, 365)),
    ("effects 札 効果音", 17.50, "効果音", (780, 92, 950, 140)),
    ("effects 札 エフェクト", 18.74, "エフェクト", (966, 92, 1180, 140)),
    ("effects パッ！", 19.70, "パッ", (900, 270, 1110, 400)),
    ("flash", 19.70, "パッ", (1180, 560, 1270, 610)),
    ("punch-in（人物側）", 19.70, "パッ", (0, 0, 300, 300)),
    ("diagram カード", 23.27, "こういう", (740, 150, 1230, 200)),
    ("diagram ② AI", 23.58, "図解", (940, 255, 1030, 345)),
    ("diagram ③ 完成", 24.02, "出せます", (1100, 255, 1190, 345)),
    ("phone 本体", 27.07, "スマホ", (894, 440, 1130, 580)),
    ("phone 画面点灯", 27.77, "モックアップ", (930, 200, 1090, 480)),
    ("bgm-chip", 29.45, "BGM", (752, 122, 880, 162)),
    ("credit", 35.63, "ね（言い切り）", (800, 200, 1200, 330)),
]

def onset(path, word_s, box, thr=4.0):
    n0 = int(round(word_s * FPS)) - 12
    e = gray_frames(path, n0, 20, box); s = gray_frames(SRC, n0, 20, box)
    k = min(len(e), len(s))
    d = [float(np.mean(np.abs(e[i] - s[i]))) for i in range(k)]
    # 直前の基準（その箱に別の要素がすでに居る場合）からの変化で判定
    base = d[0]
    for i in range(1, k):
        if abs(d[i] - base) > thr and abs(d[min(i+1, k-1)] - base) > thr:
            return (n0 + i) / FPS, d
    return None, d

res = {"onsets": []}
for name, word_s, word, box in ONSETS:
    t, d = onset(full, word_s, box)
    res["onsets"].append({"element": name, "word": word, "word_s": word_s, "first_visible_s": None if t is None else round(t, 4),
                          "delta_s": None if t is None else round(t - word_s, 3), "within_0.15": None if t is None else abs(t - word_s) <= 0.15})

# パンチイン: 人物の頭の幅の代わりに、左上の棚の箱で元の素材とのずれ（最良のスケール）を測る
def best_scale(n):
    e = rgb_frame(full, n).mean(axis=2)
    s = rgb_frame(SRC, n).mean(axis=2)
    best = None
    for sc in [1.0, 1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07]:
        # 出力中心を基点に拡大した元フレームを最近傍で作る
        h, w = s.shape
        yy, xx = np.mgrid[0:h, 0:w]
        sy = np.clip(((yy - h/2) / sc + h/2).astype(int), 0, h-1)
        sx = np.clip(((xx - w/2) / sc + w/2).astype(int), 0, w-1)
        z = s[sy, sx]
        err = float(np.mean(np.abs(z[20:300, 20:300] - e[20:300, 20:300])))
        if best is None or err < best[1]:
            best = (sc, err)
    return best
res["punch_in"] = {f"{n/FPS:.3f}": best_scale(n) for n in [588, 590, 591, 592, 595, 612, 620, 633, 636]}

# スマホの画面の穴（x 900.1〜1123.8 / y 98.1〜573.8）: 28.5 のフレームで穴の縁の内外を調べる
f = rgb_frame(full, int(28.5 * FPS))
res["phone_screen_28.5"] = {
    "inside_left_col_x902": f[300, 902].tolist(), "inside_right_col_x1121": f[300, 1121].tolist(),
    "inside_top_row_y100": f[100, 1012].tolist(), "inside_bottom_row_y571": f[571, 1012].tolist(),
    "frame_left_x897": f[300, 897].tolist(), "frame_right_x1127": f[300, 1127].tolist(),
    "frame_top_y95": f[95, 1012].tolist(), "frame_bottom_y577": f[577, 1012].tolist(),
}

# カラオケの塗り（字幕の箱の中の橙 / (橙 + 白)）
def karaoke_fill(t):
    img = rgb_frame(full, int(round(t * FPS)), (100, 590, 1180, 680))
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    orange = (r > 200) & (g > 110) & (g < 190) & (b < 120)
    white = (r > 225) & (g > 225) & (b > 225)
    o, w = int(orange.sum()), int(white.sum())
    return {"t": t, "orange_px": o, "white_px": w, "fill": round(o / max(1, o + w), 3)}
res["karaoke"] = [karaoke_fill(t) for t in [30.60, 30.70, 31.00, 31.30, 31.60, 31.90, 32.20, 32.50, 32.55]]

# 音: 声を消した書き出しで効果音の出と BGM の音量
def pcm(path):
    cmd = [FF, "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True).stdout, dtype=np.float32)
a = pcm(novoice)
sa = pcm(sfxonly)
bgf = pcm(BGMFILE)
SR = 48000
def rms_db(x):
    v = float(np.sqrt(np.mean(np.square(x)))) if len(x) else 0
    return round(20 * np.log10(v), 2) if v > 0 else -120.0
win = lambda s, e: a[int(s*SR):int(e*SR)]
env = np.array([np.sqrt(np.mean(np.square(sa[i:i+240]))) for i in range(0, len(sa) - 240, 240)])  # 5 ms（効果音だけの書き出し）
env_db = 20 * np.log10(np.maximum(env, 1e-9))
SFX = [("title-whoosh", 0.0, 0.49, "山"), ("name-pop", 107/30, 0.015, "出"), ("chat-pop-1", 256/30, 0.02, "出"), ("chat-pop-2", 277/30, 0.02, "出"),
       ("done-tone", 395/30, 0.005, "出"), ("kouka-pop", 524/30, 0.025, "出"), ("pa-whoosh", 581/30, 0.33, "山"), ("hora-sparkle", 617/30, 0.005, "出"),
       ("diagram-tick-1", 698/30, 0.005, "出"), ("diagram-tick-2", 707/30, 0.005, "出"), ("diagram-tick-3", 721/30, 0.005, "出"),
       ("phone-swoosh", 805/30, 0.36, "山"), ("phone-tap", 833/30, 0.01, "出"), ("punchline-ding", 1069/30, 0.015, "出")]
sfx_res = []
for name, at, off, kind in SFX:
    i0, i1 = max(0, int((at - 0.05) / 0.005)), int((at + max(0.2, off + 0.25)) / 0.005)
    seg = env_db[i0:i1]
    if kind == "山":
        k = int(np.argmax(seg)); t = (i0 + k) * 0.005
    else:
        above = np.where(seg > -50)[0]
        t = (i0 + int(above[0])) * 0.005 if len(above) else None
    sfx_res.append({"sfx": name, "item_at_s": round(at, 4), "expected_s": round(at + off, 4), "measured_s": None if t is None else round(t, 3),
                    "delta_s": None if t is None else round(t - (at + off), 3), "peak_dbfs": round(float(np.max(seg)), 1)})
res["sfx"] = sfx_res
res["bgm_rms_dbfs"] = {
    "speech 5.2-6.3": rms_db(win(5.2, 6.3)), "speech 15.4-16.8": rms_db(win(15.4, 16.8)), "speech 33.4-34.7": rms_db(win(33.4, 34.7)),
    "gap 1.3-2.3": rms_db(win(1.3, 2.3)), "gap 25.1-26.8": rms_db(win(25.1, 26.8)),
    "pause 28.80-29.25": rms_db(win(28.80, 29.25)), "lifted pause 30.25-30.63": rms_db(win(30.25, 30.63)),
    "tail 36.2-36.8": rms_db(win(36.2, 36.8)),
}
res["bgm_lift_db"] = round(res["bgm_rms_dbfs"]["lifted pause 30.25-30.63"] - res["bgm_rms_dbfs"]["pause 28.80-29.25"], 2)
# 素材の BGM ファイルそのものとの差 = 実際に掛かったゲイン（曲の強弱を打ち消す）
bw = lambda s, e: bgf[int(s*SR):int(e*SR)]
res["bgm_applied_gain_db"] = {k: round(res["bgm_rms_dbfs"][k] - rms_db(bw(*[float(x) for x in k.split(' ')[-1].split('-')])), 2) for k in res["bgm_rms_dbfs"]}

def ebur(path, s, d):
    r = subprocess.run([FF, "-hide_banner", "-ss", str(s), "-t", str(d), "-i", path, "-vn", "-af", "ebur128=framelog=quiet", "-f", "null", "-"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.findall(r"I:\s+(-?[0-9.]+) LUFS", r.stderr)
    return float(m[-1]) if m else None
res["loudness_lufs"] = {
    "full 0-37.6": ebur(full, 0, 37.6), "novoice(BGM+SFX) 0-37.6": ebur(novoice, 0, 37.6),
    "full speech 15.4-16.8": ebur(full, 15.4, 1.4), "novoice speech 15.4-16.8": ebur(novoice, 15.4, 1.4),
    "full speech 5.2-6.3": ebur(full, 5.2, 1.1), "novoice speech 5.2-6.3": ebur(novoice, 5.2, 1.1),
    "novoice gap 25.1-26.8": ebur(novoice, 25.1, 1.7), "novoice lift 29.6-30.6": ebur(novoice, 29.6, 1.0), "full lift 29.6-30.6": ebur(full, 29.6, 1.0), "novoice end 36.0-36.6": ebur(novoice, 36.0, 0.6),
}
json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False, indent=1))
