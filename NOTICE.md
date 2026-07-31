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

## Electron shell (desktop app)

Additional third-party notices for the desktop shell are generated at build
time into `apps/shell/resources/generated-notices/` (do not edit by hand).
