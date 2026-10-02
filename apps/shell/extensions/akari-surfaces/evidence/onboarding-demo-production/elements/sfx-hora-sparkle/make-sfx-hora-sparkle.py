"""sfx-hora-sparkle（「ほら」20.55 のキラッ）の音源を作り直すスクリプト（r2・再現用）。

使い方:
  python make-sfx-hora-sparkle.py <ffmpeg> <sfx-pop-ding.mp3> <sfx-shimmer-sparkle.mp3> <out.m4a>

目利きの差し戻し（2026-10-01）:
  r1 は sfx-shimmer-sparkle の 0〜1.45 s をそのまま置いたため、音の山が 20.99（「ほら」の 0.44 s 後）に来る
  ふくらみ型で、「ほら」の瞬間の手応えが弱かった（書き出しの 5 ms 窓のピーク −17.9 dBFS）。
  → 「ほら」の瞬間にアタックのはっきりしたキラッ（sfx-pop-ding の頭 0.2 s）を −12 dBFS で重ね、
    shimmer は頭を切って山を 20.55〜20.70 に寄せる。

ファイルの中身（file 秒 τ。edit.json の at 617 = 20.5667 s に置くので、絶対秒 = 20.5667 + τ）:
  1. キラッ = AKARI Sounds sfx-pop-ding（md5 5ff54570…）の 0〜0.20 s。頭は切らない（元の立ち上がり 0.005 s）。
     0.14〜0.20 s に raised cosine のフェード。書き出しの標本ピークが −12.0 dBFS になる倍率
     （edit.json の gain_db +2 の手前で −14.0 dBFS）。→ 立ち上がり τ 0.005 = 20.572（「ほら」語頭 20.552 の +20 ms）
  2. キラキラ = AKARI Sounds sfx-shimmer-sparkle（md5 1fce76d7…）の 0.35〜1.80 s を −8.0 dB。
     頭 50 ms は raised cosine のフェードイン（キラッのアタックの下に潜らせ、キラッの立ち上がりを濁さない）。
     元の山（50 ms 窓 0.4225 s / 10 ms 窓 0.4278 s）が τ 0.0725〜0.0778 = 20.639〜20.644 に来る。
     τ 0.12〜0.30 で +4 dB まで raised cosine で持ち上げてそのまま保つ（尾の持ち上げ）。山を前へ寄せた分、
     「ほら、」と「こんな」の間（20.74〜21.10）に残る尾が r1 より 9 dB 小さくなるのを 3 dB 取り戻す。
     持ち上げても τ 0.2 以降の 50 ms 窓は山より 11 dB 下（2 つ目の山はできない）
  3. 1.42〜1.45 s に 30 ms のフェード、1.45〜1.4667 s は無音（70400 サンプル = 44 f ちょうど。
     edit.json の duration 44・out 1.45 がデコード長を超えないように r1 と同じ長さ）
  → AAC-LC 256 kbps / 48 kHz / 2ch の m4a（bitexact・faststart・movie_timescale 48000。同じ入力なら同じ md5）
  256 kbps にした理由: キラキラの芯は 4〜12 kHz にある。ffmpeg 内蔵 AAC で波形の SNR を帯域別に測ると
  192 kbps は 4〜12 kHz 16.6 dB・12〜16 kHz 1.2 dB（ほぼ落ちる）、256 kbps は 23.2 dB・12.0 dB。
  キラッの立ち上がり（0〜4 kHz）はどちらも 28 dB 以上。サイズ差は 12 KB ほど

edit.json（r1 から変えない）: 段 demo-sfx、id demo-sfx-hora-sparkle、at 617、duration 44、gain_db +2、
  source demo-sfx-shimmer-sparkle in 0 out 1.45。
"""
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

SR = 48000
TOTAL = 70400                 # 1.4667 s = 44 f
CONTENT = 69600               # 1.45 s（out 1.45）
END_FADE = 1440               # 30 ms
DING_LEN = int(0.20 * SR)     # sfx-pop-ding の頭 0.2 s
DING_FADE = int(0.06 * SR)    # 0.14〜0.20 s
DING_OUT_PEAK_DBFS = -12.0    # 書き出しでの標本ピーク（gain_db +2 を掛けた後）
ITEM_GAIN_DB = 2.0            # edit.json の gain_db（r1 から変えない）
SHIMMER_IN_S = 0.35           # shimmer の切り出し開始（元の山 0.4225 s が τ 0.0725 へ）
SHIMMER_GAIN_DB = -8.0
SHIMMER_FADE_IN = int(0.05 * SR)
SHIMMER_TAIL_LIFT_DB = 4.0
SHIMMER_TAIL_LIFT = (0.12, 0.30)  # τ 秒: この間で 0 → +4 dB（raised cosine）、以降 +4 dB


