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
    # r2（2026-10-01 目利きの差し戻しの直し）: done は 1 行目 56px＋マイク＋波形、判子は中心 (1132,300)・直径 176
    ("done-lead", "強調テロップ「喋ってるだけで」＋マイク＋波形", "喋ってる", 11.30, (770, 135, 1225, 205), "src", -8),
    ("done-head", "テロップ「編集は」", "編集", 12.57, (770, 250, 1020, 345), "src", -12),
    ("done-stamp", "判子「完了」", "終わってる", 13.42, (1075, 255, 1190, 345), "src", -12),
    # r2: 札は高さ 64・32px、擬音は閃光より上、ほらは放射＋紙吹雪、こんな感じでに ✓
    ("effects-chip-sfx", "札「♪ 効果音」＋音の輪", "効果音", 17.50, (740, 88, 940, 160), "src", -12),
    ("effects-chip-fx", "札「✦ エフェクト」＋軌跡のキラッ", "エフェクト", 18.74, (940, 40, 1210, 160), "src", -12),
    ("effects-pa", "擬音「パッ!」", "パッ", 19.70, (820, 230, 1200, 440), "src", -12),
    ("flash", "閃光（擬音より下の段）", "パッ", 19.70, (1180, 560, 1270, 610), "src", -12),
    ("punch-in", "パンチイン（人物側 1.10 倍＋揺れ）", "パッ", 19.70, (20, 20, 300, 300), "src", -12),
    ("effects-hora", "ほら: 擬音の跳ね＋キラッ放射＋紙吹雪", "ほら", 20.55, (760, 160, 1240, 600), "src", -8),
    ("effects-check", "こんな感じで: ✓ バッジ", "こんな感じで", 21.10, (905, 72, 960, 118), "src", -6),
    # r2: 図解は「この動画の中身」のタイムライン（x 724〜1240・y 112〜452）
    ("diagram-card", "図解カード＋段のラベル", "こういう", 23.27, (724, 112, 1240, 452), "src", -12),
    ("diagram-build", "図解 ブロックの積み上げ", "図解", 23.78, (832, 170, 1215, 400), "self", -5, 0.2),
    ("diagram-playhead", "図解 再生ヘッド（0 秒から走る）", "出せます", 24.37, (826, 165, 838, 405), "dark", -5),
    ("diagram-count", "図解 件数「テロップ 7・効果音 15・BGM 1・字幕 22」", "し", 24.78, (740, 402, 1235, 446), "orange", -10, 15),
    ("phone-body", "スマホ本体", "スマホ", 27.07, (894, 500, 1130, 580), "src", -12),  # r2: 上端は図解カードの抜け（y≤487）と重ならない高さに
    ("phone-screen", "スマホ画面点灯（この動画）", "モックアップ", 27.77, (930, 200, 1090, 480), "lum", -6),
    ("bgm-chip", "BGM の札", "BGM", 29.45, (752, 122, 880, 162), "src", -12),
    ("karaoke", "カラオケ字幕の塗り始め", "字幕の", 30.63, (100, 590, 1180, 680), "karaoke", -4),
    ("credit", "クレジット「出演 僕／編集 AI」", "ね（言い切り）", 35.63, (800, 150, 1235, 330), "src", -12),
]

def detect(eid, word_s, box, how, off, thr_override=None):
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
    if thr_override is not None:
        thr = thr_override
    for i in range(1, len(series) - 1):
        if abs(series[i]) > thr and abs(series[i + 1]) > thr:
            return (n0 + i) / FPS, n0, series
    return None, n0, series

res = []
for eid, name, word, ws, box, how, off, *rest in EL:
    t, n0, series = detect(eid, ws, box, how, off, rest[0] if rest else None)
    res.append({"id": eid, "element": name, "word": word, "word_s": ws,
                "first_visible_frame": None if t is None else int(round(t * FPS)),
                "first_visible_s": None if t is None else round(t, 3),
                "delta_s": None if t is None else round(t - ws, 3),
                "within_0.15": None if t is None else abs(t - ws) <= 0.15,
                "method": how, "window_first_frame": n0, "series": series})
json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for r in res:
    print(f"{r['id']:18} {r['word']:10} {r['word_s']:6.2f}  first {r['first_visible_s']}  d {r['delta_s']}  ok {r['within_0.15']}")
