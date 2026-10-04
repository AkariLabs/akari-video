"""図解（demo-diagram）の効果音 4 本を作る（再現用）。目利きの差し戻し 2026-10-01 の直し。

使い方:
  python make-sfx-diagram.py <ffmpeg> <akari-sounds-sfx の mp3 があるフォルダ> <出力フォルダ> [--clicks knock|tick|layer] [--wav]

図解の 4 拍に 1 本ずつ当てる（語頭は transcript.json の声で合わせ直した時刻）:
  23.27「こういう」 カード     = 柔らかいポン     sfx-diagram-pon.m4a       ← sfx-blip-marimba の 3 打目（A4 のマリンバ。BGM の A マイナーの主音）
  23.78「図解」     積み上げ   = 軽いクリック 3 連 sfx-diagram-stack.m4a     ← sfx-click-soft-ui の打音（40 ms 間隔・+0/+2/+4 半音で上がる）
  24.37「出せます」 再生ヘッド = 短い whoosh の山  sfx-diagram-playhead.m4a  ← sfx-whoosh-paper の山（紙のめくれの 2 つ目の山は切る）
  24.78「し」       件数       = 小さな ding       sfx-diagram-count.m4a     ← sfx-pop-ding の ding（E7。ポップは使わない）

置き方（edit.json の段 demo-sfx。at はフレーム、書き出しは adelay = round(at/30*1000) ms で置く）:
  各ファイルの頭に「at の時刻 → 狙いの時刻」までの無音を入れ、アタック（whoosh は 5 ms RMS の山）が
  狙いの秒にぴったり来るようにする（at はフレームにしか置けないため）。
    pon       at 697（23.233）→ アタック 23.256（語頭 23.27 の 14 ms 前 = 声の立ち上がり 23.268 の前の無音に出す。
                                         BGM の拍 23.229 の 27 ms あと）
    stack     at 713（23.767）→ 1 打目 23.774（「図」の前の閉鎖 23.75〜23.79）・2 打目 23.814・3 打目 23.854
    playhead  at 727（24.233）→ 山 24.370（「出」の閉鎖 24.37〜24.38）
    count     at 743（24.767）→ アタック 24.775
音量: edit.json の gain_db −3 で、書き出しを ffmpeg -ac 1 でモノラル化した 5 ms RMS のピークが −15 dBFS 前後
（差し戻しの指定 −16〜−14 dBFS。組み込みの実測 measure_audio.py と同じ定義。主役の効果音 −8〜−12 dBFS より下、
声のピーク −5〜−10 dBFS より下）。ファイル側は +3 dB。頭は切らず（無音を足すだけ）、末尾は余韻が自然に消える所でフェード。
符号化は AAC-LC 192 kbps / 48 kHz / stereo の m4a（ffmpeg 内蔵 aac・bitexact・+faststart）。128 kbps だと whoosh の
ノイズ成分の波形 SNR が 14 dB まで落ちる（192 kbps で 22 dB。どれも 15 KB 以下）。同じ入力と ffmpeg n8.1.2 なら同じ md5。
素材（読むだけ）: ~/Akari/library/audio/akari-sounds-sfx/<id>.mp3（工房 assets/audio/<id>/ の curated テイクと sha256 一致）
"""
import argparse
import json
import struct
import subprocess
import tempfile
from pathlib import Path

import numpy as np

SR = 48000
FPS = 30
GAIN_DB_EDIT = -3.0          # edit.json に書く gain_db
TARGET_EXPORT_RMS5 = {        # 書き出しでの 5 ms RMS（モノラル）のピーク dBFS の狙い
    "pon": -15.5,             # 余韻があるぶん体感は大きいので少し下げる
    "stack": -14.5,           # 1 打が 20 ms 足らずで体感が小さいので少し上げる（3 打とも同じ高さ）
    "playhead": -15.0,
    "count": -15.0,
}
PLACEMENT = {                 # (at フレーム, 狙いの秒, 何を合わせるか)
    "pon": (697, 23.256, "attack"),
    "stack": (713, 23.774, "attack"),
    "playhead": (727, 24.370, "peak"),
    "count": (743, 24.775, "attack"),
}
STACK_SPACING_S = 0.040
STACK_SEMITONES = (0.0, 2.0, 4.0)


