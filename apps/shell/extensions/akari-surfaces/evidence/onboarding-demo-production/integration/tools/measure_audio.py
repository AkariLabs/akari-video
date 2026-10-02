# 音の実測: python measure_audio.py <full.mp4> <novoice.mp4> <sfxonly.mp4> <out.json>
import subprocess, sys, json, re
import numpy as np
FF = "C:/Users/kyach/akari-wt/onboarding-demo-rich/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
BGMFILE = "C:/Users/kyach/akari-wt/onboarding-demo-rich/apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/bgm.m4a"
full, novoice, sfxonly, out = sys.argv[1:5]
SR = 48000
def pcm(path):
    cmd = [FF, "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True).stdout, dtype=np.float32)
sa = pcm(sfxonly); na = pcm(novoice); bg = pcm(BGMFILE)
H = 48  # 1 ms
env = np.array([np.sqrt(np.mean(np.square(sa[i:i + 240]))) for i in range(0, len(sa) - 240, H)])  # 5 ms 窓・1 ms 刻み
env_db = 20 * np.log10(np.maximum(env, 1e-9))
# (id, 語, 語頭, item の at フレーム, 種類 出/山)
SFX = [("title-whoosh", "こんにちは（カードの着地）", 0.49, 0, "山"),
       ("name-pop", "アカリビデオ", 3.59, 107, "出"),
       ("chat-pop-1", "AI", 8.55, 256, "出"),
       ("chat-pop-2", "対話", 9.26, 277, "出"),
       ("done-tone", "終わってる", 13.42, 402, "出"),
       ("kouka-pop", "効果音", 17.50, 524, "出"),
       ("pa-whoosh", "パッ（衝撃）", 19.70, 581, "衝撃"),
       ("hora-sparkle", "ほら", 20.55, 617, "出"),
       ("diagram-pon", "こういう（カード）", 23.27, 697, "出"),
       ("diagram-stack", "図解（積み上げ）", 23.78, 713, "出"),
       ("diagram-playhead", "出せます（再生ヘッド）", 24.37, 727, "山"),
       ("diagram-count", "し（件数）", 24.78, 743, "出"),
       ("phone-swoosh", "スマホ", 27.07, 805, "山"),
       ("phone-tap", "モックアップ", 27.77, 833, "出"),
       ("punchline-ding", "ね（言い切り）", 35.63, 1069, "出")]
res = {"sfx": []}
ATS = sorted(at for _, _, _, at, _ in SFX)
for sid, word, ws, at, kind in SFX:
    a = at / 30
    nxt = [x for x in ATS if x > at]
    i0 = int(max(0, a - 0.02) * 1000); i1 = int(min(a + 0.9, (nxt[0] / 30 - 0.02) if nxt else a + 0.9) * 1000)
    seg = env_db[i0:i1]
    peak = float(np.max(seg))
    if kind == "山":
        t = (i0 + int(np.argmax(seg))) / 1000
    elif kind == "衝撃":
        # 3 ms で +10 dB 以上跳ねる最初の点（whoosh-punchy の当たり）
        j0 = int((a + 0.25) * 1000); sub = env_db[j0:j0 + 200]
        jump = sub[3:] - sub[:-3]
        k = int(np.argmax(jump)); t = (j0 + k + 3) / 1000
    else:
        above = np.where(seg > peak - 30)[0]
        t = (i0 + int(above[0])) / 1000
    res["sfx"].append({"id": sid, "word": word, "word_s": ws, "item_at_s": round(a, 3), "kind": kind,
                       "measured_s": round(t, 3), "delta_s": round(t - ws, 3), "within_0.15": abs(t - ws) <= 0.15,
                       "peak_5ms_dbfs": round(peak, 1)})
def rms_db(x):
    v = float(np.sqrt(np.mean(np.square(x)))) if len(x) else 0
    return round(20 * np.log10(v), 2) if v > 0 else -120.0
W = {"speech 5.2-6.3": (5.2, 6.3), "speech 15.4-16.8": (15.4, 16.8), "speech 33.4-34.7": (33.4, 34.7),
     "gap 1.3-2.3": (1.3, 2.3), "gap 25.1-26.8": (25.1, 26.8), "pause 28.80-29.25": (28.80, 29.25),
     "lifted 30.25-30.63": (30.25, 30.63), "tail 36.2-36.8": (36.2, 36.8)}
res["bgm_applied_gain_db"] = {k: round(rms_db(na[int(s * SR):int(e * SR)]) - rms_db(bg[int(s * SR):int(e * SR)]), 2) for k, (s, e) in W.items()}
def ebur(path, s, d):
    r = subprocess.run([FF, "-hide_banner", "-ss", str(s), "-t", str(d), "-i", path, "-vn", "-af", "ebur128=framelog=quiet", "-f", "null", "-"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.findall(r"I:\s+(-?[0-9.]+) LUFS", r.stderr)
    return float(m[-1]) if m else None
L = {}
for k, (s, e) in {"all 0-37.6": (0, 37.6), "speech 5.2-6.3": (5.2, 6.3), "speech 15.4-16.8": (15.4, 16.8), "speech 33.4-34.7": (33.4, 34.7), "lift 29.6-30.6": (29.6, 30.6)}.items():
    L[k] = {"full": ebur(full, s, e - s), "bgm_sfx_only(novoice)": ebur(novoice, s, e - s)}
    if L[k]["full"] is not None and L[k]["bgm_sfx_only(novoice)"] is not None:
        L[k]["voice_over_bgm_lu"] = round(L[k]["full"] - L[k]["bgm_sfx_only(novoice)"], 1)
res["loudness_lufs"] = L
json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for r in res["sfx"]:
    print(f"{r['id']:16} {r['word']:14} word {r['word_s']:6.2f} at {r['item_at_s']:6.3f} meas {r['measured_s']:7.3f} d {r['delta_s']:+.3f} peak {r['peak_5ms_dbfs']}")
print(json.dumps(res["bgm_applied_gain_db"], ensure_ascii=False))
print(json.dumps(L, ensure_ascii=False))