def decode(ffmpeg: str, path: str) -> np.ndarray:
    raw = subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).astype(np.float64)


def raised_cosine(n: int, rising: bool) -> np.ndarray:
    w = 0.5 * (1 - np.cos(np.linspace(0, np.pi, n)))
    return w if rising else w[::-1]


def build(ding_src: np.ndarray, shimmer_src: np.ndarray, parts: bool = False):
    """ファイルに書く波形（TOTAL×2・file 秒）。parts=True なら (合計, キラッだけ, キラキラだけ) を返す（計測用）。"""
    ding = ding_src[:DING_LEN].copy()
    ding[-DING_FADE:] *= raised_cosine(DING_FADE, False)[:, None]
    ding *= 10 ** ((DING_OUT_PEAK_DBFS - ITEM_GAIN_DB) / 20) / np.abs(ding).max()
    start = int(round(SHIMMER_IN_S * SR))
    shimmer = shimmer_src[start:start + CONTENT].copy() * 10 ** (SHIMMER_GAIN_DB / 20)
    shimmer[:SHIMMER_FADE_IN] *= raised_cosine(SHIMMER_FADE_IN, True)[:, None]
    lift = np.ones(CONTENT)
    a, b = int(SHIMMER_TAIL_LIFT[0] * SR), int(SHIMMER_TAIL_LIFT[1] * SR)
    lift[a:b] = 10 ** (SHIMMER_TAIL_LIFT_DB * raised_cosine(b - a, True) / 20)
    lift[b:] = 10 ** (SHIMMER_TAIL_LIFT_DB / 20)
    shimmer *= lift[:, None]
    tail = np.ones(TOTAL)
    tail[CONTENT - END_FADE:CONTENT] = raised_cosine(END_FADE, False)
    tail[CONTENT:] = 0
    ding_part = np.zeros((TOTAL, 2))
    ding_part[:DING_LEN] = ding
    shimmer_part = np.zeros((TOTAL, 2))
    shimmer_part[:CONTENT] = shimmer
    ding_part *= tail[:, None]
    shimmer_part *= tail[:, None]
    mix = ding_part + shimmer_part
    return (mix, ding_part, shimmer_part) if parts else mix


def main() -> None:
    ffmpeg, ding_path, shimmer_path, out = sys.argv[1:5]
    mix = build(decode(ffmpeg, ding_path), decode(ffmpeg, shimmer_path))
    data = mix.astype("<f4").tobytes()
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "mix.wav"
        with open(wav, "wb") as fh:
            fh.write(b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE")
            fh.write(b"fmt " + struct.pack("<IHHIIHH", 16, 3, 2, SR, SR * 8, 8, 32))
            fh.write(b"data" + struct.pack("<I", len(data)) + data)
        subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
             "-c:a", "aac", "-b:a", "256k", "-ar", str(SR), "-ac", "2",
             "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
             "-metadata", "title=sfx-hora-sparkle r2 (pop-ding head + shimmer-sparkle)",
             "-metadata", "comment=AKARI Sounds (LicenseRef-AKARI-Sounds-v0): sfx-pop-ding 0-0.20 s at -14.0 dBFS peak"
                          " + sfx-shimmer-sparkle 0.35-1.80 s at -8.0 dB (50 ms fade-in, +4 dB tail lift over 0.12-0.30 s);"
                          " 30 ms fade-out at 1.42-1.45 s",
             "-movflags", "+faststart", "-movie_timescale", str(SR), out],
            check=True,
        )
    pk = 20 * np.log10(np.abs(mix).max())
    print(f"float mix: sample peak {pk:.2f} dBFS (file) / {pk + ITEM_GAIN_DB:.2f} dBFS (at gain_db +{ITEM_GAIN_DB:g}) -> {out}")


if __name__ == "__main__":
    main()
