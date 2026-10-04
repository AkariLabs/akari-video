"""sfx-phone（構成表の効果音 2 本: スマホのせり上がり / 画面点灯のタップ）の音源を作り直す手順。

使い方（worktree のルートで）:
  python make-sfx-phone.py [ffmpeg] [素材フォルダ] [出力フォルダ] [--bitrate-swoosh 128k] [--bitrate-tap 192k]
                           [--tap-peak-db -3.4]

  既定: ffmpeg = packages/media-bin/vendor/win32-x64/ffmpeg.exe（n8.1.2）
        素材   = ~/Akari/library/audio/akari-sounds-sfx/（読むだけ）
        出力   = apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/audio/

素材（AKARI Sounds・LicenseRef-AKARI-Sounds-v0・price 0。工房の台帳 akari-video-internal assets/audio/<id>/meta.json）
  - sfx-swoosh-up.mp3          md5 2fb7e5d0b19d31246ac7df64c2ae5756（2.0 s・Suno chirp-sfx 68c2f721…）
  - sfx-click-mouse-single.mp3 md5 234994de14759ab6d79c8300846b6acb（2.0 s・Suno chirp-sfx d543012e…）

edit.json の item は構成表のまま（変えない）:
  demo-sfx-phone-swoosh  at 805（26.833）duration 20  in 0 out 0.65  gain_db -5
  demo-sfx-phone-tap     at 833（27.767）duration 5   in 0 out 0.15  gain_db -6

1) sfx-swoosh-up.m4a
   - 素材の「山」（10〜100 ms の RMS 包絡の -3 dB 幅の中心）は 0.340 s、標本最大は 0.364 s。
     構成表どおり頭から置くと山は 27.17 になり、「スマホ」の語頭 27.07 より 0.10 s 遅い
     （本体のせり上がりは --ease-smooth で 27.03〜27.07 が一番速く、27.17 ではもう 9 割着地している）。
   - そこで頭の 0.113 s（5424 サンプル。素材の -40 dB 以下の前触れ）を落として、item を変えずに
     山を 27.060・標本最大を 27.084 に置く（全体の統一ルール「whoosh の山を語頭 ±0.03 s」）。
     落とした部分は BGM（間 ≈ -25 LUFS）の下で 20 dB 以上小さく、聞こえる差は無い
   - 0.113〜0.763 s（31200 サンプル = 0.65 s）→ 頭 20 ms / 尾 30 ms を raised cosine でフェード
     → 標本ピーク -7.0 dBFS に合わせる（item の gain_db -5 と合わせて書き出しで -12 dBFS）
     → 尾に無音を足して 32000 サンプル（0.6667 s = item の 20 f。out 0.65 が復号長を超えないように）
2) sfx-click-mouse-single.m4a
   - 頭は切らない（押し込みのアタック 0.005 s・標本最大 0.014 s。離しの小さな音 0.085 s を含む）
   - 0〜0.15 s（7200 サンプル）→ 尾 30 ms フェード → 標本ピーク -3.4 dBFS（item の gain_db -6 と
     合わせて書き出しで各チャンネルの標本 ≈ -10 dBFS、integration/tools/measure_audio.py の
     peak_5ms_dbfs（-ac 1 の和・5 ms 窓）≈ -18 dBFS）→ 尾に無音を足して 8000 サンプル（0.1667 s = item の 5 f）
   - 2026-10-01 目利きの差し戻しで +8.6 dB（旧 -12.0 → -3.4）。書き出しの peak_5ms_dbfs が -26.6 で、
     声（「モ」の m と直後の母音）の中に埋もれていた。目標は「-18 dBFS 前後（gain +8 dB）」。
     AAC 192 kbps は大きさに対して線形でなく、-4.0（+8.0）だと -18.8、-3.4 で -18.1 になるので -3.4 にした。
     音色は変えない（1〜8 kHz ではもともと声＋BGM より 13〜19 dB 上。足りないのは帯域ではなく短い音の大きさ）。
     item（at 833・gain_db -6）は構成表のまま = 配線（onboarding-service.ts）と試験に触れずに済む。
     旧版に戻すときは --tap-peak-db -12.0（md5 d0059a4189ec5a35d2db7fc79fa7b9d5 が出る）
3) どちらも AAC-LC / 48 kHz / stereo / m4a（faststart・bitexact・タグなし・movie_timescale 48000 で
   edit list の尺をサンプル単位で正確に = 32000 / 8000）。同じ入力なら同じ md5
   ビットレート: whoosh は 128 kbps（帯域包絡の誤差 平均 0.35 dB）、タップは立ち上がりが鋭いので
   192 kbps（128 kbps だと帯域包絡の誤差 p95 2.0 dB → 192 kbps で 1.1 dB）
"""
import hashlib
import os
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

