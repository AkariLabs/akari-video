# 組み込みの実測（ラッパー側の道具）: python measure.py <full.mp4> <out.json>
# 各要素について、出力と元素材（または出力自身の直前フレーム）の差が箱の中で立ち上がる最初のフレームを探す
import subprocess, sys, json
import numpy as np

FF = "C:/Users/kyach/akari-wt/onboarding-demo-rich/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
SRC = "C:/Users/kyach/akari-wt/onboarding-demo-rich/apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/clip.mp4"
FPS = 30
full, out = sys.argv[1], sys.argv[2]

_cache = {}
def frames(path, start, count):
    key = (path, start, count)
    if key not in _cache:
        cmd = [FF, "-v", "error", "-i", path, "-vf", f"select='between(n,{start},{start+count-1})',format=rgb24", "-vsync", "0", "-f", "rawvideo", "-"]
        raw = subprocess.run(cmd, capture_output=True).stdout
        _cache[key] = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 720, 1280, 3).astype(np.int16)
    return _cache[key]

# (id, 要素, 語, 語頭秒, 箱 x0,y0,x1,y1, 方式, 窓の開始（語頭からのフレーム）)
# 方式 src: 元素材との差 / self: 窓の最初のフレームとの差 / orange / dark: 色の画素数
EL = [
    ("title-card", "タイトルのカード", "こんにちは", 0.29, (770, 70, 1210, 230), "src", -8),
    ("title-badge", "タイトルの名札 ✦ AKARI Video", "アカリビデオ", 3.59, (760, 250, 1000, 296), "src", -12),
    ("chat-card", "AI との対話カード", "AI", 8.55, (770, 140, 1210, 410), "src", -12),
    ("chat-typing", "AI の行（入力中）", "対話", 9.26, (780, 250, 1200, 330), "self", -12),
    ("chat-reply", "返事「できました！」", "だけ", 9.90, (780, 250, 1200, 330), "self", -8),
    ("done-lead", "テロップ「喋ってるだけで」", "喋ってる", 11.30, (840, 170, 1190, 210), "src", -8),
    ("done-head", "テロップ「編集は」", "編集", 12.57, (780, 250, 1020, 345), "src", -12),
    ("done-stamp", "判子「完了」", "終わってる", 13.42, (1060, 235, 1180, 365), "src", -12),
    ("effects-chip-sfx", "札「♪ 効果音」", "効果音", 17.50, (780, 92, 950, 140), "src", -12),
    ("effects-chip-fx", "札「✦ エフェクト」", "エフェクト", 18.74, (966, 92, 1180, 140), "src", -12),
    ("effects-pa", "擬音「パッ!」", "パッ", 19.70, (900, 270, 1110, 400), "src", -12),
    ("flash", "閃光", "パッ", 19.70, (1180, 560, 1270, 610), "src", -12),
    ("punch-in", "パンチイン（人物側 1.06 倍）", "パッ", 19.70, (20, 20, 300, 300), "src", -12),
    ("effects-kira", "キラッ（1 個目）", "ほら", 20.55, (825, 220, 880, 275), "src", -8),
    ("diagram-card", "図解カード＋① 話す", "こういう", 23.27, (740, 150, 1230, 200), "src", -12),
    ("diagram-ai", "図解 ② AI が編集", "図解", 23.78, (938, 254, 1032, 346), "orange", -12),
    ("diagram-done", "図解 ③ 完成！", "出せます", 24.37, (1098, 254, 1190, 346), "dark", -12),
    ("diagram-finish", "図解 完成の塗り（橙）", "し", 24.78, (1098, 254, 1190, 346), "orange", -10),
    ("phone-body", "スマホ本体", "スマホ", 27.07, (894, 440, 1130, 580), "src", -12),
    ("phone-screen", "スマホ画面点灯（この動画）", "モックアップ", 27.77, (930, 200, 1090, 480), "lum", -6),
    ("bgm-chip", "BGM の札", "BGM", 29.45, (752, 122, 880, 162), "src", -12),
    ("karaoke", "カラオケ字幕の塗り始め", "字幕の", 30.63, (100, 590, 1180, 680), "karaoke", -4),
    ("credit", "クレジット「出演 僕／編集 AI」", "ね（言い切り）", 35.63, (800, 150, 1235, 330), "src", -12),
]

def detect(eid, word_s, box, how, off):
    x0, y0, x1, y1 = box
    n_word = int(round(word_s * FPS))
    n0 = n_word + off
    cnt = 26
    e = frames(full, n0, cnt)[:, y0:y1, x0:x1]
    if how == "src":
        s = frames(SRC, n0, cnt)[:, y0:y1, x0:x1]
        d = [float(np.mean(np.abs(e[i] - s[i]))) for i in range(min(len(e), len(s)))]
        base = d[0]; thr = 3.0
        series = [round(x - base, 2) for x in d]
    elif how == "self":
        d = [float(np.mean(np.abs(e[i] - e[0]))) for i in range(len(e))]
        base = 0; thr = 3.0; series = [round(x, 2) for x in d]
    elif how in ("orange", "dark"):
        if how == "orange":
            m = [int(((f[..., 0] > 220) & (f[..., 1] > 80) & (f[..., 1] < 170) & (f[..., 2] < 90)).sum()) for f in e]
        else:
            m = [int(((f[..., 0] < 60) & (f[..., 1] < 60) & (f[..., 2] < 60)).sum()) for f in e]
        base = m[0]; thr = 40; series = [x - base for x in m]
    elif how == "lum":
        m = [float(f.mean()) for f in e]
        base = m[0]; thr = 15; series = [round(x - base, 1) for x in m]
        for i in range(1, len(series)):
            if series[i] - series[i - 1] > thr:
                return (n0 + i) / FPS, n0, series
        return None, n0, series
    elif how == "karaoke":
        r, g, b = e[..., 0], e[..., 1], e[..., 2]
        m = [int(((f[..., 0] > 200) & (f[..., 1] > 110) & (f[..., 1] < 190) & (f[..., 2] < 120)).sum()) for f in e]
        base = m[0]; thr = 150; series = [x - base for x in m]
    for i in range(1, len(series) - 1):
        if abs(series[i]) > thr and abs(series[i + 1]) > thr:
            return (n0 + i) / FPS, n0, series
    return None, n0, series

res = []
for eid, name, word, ws, box, how, off in EL:
    t, n0, series = detect(eid, ws, box, how, off)
    res.append({"id": eid, "element": name, "word": word, "word_s": ws,
                "first_visible_frame": None if t is None else int(round(t * FPS)),
                "first_visible_s": None if t is None else round(t, 3),
                "delta_s": None if t is None else round(t - ws, 3),
                "within_0.15": None if t is None else abs(t - ws) <= 0.15,
                "method": how, "window_first_frame": n0, "series": series})
json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for r in res:
    print(f"{r['id']:18} {r['word']:10} {r['word_s']:6.2f}  first {r['first_visible_s']}  d {r['delta_s']}  ok {r['within_0.15']}")
