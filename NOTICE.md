# Third-Party Notices

## FFmpeg (ffmpeg / ffprobe)

This product downloads and bundles FFmpeg (ffmpeg / ffprobe), used as separate
command-line processes (not linked into this application's binary). GPL-only
builds (no `--enable-nonfree`) are used:

- **macOS (arm64 / x64)**: martin-riedl.de release build (ffmpeg 8.1.2).
  `--enable-gpl`, GPL-3.0-or-later. Build script:
  https://git.martin-riedl.de/ffmpeg/build-script
- **Linux (x64 / arm64) and Windows (x64)**: BtbN/FFmpeg-Builds "gpl" variant
  (ffmpeg 8.1.2, `--enable-gpl`, `--disable-libfdk-aac`). Build recipe:
  https://github.com/BtbN/FFmpeg-Builds

Binaries are fetched from the pinned URLs in
`packages/media-bin/src/binary-manifest.mjs` and verified against pinned
sha256 checksums before use (`packages/media-bin/scripts/fetch-binaries.mjs`).

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project.
Full FFmpeg license information: https://ffmpeg.org/legal.html

## whisper.cpp (whisper-cli)

This product downloads and bundles whisper-cli (whisper.cpp), used as a
separate command-line process (not linked into this application's binary),
for local speech-to-text transcription. whisper.cpp is MIT licensed
(Copyright (c) 2023-2026 The ggml authors). Source:
https://github.com/ggml-org/whisper.cpp

Supply differs by platform (no official macOS binary distribution exists):

- **macOS (arm64)**: source-built at release time from the pinned tag
  `v1.9.2` (`packages/media-bin/src/binary-manifest.mjs`'s
  `WHISPER_CPP_SOURCE`, verified against a pinned sha256), using cmake
  (`packages/media-bin/scripts/build-whisper.mjs`, `-DBUILD_SHARED_LIBS=OFF`
  for a self-contained binary — no acceleration defaults are overridden).
  macOS x64 is not built at this time (arm64-only dmg distribution).
- **Windows (x64)**: whisper.cpp v1.9.2 official GitHub Release build
  (`whisper-bin-x64.zip`, the plain non-BLAS/non-CUDA build), fetched and
  verified against a pinned sha256
  (`packages/media-bin/src/binary-manifest.mjs`'s `win32-x64` manifest
  entry, `packages/media-bin/scripts/fetch-binaries.mjs`). Its runtime DLL
  dependencies (`whisper.dll`, `ggml.dll`, `ggml-base.dll`, and the
  per-CPU-microarchitecture `ggml-cpu-*.dll` backend variants ggml
  dynamically dispatches between) are bundled alongside it.

## Robust Video Matting (RVM)

Robust Video Matting is GPL-3.0 licensed. This product distributes neither
RVM code nor model weights. At the user's direction, model weights are
downloaded from upstream onto the user's machine as an opt-in addition.
Source and license:
https://github.com/PeterL1n/RobustVideoMatting

Model URLs and sha256 checksums are pinned in
`packages/matte-rvm/src/model-manifest.mjs`; downloads are verified before
being installed under `packages/matte-rvm/vendor/`.

## Electron shell (desktop app)

Additional third-party notices for the desktop shell are generated at build
time into `apps/shell/resources/generated-notices/` (do not edit by hand).
