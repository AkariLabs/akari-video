"""sfx-kouka-pop の音源を作り直すための切り出しスクリプト（再現用）。

使い方:
  python cut-sfx-pop-cork.py <ffmpeg> <sfx-pop-cork.mp3> <out.m4a> [gain_db=-7.51]

- 素材: AKARI Sounds sfx-pop-cork（md5 e3b43e06fa616ac0738662d89d8d8e47、LicenseRef-AKARI-Sounds-v0）
- 手順: ffmpeg で 48 kHz / 2ch / float32 に復号 → 先頭 7200 サンプル（0〜0.15 s。頭は切らない）
  → gain_db（既定 −7.51 dB: 素材の山 −0.49 dBFS を −8.0 dBFS へ。edit.json の gain_db −4 と
  合わせて書き出しのピーク −12 dBFS）→ 末尾 30 ms を raised cosine でフェード
  → AAC-LC 192 kbps / 48 kHz / 2ch の m4a（bitexact。同じ入力なら同じ md5 になる）
- 128 kbps ではなく 192 kbps にした理由: ffmpeg 内蔵 AAC の 128 kbps はこの鋭い立ち上がりで
  SNR 12.1 dB・ピーク +1.4 dB の崩れが出た（192 kbps で SNR 32.4 dB・ピーク誤差 0.01 dB）
- 期待値（ffmpeg n8.1 の vendor で作った場合）: md5 44e3cab12c25b36853d73d428ac12159
"""
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

SR = 48000
CUT_SAMPLES = 7200   # 0.15 s
FADE_SAMPLES = 1440  # 30 ms


def main() -> None:
    ffmpeg, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
    gain_db = float(sys.argv[4]) if len(sys.argv) > 4 else -7.51
    raw = subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", src, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
        check=True, capture_output=True,
    ).stdout
    audio = np.frombuffer(raw, dtype="<f4").reshape(-1, 2).astype(np.float64)
    cut = audio[:CUT_SAMPLES].copy() * 10 ** (gain_db / 20)
    cut[-FADE_SAMPLES:] *= (0.5 * (1 + np.cos(np.linspace(0, np.pi, FADE_SAMPLES))))[:, None]
    data = cut.astype("<f4").tobytes()
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "cut.wav"
        with open(wav, "wb") as fh:
            fh.write(b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE")
            fh.write(b"fmt " + struct.pack("<IHHIIHH", 16, 3, 2, SR, SR * 8, 8, 32))
            fh.write(b"data" + struct.pack("<I", len(data)) + data)
        subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
             "-c:a", "aac", "-b:a", "192k", "-ar", str(SR), "-ac", "2",
             "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
             "-metadata", "title=sfx-pop-cork 0-0.15s",
             "-metadata", f"comment=AKARI Sounds sfx-pop-cork (LicenseRef-AKARI-Sounds-v0), 0-0.15 s, {gain_db:+.2f} dB, 30 ms fade-out",
             "-movflags", "+faststart", out],
            check=True,
        )
    print(f"peak before encode {20 * np.log10(np.abs(cut).max()):.2f} dBFS -> {out}")


if __name__ == "__main__":
    main()