def decode(ffmpeg, path):
    raw = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).astype(np.float64)


def env_db(x, win):
    """モノラルの RMS 包絡。index i = 窓 [i, i+win) の開始サンプル。
    モノラル化は ffmpeg の -ac 1 と同じ (L+R)/√2（組み込みの実測 measure_audio.py と目利きの数字はこの定義。L/R の平均より +3.01 dB）"""
    m = x.sum(axis=1) / np.sqrt(2) if x.ndim == 2 else x
    c = np.concatenate([[0.0], np.cumsum(m ** 2)])
    return 20 * np.log10(np.maximum(np.sqrt((c[win:] - c[:-win]) / win), 1e-12))


def rms5_peak(x):
    e = env_db(x, 240)
    i = int(np.argmax(e))
    return float(e[i]), i


def onset_by_jump(x, lo_s, hi_s):
    """lo〜hi 秒で 1 ms RMS が 1 ms の間に一番大きく跳ねる所の、跳ねた先のサンプル（打音の立ち上がり）。"""
    e = env_db(x, 48)
    i0, i1 = int(lo_s * SR), int(hi_s * SR)
    seg = e[i0:i1]
    d = seg[48:] - seg[:-48]
    k = int(np.argmax(d))
    # 跳ねた窓の中で、振幅が跳ねた先の RMS の 1/2 を最初に越えるサンプル
    target = 10 ** (seg[k + 48] / 20) * 0.5
    w = np.abs(x[i0 + k:i0 + k + 96].mean(axis=1))
    j = int(np.argmax(w > target))
    return i0 + k + j


def fade(x, n_in, n_out):
    y = x.copy()
    if n_in:
        y[:n_in] *= (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n_in)))[:, None]
    if n_out:
        y[-n_out:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, n_out)))[:, None]
    return y


def resample_pitch(x, semitones):
    """帯域制限（FFT）で速さごと上げる = 音程を上げて短くする。前後にゼロを足して循環の漏れを避ける。"""
    if semitones == 0:
        return x.copy()
    r = 2 ** (semitones / 12)
    pad = len(x)
    xp = np.vstack([x, np.zeros((pad, 2))])
    n = len(xp)
    m = int(round(n / r))
    out = []
    for ch in range(2):
        spec = np.fft.rfft(xp[:, ch])
        keep = m // 2 + 1
        out.append(np.fft.irfft(spec[:keep], n=m) * (m / n))
    y = np.stack(out, axis=1)
    return y[:int(round(len(x) / r))]


def build_pon(src_dir, ffmpeg):
    x = decode(ffmpeg, src_dir / "sfx-blip-marimba.mp3")
    a = onset_by_jump(x, 0.20, 0.27)                   # 3 打目（A4）。直前は −44 dB の谷
    start = a - 48                                     # 1 ms 前から
    seg = x[start:start + int(0.46 * SR)]
    seg = fade(seg, 24, int(0.16 * SR))                # 頭 0.5 ms・末尾 160 ms（余韻が −30 dB を切る所で消す）
    return seg, 48, {"source": "sfx-blip-marimba", "source_attack_s": a / SR, "source_range_s": [start / SR, (start + len(seg)) / SR],
                     "what": "3 打目（A4 440 Hz＋C5 の響き）。1・2 打目（C5）は使わない"}


def click_segment(x, attack, length_s, n_fade_out):
    seg = x[attack - 48:attack - 48 + int(length_s * SR)]
    return fade(seg, 24, n_fade_out), 48


def highpass_fft(x, fc):
    n = len(x)
    f = np.fft.rfftfreq(n * 2, 1 / SR)
    g = 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-6)) ** 4)   # 2 次のバターワース相当の振幅（位相 0）
    out = []
    for ch in range(2):
        s = np.fft.rfft(np.concatenate([x[:, ch], np.zeros(n)]))
        out.append(np.fft.irfft(s * g, n=2 * n)[:n])
    return np.stack(out, axis=1)


