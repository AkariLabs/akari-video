**English** | [日本語](./README.ja.md)

# @akari-video/media-bin

Resolves the `ffmpeg` / `ffprobe` / `whisper-cli` binaries for every AKARI Video package (`src/index.mjs`). ffmpeg and ffprobe are searched as `AKARI_FFMPEG_BIN` / `AKARI_FFPROBE_BIN` → `FFMPEG_PATH` (ffmpeg only, legacy) → `PATH` → the bundled `vendor/` binary pinned by `binary-manifest.mjs`; `whisper-cli` is searched as `AKARI_WHISPER_BIN` → bundled binary → `PATH`. When nothing is found the error says what to install instead of silently falling back to a command name.

## Preview audio sidecars (`src/preview-audio-sidecar.mjs`)

`ensurePreviewAudioSidecar` produces the 48 kHz FLAC sidecars (`preview-audio-flac-v1`) that the preview plays instead of heavy WAVs and speed-changed speech, cached under `<project>/.akari/cache/preview-audio/<key>.flac` and pruned by `sweepPreviewAudioSidecars`.

- Generation is asynchronous: ffmpeg and ffprobe run through promise-wrapped `child_process.spawn`, so the Theia backend (which also serves media bytes over HTTP Range) and preview-server's `/api/summary` keep responding while a transcode runs. `probePreviewAudioSourceAsync` is the non-blocking probe; the synchronous `probePreviewAudioSource` remains for scripts.
- Concurrent requests that resolve to the same sidecar path share one promise (one ffmpeg); once the file exists it is reused (`skipped: true`).
- At most 2 ffmpeg transcodes and 4 ffprobe calls run per process (`PREVIEW_AUDIO_CONCURRENCY`), and a transcode is killed after 30 min, a probe after 60 s (`PREVIEW_AUDIO_TIMEOUT_MS`). Override per call with `concurrency: { ffmpeg, ffprobe }` and `timeoutMs: { ffmpeg, ffprobe }` (used by tests).

## Tests

```sh
npm --prefix packages/media-bin test
```