SR = 48000


def raised_cos(n: int) -> np.ndarray:
    return 0.5 * (1 - np.cos(np.linspace(0, np.pi, n)))


def decode(ffmpeg: str, src: str) -> np.ndarray:
    raw = subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", src, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).astype(np.float64)


def write_wav(path: Path, audio: np.ndarray) -> None:
    data = audio.astype("<f4").tobytes()
    with open(path, "wb") as fh:
        fh.write(b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE")
        fh.write(b"fmt " + struct.pack("<IHHIIHH", 16, 3, 2, SR, SR * 8, 8, 32))
        fh.write(b"data" + struct.pack("<I", len(data)) + data)


def encode(ffmpeg: str, wav: Path, out: Path, bitrate: str) -> None:
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
         "-c:a", "aac", "-b:a", bitrate, "-ar", str(SR), "-ac", "2",
         "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
         "-movflags", "+faststart", "-movie_timescale", str(SR), str(out)],
        check=True,
    )


def build_swoosh(src: np.ndarray) -> np.ndarray:
    head, body, total = 5424, 31200, 32000          # 0.113 s / 0.65 s / 0.6667 s
    fade_in, fade_out = 960, 1440                    # 20 ms / 30 ms
    x = src[head:head + body].copy()
    x[:fade_in] *= raised_cos(fade_in)[:, None]
    x[-fade_out:] *= raised_cos(fade_out)[::-1][:, None]
    x *= 10 ** (-7.0 / 20) / np.abs(x).max()          # 標本ピーク -7.0 dBFS
    out = np.zeros((total, 2))
    out[:body] = x
    return out


def build_tap(src: np.ndarray, peak_db: float = -3.4) -> np.ndarray:
    body, total, fade_out = 7200, 8000, 1440          # 0.15 s / 0.1667 s / 30 ms
    x = src[:body].copy()
    x[-fade_out:] *= raised_cos(fade_out)[::-1][:, None]
    x *= 10 ** (peak_db / 20) / np.abs(x).max()       # 標本ピーク -3.4 dBFS（2026-10-01 +8.6 dB。旧 -12.0）
    out = np.zeros((total, 2))
    out[:body] = x
    return out


def main() -> None:
    args, opts, rest = [], {}, sys.argv[1:]
    while rest:
        a = rest.pop(0)
        if a.startswith("--"):
            opts[a] = rest.pop(0)
        else:
            args.append(a)
    ffmpeg = str(Path(args[0] if len(args) > 0 else "packages/media-bin/vendor/win32-x64/ffmpeg.exe").resolve())
    src_dir = Path(args[1] if len(args) > 1 else Path.home() / "Akari/library/audio/akari-sounds-sfx")
    out_dir = Path(args[2] if len(args) > 2 else "apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/audio")
    br_swoosh = opts.get("--bitrate-swoosh", "128k")
    br_tap = opts.get("--bitrate-tap", "192k")
    tap_peak_db = float(opts.get("--tap-peak-db", "-3.4"))
    if tap_peak_db > -1.0:
        raise SystemExit(f"--tap-peak-db {tap_peak_db}: AAC の行き過ぎで割れないよう -1.0 dBFS 以下にする")
    out_dir.mkdir(parents=True, exist_ok=True)
    jobs = [
        ("sfx-swoosh-up", "2fb7e5d0b19d31246ac7df64c2ae5756", build_swoosh, br_swoosh),
        ("sfx-click-mouse-single", "234994de14759ab6d79c8300846b6acb",
         lambda src: build_tap(src, tap_peak_db), br_tap),
    ]
    with tempfile.TemporaryDirectory() as tmp:
        for name, md5, build, bitrate in jobs:
            src_path = src_dir / f"{name}.mp3"
            got = hashlib.md5(src_path.read_bytes()).hexdigest()
            if got != md5:
                raise SystemExit(f"{src_path}: md5 {got} != {md5}（素材が台帳と違う）")
            audio = build(decode(ffmpeg, str(src_path)))
            wav = Path(tmp) / f"{name}.wav"
            write_wav(wav, audio)
            out = out_dir / f"{name}.m4a"
            encode(ffmpeg, wav, out, bitrate)
            peak = 20 * np.log10(np.abs(audio).max())
            print(f"{name}: {len(audio)} samples, pre-encode peak {peak:.2f} dBFS, {bitrate} -> {out} "
                  f"md5 {hashlib.md5(out.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