def build_stack(src_dir, ffmpeg, mode):
    x = decode(ffmpeg, src_dir / "sfx-click-soft-ui.mp3")
    tick_a = onset_by_jump(x, 0.0, 0.03)               # 打音 1「チッ」（2.2〜2.6 kHz の芯＋64 Hz の胴）
    knock_a = onset_by_jump(x, 0.07, 0.2)               # 打音 2「コッ」（150〜1500 Hz の丸い胴）
    knock, pre = click_segment(x, knock_a, 0.050, int(0.020 * SR))
    tick, _ = click_segment(x, tick_a, 0.040, int(0.015 * SR))
    tick = highpass_fft(tick, 300.0)                    # 64 Hz のドスッを落として「チッ」だけに
    if mode == "knock":
        one = knock
    elif mode == "tick":
        one = tick
    else:
        # 「コッ」の胴に「チッ」の芯を −8 dB で重ねる（声の「ず」の摩擦に埋もれない帯を両方持たせる）
        k5, _ = rms5_peak(knock)
        t5, _ = rms5_peak(tick)
        tt = tick * 10 ** ((k5 - 8 - t5) / 20)
        one = knock.copy()
        one[:len(tt)] += tt
    clicks = []
    for st in STACK_SEMITONES:
        c = resample_pitch(one, st)
        c5, _ = rms5_peak(c)
        clicks.append(c * 10 ** ((-12 - c5) / 20))      # 3 打の 5 ms RMS をそろえる（全体の音量は後で決める）
    step = int(round(STACK_SPACING_S * SR))
    total = pre + step * (len(clicks) - 1) + max(len(c) for c in clicks) + 480
    y = np.zeros((total, 2))
    for i, c in enumerate(clicks):
        o = step * i
        y[o:o + len(c)] += c
    return y, pre, {"source": "sfx-click-soft-ui", "source_attack_s": {"tick": tick_a / SR, "knock": knock_a / SR}, "mode": mode,
                    "what": f"打音を {STACK_SPACING_S * 1000:.0f} ms 間隔で 3 つ（{'/'.join(f'+{s:g}' for s in STACK_SEMITONES)} 半音）"}


def build_playhead(src_dir, ffmpeg):
    x = decode(ffmpeg, src_dir / "sfx-whoosh-paper.mp3")
    # 素材は「シュッ」の山（0.12 s）のあとに紙のめくれの 2 つ目の山（0.23 s）がある。山 1 つにするため 0.20 s で切る
    seg = x[:int(0.200 * SR)]
    seg = fade(seg, 96, int(0.040 * SR))               # 頭 2 ms・末尾 40 ms（0.16〜0.20 s。2 つ目の山の手前で消す）
    e5 = env_db(seg, 240)
    lo, hi = int(0.08 * SR), int(0.16 * SR)
    peak_start = lo + int(np.argmax(e5[lo:hi]))        # 5 ms RMS が最大の窓の開始（組み込みの実測と同じ定義）
    return seg, peak_start, {"source": "sfx-whoosh-paper", "source_range_s": [0.0, 0.2], "source_peak_window_start_s": peak_start / SR,
                             "what": "whoosh の山 1 つ（0〜0.20 s。紙の 2 つ目の山 0.20〜0.26 s は使わない）"}


def build_count(src_dir, ffmpeg):
    x = decode(ffmpeg, src_dir / "sfx-pop-ding.mp3")
    a = onset_by_jump(x, 0.09, 0.14)                    # ding の打音（E7 2.66 kHz）。前のポップ（C7）の響きが下に残る
    start = a - 48
    seg = x[start:start + int(0.56 * SR)]
    seg = fade(seg, 24, int(0.22 * SR))                 # 余韻は 0.34 s から 0.22 s かけて消す
    return seg, 48, {"source": "sfx-pop-ding", "source_attack_s": a / SR, "source_range_s": [start / SR, (start + len(seg)) / SR],
                     "what": "ding の打音から（E7 2661 Hz。C7 の響きが −15 dB で重なる）。頭のポップ 0〜0.13 s は使わない"}


