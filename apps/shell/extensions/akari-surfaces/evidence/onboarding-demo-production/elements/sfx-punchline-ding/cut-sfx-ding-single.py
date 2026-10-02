"""sfx-punchline-ding の音源（audio/sfx-ding-single.m4a）を作り直すための切り出し（再現用）。

使い方:
  python cut-sfx-ding-single.py <ffmpeg> <sfx-ding-single.mp3> <out.m4a>

- 素材: AKARI Sounds sfx-ding-single（md5 f3dec2573eb76986042005aec6a96ae7・sha256 e94dab93…
  = 台帳 provenance.jsonl の sfx-ding-single-b・LicenseRef-AKARI-Sounds-v0・price 0）
- 手順: ffmpeg で 48 kHz / 2ch / float32 に復号（asetpts=N/SR/TB。mp3 の priming は ffmpeg が落とす）
  → 先頭 67200 サンプル（0〜1.4 s。頭は切らない = アタック 0.005 s・サンプルの山 0.0173 s が素材と同じ位置）
  → 末尾 200 ms（1.2〜1.4 s）を raised cosine でフェード（鈴の余韻 −45 dBFS を途中で断ち切らず自然に減衰させる）
  → 音量は素材のまま（edit.json の gain_db −2 で 10 ms 包絡の山 −14.5 dBFS = 構成表の「ピーク目安 −14」）
  → AAC-LC 192 kbps / 48 kHz / 2ch の m4a（bitexact。同じ ffmpeg なら同じ md5）
- 128 kbps ではなく 192 kbps にした理由: 明るい鈴（1.4 / 3.5 kHz の部分音・8 kHz 以上に 19 %）で
  ffmpeg 内蔵 AAC の 128 kbps はアタック 0〜50 ms の波形 SNR 13.5 dB・アタック前のプリエコー −33 dBFS。
  192 kbps で 22.6 dB・−40 dBFS（34,982 バイト）
- 期待値（公開リポ packages/media-bin/vendor/win32-x64/ffmpeg.exe = n8.1.2 で作った場合）:
  md5 73732958497da2ed8cf0107952d55802（2 回作って同じ md5 を確認済み）
"""
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

SR = 48000
CUT_SAMPLES = 67200   # 1.4 s
FADE_SAMPLES = 9600   # 200 ms


def main() -> None:
    ffmpeg, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
    raw = subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", src, "-af", "asetpts=N/SR/TB",
         "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
        check=True, capture_output=True,
    ).stdout
    audio = np.frombuffer(raw, dtype="<f4").reshape(-1, 2).astype(np.float64)
    cut = audio[:CUT_SAMPLES].copy()
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
             "-metadata", "title=sfx-ding-single 0-1.4s",
             "-metadata", "comment=AKARI Sounds sfx-ding-single (LicenseRef-AKARI-Sounds-v0), 0-1.4 s, 200 ms fade-out",
             "-movflags", "+faststart", out],
            check=True,
        )
    print(f"peak before encode {20 * np.log10(np.abs(cut).max()):.2f} dBFS -> {out}")


if __name__ == "__main__":
    main()
