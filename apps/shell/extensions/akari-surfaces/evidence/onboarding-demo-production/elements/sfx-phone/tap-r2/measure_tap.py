# 使い方（このフォルダで）: python measure_tap.py measure.json seg.npz → python momentary.py → python plot_tap.py ../sfx-phone-tap-r2.png
# 入力の書き出し（リポの外）: 直す前 = C:/t/integ/{full,sfxonly}/exports、直した後 = C:/t/sfxtap-1001/{full,sfxonly}/exports
# （後は前の edit.json から exports/ の自己参照 source を外し、assets/onboarding/sfx-click-mouse-single.m4a だけ差し替えて render-cut で書き出したもの）
# 差し戻し前（C:/t/integ）と後（C:/t/sfxtap-1001）の書き出しで、タップの大きさ・位置・かぶりを実測する
import subprocess, json, re, sys
import numpy as np
FF = "<WORKTREE>/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
SR = 48000
OLD = {"full": "C:/t/integ/full/exports/full.mp4", "sfx": "C:/t/integ/sfxonly/exports/sfxonly.mp4"}
NEW = {"full": "C:/t/sfxtap-1001/full/exports/full.mp4", "sfx": "C:/t/sfxtap-1001/sfxonly/exports/sfxonly.mp4"}
def pcm(p, ch):
    r = subprocess.run([FF, "-v", "error", "-i", p, "-vn", "-ac", str(ch), "-ar", str(SR), "-f", "f32le", "-"], capture_output=True).stdout
    a = np.frombuffer(r, dtype=np.float32).astype(np.float64)
    return a.reshape(-1, ch) if ch > 1 else a
def env5(m):  # measure_audio.py と同じ: 5 ms 窓・1 ms 刻みの RMS（-ac 1）
    n = (len(m) - 240) // 48
    idx = np.arange(n) * 48
    c = np.concatenate([[0], np.cumsum(m ** 2)])
    return np.sqrt((c[idx + 240] - c[idx]) / 240)
def db(x): return 20 * np.log10(np.maximum(x, 1e-9))
AT = 833 / 30; WORD = 27.77; MO = 27.765
def tap_metrics(sfx_m, sfx_st):
    e = db(env5(sfx_m)); i0 = int((AT - 0.02) * 1000); i1 = int((AT + 0.9) * 1000)
    seg = e[i0:i1]; peak = float(seg.max()); first = (i0 + int(np.where(seg > peak - 30)[0][0])) / 1000
    a, b = int(27.70 * SR), int(28.00 * SR)
    st = sfx_st[a:b]; ch_peak = db(np.abs(st).max(0))
    am = np.abs(st).max(1); pk = am.max()
    att = (a + int(np.where(am > pk * 0.1)[0][0])) / SR
    return {"peak_5ms_dbfs": round(peak, 2), "measured_s": round(first, 3), "delta_vs_word_s": round(first - WORD, 3),
            "attack_minus20db_s": round(att, 4), "attack_minus_word_ms": round((att - WORD) * 1000, 1),
            "attack_minus_mo_onset_ms": round((att - MO) * 1000, 1),
            "sample_peak_dbfs_LR": [round(float(x), 2) for x in ch_peak],
            "sample_peak_s": round((a + int(np.argmax(am))) / SR, 4)}
bands = [(250, 500), (500, 1000), (1000, 2000), (2000, 4000), (4000, 8000), (8000, 16000)]
def bandE(x, t, w=0.02):
    i = int(t * SR); n = int(w * SR); seg = x[i:i + n] * np.hanning(n)
    P = np.abs(np.fft.rfft(seg, 4096)) ** 2; f = np.fft.rfftfreq(4096, 1 / SR)
    return [10 * np.log10(P[(f >= lo) & (f < hi)].sum() + 1e-20) for lo, hi in bands]
