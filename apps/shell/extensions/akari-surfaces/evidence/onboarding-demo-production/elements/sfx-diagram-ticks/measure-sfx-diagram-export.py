"""書き出し（render-cut OSR）の音で、図解の効果音 4 本を実測する。
python measure_export.py <proj-root> <out.json>
  <proj-root>/{mix,novoice,sfxonly,base}/exports/*.mp4 を読む（mix = 声＋BGM＋効果音、novoice = 声を消した残り、
  sfxonly = 効果音だけ、base = 新しい 4 本を抜いた 声＋BGM＋ほかの効果音）
定義は組み込みの measure_audio.py と同じ（モノラル化・5 ms 窓の RMS を 1 ms 刻み。出 = 窓の中で山 −30 dB を最初に越える窓の開始、
山 = 5 ms RMS が最大の窓の開始）。"""
import glob, json, subprocess, sys
import numpy as np

FF = "<WORKTREE>/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
SR = 48000
root, out = sys.argv[1], sys.argv[2]


def pcm(path, ch=1):
    raw = subprocess.run([FF, "-v", "error", "-i", path, "-vn", "-ac", str(ch), "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    a = np.frombuffer(raw, dtype="<f4").astype(np.float64)
    return a if ch == 1 else a.reshape(-1, ch)


def mp4(kind):
    return sorted(glob.glob(f"{root}/{kind}/exports/*.mp4"))[-1]


def env5(x):
    c = np.concatenate([[0], np.cumsum(x ** 2)])
    idx = np.arange(0, len(x) - 240, 48)
    return 20 * np.log10(np.maximum(np.sqrt((c[idx + 240] - c[idx]) / 240), 1e-9))


sfx = pcm(mp4("sfxonly"))
nov = pcm(mp4("novoice"))
mix = pcm(mp4("mix"))
base = pcm(mp4("base"))
mix2 = pcm(mp4("mix"), 2)
es, en, em, eb = env5(sfx), env5(nov), env5(mix), env5(base)

ROWS = [  # id, 語, 語頭, at, 種類, 狙い
    ("diagram-pon", "こういう（カード）", 23.27, 697, "出", 23.256),
    ("diagram-stack", "図解（積み上げ・1 打目）", 23.78, 713, "出", 23.774),
    ("diagram-playhead", "出せます（再生ヘッド）", 24.37, 727, "山", 24.370),
    ("diagram-count", "し（件数）", 24.78, 743, "出", 24.775),
]
res = {"files": {k: mp4(k) for k in ("mix", "novoice", "sfxonly", "base")}, "rows": []}
for sid, word, ws, at, kind, target in ROWS:
    a = at / 30
    i0 = int(max(0, a - 0.02) * 1000)
    i1 = int((a + 0.9) * 1000) if sid != "diagram-pon" else int((a + 0.47) * 1000)
    if sid == "diagram-stack":
        i1 = int((a + 0.2) * 1000)
    if sid == "diagram-playhead":
        i1 = int((a + 0.30) * 1000)
    seg = es[i0:i1]
    peak = float(seg.max())
    if kind == "山":
        t = (i0 + int(np.argmax(seg))) / 1000
    else:
        t = (i0 + int(np.where(seg > peak - 30)[0][0])) / 1000
    row = {"id": sid, "word": word, "word_s": ws, "item_at": at, "item_at_s": round(a, 3), "kind": kind, "target_s": target,
           "measured_s": round(t, 3), "delta_vs_word_s": round(t - ws, 3), "delta_vs_target_ms": round((t - target) * 1000, 1),
           "within_0.03_of_word": abs(t - ws) <= 0.03, "peak_5ms_dbfs": round(peak, 1),
           "within_-16_-14": -16.0 <= peak <= -14.0}
    # 積み上げの 3 打: 1 打目の出から 40 ms ごとの窓で山と出
    if sid == "diagram-stack":
        hits = []
        for k in range(3):
            c = t + 0.040 * k
            j0, j1 = int((c - 0.012) * 1000), int((c + 0.030) * 1000)
            sg = es[j0:j1]
            pk = float(sg.max())
            # 出 = 窓の中で、その打の山 −30 dB を最初に越える窓の開始（上と同じ定義）。2・3 打目は前の打の尾（山 −30 dB 未満）から探す
            k0 = int(np.argmax(sg < pk - 30)) if k else 0
            on = (j0 + k0 + int(np.argmax(sg[k0:] > pk - 30))) / 1000
            hits.append({"hit": k + 1, "onset_s": round(on, 3), "peak_5ms_dbfs": round(pk, 1)})
        row["hits"] = hits
        row["spacing_ms"] = [round((hits[k + 1]["onset_s"] - hits[k]["onset_s"]) * 1000) for k in range(2)]
    # BGM の床（声を消した残りで、効果音の直前 150〜10 ms）と、効果音の山（同じ残りの中）
    f0, f1 = int((t - 0.150) * 1000), int((t - 0.010) * 1000)
    floor = float(np.median(en[f0:f1]))
    pk_nov = float(en[i0:i1].max())
    row["novoice"] = {"bgm_floor_median_5ms_dbfs": round(floor, 1), "peak_5ms_dbfs": round(pk_nov, 1), "above_bgm_floor_db": round(pk_nov - floor, 1)}
    # 声（本編）: 同じ瞬間の声（新しい 4 本を抜いた base = 声＋BGM＋ほかの効果音）と、この句の声の山
    k0, k1 = int((t - 0.01) * 1000), int((t + 0.05) * 1000)
    row["voice_bgm_at_moment_5ms_max_dbfs"] = round(float(eb[k0:k1].max()), 1)
    row["phrase_voice_peak_5ms_dbfs"] = round(float(eb[int(23.2 * 1000):int(25.0 * 1000)].max()), 1)
    row["below_phrase_voice_peak"] = peak < row["phrase_voice_peak_5ms_dbfs"]
    # 最終ミックスのサンプルピーク（クリップしていないか）
    m0, m1 = int((t - 0.02) * SR), int((t + 0.3) * SR)
    row["mix_sample_peak_dbfs"] = round(float(20 * np.log10(np.abs(mix2[m0:m1]).max())), 2)
    res["rows"].append(row)

# 聞こえ方: 効果音（sfxonly）と 声＋BGM（base から新しい 4 本は元々無い）の 1/3 オクターブ帯の比
THIRD = [100 * 2 ** (k / 3) for k in range(22)]


def bands(x):
    n = max(len(x), 4096)
    sp = np.abs(np.fft.rfft(x * np.hanning(len(x)), n=n)) ** 2
    f = np.fft.rfftfreq(n, 1 / SR)
    return np.array([sp[(f >= fc / 2 ** (1 / 6)) & (f < fc * 2 ** (1 / 6))].sum() + 1e-20 for fc in THIRD])


EV = [("pon", 23.256, 0.002, 0.030), ("stack-1", 23.774, 0.002, 0.018), ("stack-2", 23.814, 0.002, 0.018),
      ("stack-3", 23.854, 0.002, 0.018), ("playhead", 24.370, 0.040, 0.040), ("count", 24.775, 0.002, 0.060)]
aud = {}
for name, t, pre, post in EV:
    i0, i1 = int((t - pre) * SR), int((t + post) * SR)
    s, b = sfx[i0:i1], base[i0:i1]
    snr = 10 * np.log10(bands(s) / bands(b))
    aud[name] = {"window_s": [round(t - pre, 3), round(t + post, 3)],
                 "broadband_db": round(float(10 * np.log10(np.sum(s ** 2) / np.sum(b ** 2))), 1),
                 "max_third_octave_db": round(float(snr.max()), 1), "at_hz": round(THIRD[int(np.argmax(snr))]),
                 "bands_above_0db": [round(THIRD[k]) for k in np.where(snr > 0)[0]],
                 "bands_above_6db": int((snr > 6).sum())}
res["audibility_vs_voice_bgm"] = aud

# 置き位置: 書き出しの効果音だけの音に、同梱ファイル × gain −3 dB を相互相関で当てる
place = []
for name, at in (("pon", 697), ("stack", 713), ("playhead", 727), ("count", 743)):
    f = pcm(f"{root}/sfxonly/assets/onboarding/sfx-diagram-{name}.m4a") * 10 ** (-3 / 20)
    a0 = int(round(at / 30 * 1000)) * 48
    lo, hi = a0 - 480, a0 + 480 + len(f)
    seg = sfx[lo:hi]
    c = np.correlate(seg, f, mode="valid")
    k = int(np.argmax(c))
    start = (lo + k) / SR
    cc = float(c[k] / np.sqrt(np.sum(f ** 2) * np.sum(seg[k:k + len(f)] ** 2)))
    place.append({"item": f"demo-sfx-diagram-{name}", "at": at, "planned_start_s": round(at / 30, 4),
                  "adelay_s": round(a0 / SR, 3), "measured_start_s": round(start, 4),
                  "err_vs_adelay_samples": lo + k - a0, "corr": round(cc, 3)})
res["placement"] = place

# 語頭の周りのほかの効果音と重ならないこと（段 demo-sfx の前後）
json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for r in res["rows"]:
    print(f"{r['id']:17} word {r['word_s']:.2f} at {r['item_at_s']:.3f} meas {r['measured_s']:.3f} dW {r['delta_vs_word_s']:+.3f} dT {r['delta_vs_target_ms']:+.1f}ms peak {r['peak_5ms_dbfs']} "
          f"| nov floor {r['novoice']['bgm_floor_median_5ms_dbfs']} +{r['novoice']['above_bgm_floor_db']} | voice@ {r['voice_bgm_at_moment_5ms_max_dbfs']} phrase {r['phrase_voice_peak_5ms_dbfs']} | mixpk {r['mix_sample_peak_dbfs']}")
    if "hits" in r:
        print("   hits", r["hits"], "spacing", r["spacing_ms"])
for k, v in aud.items():
    print(f"  {k:9} broad {v['broadband_db']:6} max {v['max_third_octave_db']:5}@{v['at_hz']} >6dB bands {v['bands_above_6db']}")
for p in place:
    print("  place", p)
