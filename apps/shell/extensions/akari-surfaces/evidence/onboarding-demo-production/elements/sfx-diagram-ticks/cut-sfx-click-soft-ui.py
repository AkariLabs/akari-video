"""sfx-diagram-ticks の音源（図解のノードが 1 つ出るたびの「コッ」）を作り直す切り出しスクリプト（再現用）。

使い方:
  python cut-sfx-click-soft-ui.py <ffmpeg> <sfx-click-soft-ui.mp3> <out.m4a> [--variant knock|spec]

- 素材: AKARI Sounds sfx-click-soft-ui（md5 9d83321587011f1218f3c89dce935b49、LicenseRef-AKARI-Sounds-v0、price 0）
  ~/Akari/library/audio/akari-sounds-sfx/sfx-click-soft-ui.mp3（工房の台帳: akari-video-internal assets/audio/sfx-click-soft-ui/meta.json）
- 素材は 1 本の中に 2 つの打音を持つ（押して離す型の UI クリック）:
    打音 1 = 5 ms に立ち上がる明るい「チッ」（1.5〜4 kHz の鋭い芯 + 64 Hz の低い胴。ピーク −3.8 dBFS）
    打音 2 = 102.8 ms に立ち上がる丸い「コッ」（150〜1500 Hz の胴。ピーク −10.3 dBFS。prompt の "gentle low blip"）
  構成表の「0〜0.16 s を切る」どおりだと 1 回鳴らすたびに「チッ・コッ」と 2 回鳴り、3 ノードで 6 打になる。
  構成表の意図は「ノードが 1 つ出るたびに小さく『コッ』」なので、既定（--variant knock）は打音 2 だけを使い、
  その立ち上がり（ピーク −20 dB を越える最初のサンプル）をファイルの 5.0 ms に置く。
  こうすると構成表の置き位置（at 698 / 707 / 721 f・「アタック 0.005 s」の前提）と edit_item を一切変えずに済む。
  --variant spec は構成表の文字どおり（素材の 0〜0.16 s、2 打）で、聞き比べ用（同梱しない）。
- 手順（knock）: ffmpeg で 48 kHz / 2ch / float32 に復号 → 打音 2 の立ち上がり − 240 サンプルから 7680 サンプル（0.16 s）
  → 頭 1 ms（48 サンプル）を直線フェードイン（その位置は打音 1 の尾で −80 dBFS。段差消し）
  → 末尾 30 ms を raised cosine でフェード → 尾に無音を足して 8192 サンプル（AAC 8 フレーム。0.1707 s。
  out 0.16 s より長くし、Chromium の復号が out に 1 サンプル足りない、を避ける）
  → GAIN_DB（復号後のサンプルピークが −18.0 dBFS。edit.json の gain_db −2 と合わせて書き出しのピーク −20 dBFS）
  → AAC-LC 128 kbps / 48 kHz / 2ch の m4a（bitexact。同じ入力なら同じ md5）
- 左右: 打音 2 は L −12.1 / R −10.3 dBFS・相関 0.87・位相ずれ 0（図解は画面右なので、わずかな右寄りはそのまま残す）
- 期待値（ffmpeg n8.1.2 = packages/media-bin/vendor/win32-x64 で作った場合）: md5 9feb9bb63bbf410e43f1a7803d7e1bb7・3348 bytes
  （~/Akari/library と akari-wt/perf-pv-v2/assets/audio/sfx/ の 2 か所の素材から作って一致を確認）
"""
import argparse
import struct
import subprocess
import tempfile
from pathlib import Path

import numpy as np

SR = 48000
PRE_ATTACK = 240       # 立ち上がりの前に置く 5 ms
CUT_SAMPLES = 7680     # 0.16 s（構成表の out）
PAD_TO = 8192          # AAC 8 フレーム
FADE_IN = 48           # 1 ms
FADE_OUT = 1440        # 30 ms
GAIN_DB_KNOCK = -7.12  # 打音 2（素材のピーク −10.32 dBFS）→ 復号後のピーク −18.0 dBFS
GAIN_DB_SPEC = -13.64  # 聞き比べ用（素材のピーク −3.80 dBFS）→ 復号後のピーク ≈ −18.0 dBFS


def decode(ffmpeg: str, src: str) -> np.ndarray:
    raw = subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", src, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).astype(np.float64)


def knock_attack(audio: np.ndarray) -> int:
    """打音 2 の立ち上がり = 70〜200 ms の区間で、区間ピーク −20 dB を最初に越えるサンプル。"""
    lo, hi = int(0.07 * SR), int(0.20 * SR)
    env = np.abs(audio[lo:hi]).max(axis=1)
    return lo + int(np.argmax(env > env.max() * 0.1))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ffmpeg")
    parser.add_argument("src")
    parser.add_argument("out")
    parser.add_argument("--variant", choices=("knock", "spec"), default="knock")
    opts = parser.parse_args()
    ffmpeg, src, out, variant = opts.ffmpeg, opts.src, opts.out, opts.variant
    audio = decode(ffmpeg, src)
    if variant == "knock":
        attack = knock_attack(audio)
        start = attack - PRE_ATTACK
        gain_db = GAIN_DB_KNOCK
    else:
        attack, start, gain_db = 240, 0, GAIN_DB_SPEC
    cut = audio[start:start + CUT_SAMPLES].copy()
    if variant == "knock":
        cut[:FADE_IN] *= np.linspace(0.0, 1.0, FADE_IN)[:, None]
    cut[-FADE_OUT:] *= (0.5 * (1 + np.cos(np.linspace(0, np.pi, FADE_OUT))))[:, None]
    cut = np.vstack([cut, np.zeros((PAD_TO - CUT_SAMPLES, 2))]) * 10 ** (gain_db / 20)
    data = cut.astype("<f4").tobytes()
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "cut.wav"
        with open(wav, "wb") as fh:
            fh.write(b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE")
            fh.write(b"fmt " + struct.pack("<IHHIIHH", 16, 3, 2, SR, SR * 8, 8, 32))
            fh.write(b"data" + struct.pack("<I", len(data)) + data)
        label = "knock (2nd transient only)" if variant == "knock" else "0-0.16 s as planned"
        subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
             "-c:a", "aac", "-b:a", "128k", "-ar", str(SR), "-ac", "2",
             "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
             "-metadata", f"title=sfx-click-soft-ui {label}",
             "-metadata", f"comment=AKARI Sounds sfx-click-soft-ui (LicenseRef-AKARI-Sounds-v0), source {start / SR:.6f}-{(start + CUT_SAMPLES) / SR:.6f} s, {gain_db:+.2f} dB, 30 ms fade-out",
             "-movflags", "+faststart", out],
            check=True,
        )
    print(f"variant={variant} source_attack_sample={attack} ({attack / SR * 1000:.3f} ms) start_sample={start} "
          f"gain_db={gain_db:+.2f} pre_encode_peak={20 * np.log10(np.abs(cut).max()):.2f} dBFS -> {out}")


if __name__ == "__main__":
    main()