def place(seg, anchor, name):
    at, target_s, _ = PLACEMENT[name]
    at_s = round(at / FPS * 1000) / 1000              # 書き出しの adelay（ms に丸め）
    lead = int(round((target_s - at_s) * SR)) - anchor
    if lead < 0:
        raise SystemExit(f"{name}: 狙い {target_s} に対して at {at} が遅い（{lead} サンプル）")
    return np.vstack([np.zeros((lead, 2)), seg]), lead


def level(seg, name):
    target_file = TARGET_EXPORT_RMS5[name] - GAIN_DB_EDIT
    p, _ = rms5_peak(seg)
    g = target_file - p
    return seg * 10 ** (g / 20), g


def write_m4a(ffmpeg, y, out, title, comment):
    n = len(y)
    pad_to = int(np.ceil((n + 480) / 1024) * 1024)     # AAC のフレーム（1024）にそろえ、尾に無音を足す
    y = np.vstack([y, np.zeros((pad_to - n, 2))])
    data = y.astype("<f4").tobytes()
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "cut.wav"
        with open(wav, "wb") as fh:
            fh.write(b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE")
            fh.write(b"fmt " + struct.pack("<IHHIIHH", 16, 3, 2, SR, SR * 8, 8, 32))
            fh.write(b"data" + struct.pack("<I", len(data)) + data)
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
                        "-c:a", "aac", "-b:a", "192k", "-ar", str(SR), "-ac", "2",
                        "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
                        "-metadata", f"title={title}", "-metadata", f"comment={comment}",
                        "-movflags", "+faststart", str(out)], check=True)
    return pad_to


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ffmpeg")
    ap.add_argument("src_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--clicks", choices=("knock", "tick", "layer"), default="layer")
    ap.add_argument("--wav", action="store_true", help="確認用に float の wav も書く")
    o = ap.parse_args()
    src_dir, out_dir = Path(o.src_dir), Path(o.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    built = {
        "pon": build_pon(src_dir, o.ffmpeg),
        "stack": build_stack(src_dir, o.ffmpeg, o.clicks),
        "playhead": build_playhead(src_dir, o.ffmpeg),
        "count": build_count(src_dir, o.ffmpeg),
    }
    report = {}
    for name, (seg, anchor, info) in built.items():
        seg, gain = level(seg, name)
        y, lead = place(seg, anchor, name)
        at, target_s, kind = PLACEMENT[name]
        file = out_dir / f"sfx-diagram-{name}.m4a"
        comment = (f"AKARI Sounds {info['source']} (LicenseRef-AKARI-Sounds-v0). {info['what']}. "
                   f"head {lead / SR * 1000:.1f} ms silence so the {kind} lands at {target_s:.3f} s with at={at}; gain {gain:+.2f} dB")
        n = write_m4a(o.ffmpeg, y, file, f"sfx-diagram-{name} ({info['source']})", comment)
        if o.wav:
            data = y.astype("<f4")
            np.save(out_dir / f"sfx-diagram-{name}.npy", data)
        out_s = int(np.ceil(len(y) / SR * 1000)) / 1000       # 音が入っている長さ（ms に切り上げ）
        report[name] = {**info, "file": file.name, "at": at, "target_s": target_s, "anchor": kind,
                        "head_silence_ms": round(lead / SR * 1000, 3), "gain_db_applied": round(gain, 2),
                        "samples_encoded": n, "content_s": round(len(y) / SR, 4),
                        "edit_item": {"track": "demo-sfx", "id": f"demo-sfx-diagram-{name}", "at": at,
                                      "duration": int(np.ceil(out_s * FPS - 1e-9)), "role": "sfx", "gain_db": GAIN_DB_EDIT,
                                      "source": {"kind": "media", "src": f"demo-sfx-diagram-{name}", "in": 0, "out": out_s}}}
    items = {f"sfx-diagram-{k}": {"out": v["edit_item"]["source"]["out"], "duration": v["edit_item"]["duration"]} for k, v in report.items()}
    json.dump(items, open(out_dir / "items.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(report, open(out_dir / "build-report.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(items, ensure_ascii=False))


if __name__ == "__main__":
    main()