def ebur(path, s, d):
    r = subprocess.run([FF, "-hide_banner", "-ss", str(s), "-t", str(d), "-i", path, "-vn", "-af", "ebur128=framelog=quiet:peak=true", "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    I = re.findall(r"I:\s+(-?[0-9.]+) LUFS", r.stderr); TP = re.findall(r"Peak:\s+(-?[0-9.]+) dBFS", r.stderr)
    return {"I_lufs": float(I[-1]) if I else None, "true_peak_dbfs": float(TP[-1]) if TP else None}
WT = "<WORKTREE>/apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/"
_v = pcm(WT + "clip.mp4", 1); _bg = pcm(WT + "bgm.m4a", 1); _k = min(len(_v), len(_bg))
MASK = _v[:_k] + _bg[:_k] * 10 ** (-14 / 20)   # 声（clip.mp4・書き出しとずれ 0）＋ BGM（この区間の gain_db -14・keyframe 0）。書き出しの full−sfxonly と -47〜-51 dB で一致し、AAC の符号化雑音を含まない
out = {"what": "phone-tap（画面点灯のタップ）の差し戻しの直し: 書き出しの実測（前 = 組み込み時の C:/t/integ、後 = C:/t/sfxtap-1001。違いはタップのファイルだけ）"}
data = {}
for tag, P in (("before", OLD), ("after", NEW)):
    full_m = pcm(P["full"], 1); sfx_m = pcm(P["sfx"], 1); full_st = pcm(P["full"], 2); sfx_st = pcm(P["sfx"], 2)
    n = min(len(full_m), len(sfx_m)); full_m, sfx_m = full_m[:n], sfx_m[:n]; full_st, sfx_st = full_st[:n], sfx_st[:n]
    data[tag] = (full_m, sfx_m, full_st, sfx_st)
    m = tap_metrics(sfx_m, sfx_st)
    mask = MASK[:len(sfx_m)]
    em = db(env5(mask))
    m["voice_bgm_5ms_dbfs_at_attack_27.767-27.80"] = round(float(em[int(27.767 * 1000):int(27.80 * 1000)].max()), 2)
    m["voice_bgm_5ms_dbfs_27.60-28.00_max"] = round(float(em[27600:28000].max()), 2)
    m["tap_minus_voice_bgm_5ms_db_at_attack"] = round(m["peak_5ms_dbfs"] - m["voice_bgm_5ms_dbfs_at_attack_27.767-27.80"], 1)
    tb = {}
    for t in (27.767, 27.847):
        a = bandE(sfx_m, t); b = bandE(mask, t)
        tb[f"{t:.3f}"] = {f"{lo}-{hi}Hz": round(x - y, 1) for (lo, hi), x, y in zip(bands, a, b)}
    m["band_tap_minus_voice_bgm_db_20ms"] = tb
    a, b = int(27.70 * SR), int(28.00 * SR)
    m["mix_sample_peak_dbfs_27.70-28.00"] = round(float(db(np.abs(full_st[a:b]).max())), 2)
    m["mix_sample_peak_dbfs_whole"] = round(float(db(np.abs(full_st).max())), 2)
    m["loudness_full_0-37.6"] = ebur(P["full"], 0, 37.6)
    m["loudness_full_27.2-28.4"] = ebur(P["full"], 27.2, 1.2)
    out[tag] = m
# 前後の差がタップの区間だけか
fb, sb = data["before"][2], data["before"][3]; fa, sa = data["after"][2], data["after"][3]
n = min(len(fb), len(fa)); d_full = np.abs(fa[:n] - fb[:n]).max(1); d_sfx = np.abs(sa[:n] - sb[:n]).max(1)
w0, w1 = int(27.76 * SR), int(27.95 * SR)
out["ab_diff"] = {
    "full_max_abs_outside_27.76-27.95": float(max(d_full[:w0].max(), d_full[w1:].max())),
    "sfxonly_max_abs_outside_27.76-27.95": float(max(d_sfx[:w0].max(), d_sfx[w1:].max())),
    "full_max_abs_inside": round(float(d_full[w0:w1].max()), 4),
    "diff_nonzero_span_s": [round(float(np.where(d_full > 1e-4)[0][0] / SR), 4), round(float(np.where(d_full > 1e-4)[0][-1] / SR), 4)] if (d_full > 1e-4).any() else None,
    "reading": "外側の差が 0（または AAC の丸め）なら、書き出しで変わったのはタップだけ"}
# 全効果音の並び（後）: measure_audio.py と同じ窓で peak_5ms
SFX = [("title-whoosh", 0), ("name-pop", 107), ("chat-pop-1", 256), ("chat-pop-2", 277), ("done-tone", 402), ("kouka-pop", 524),
       ("pa-whoosh", 581), ("hora-sparkle", 617), ("diagram-tick-1", 698), ("diagram-tick-2", 713), ("diagram-tick-3", 731),
       ("phone-swoosh", 805), ("phone-tap", 833), ("punchline-ding", 1069)]
e = db(env5(data["after"][1]))
out["all_sfx_peak_5ms_dbfs_after"] = {sid: round(float(e[int(max(0, at / 30 - 0.02) * 1000):int((at / 30 + 0.9) * 1000)].max()), 1) for sid, at in SFX}
json.dump(out, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
np.savez_compressed(sys.argv[2], **{f"{k}_{nm}": v for k, (a, b, c, d) in data.items() for nm, v in (("full_m", a[int(27.4*SR):int(28.2*SR)]), ("sfx_m", b[int(27.4*SR):int(28.2*SR)]))})
print(json.dumps(out, ensure_ascii=False, indent=1))
