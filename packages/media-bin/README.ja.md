[English](./README.md) | **日本語**

# @akari-video/media-bin

AKARI Video の各パッケージが使う `ffmpeg` / `ffprobe` / `whisper-cli` バイナリの解決を一元化します（`src/index.mjs`）。ffmpeg / ffprobe の探索順は `AKARI_FFMPEG_BIN` / `AKARI_FFPROBE_BIN` → `FFMPEG_PATH`（ffmpeg のみ・既存互換） → `PATH` → `binary-manifest.mjs` でピン留めした同梱バイナリ（`vendor/`）、`whisper-cli` は `AKARI_WHISPER_BIN` → 同梱バイナリ → `PATH` です。見つからないときはコマンド名へ黙ってフォールバックせず、何を入れればよいかを含む Error を投げます。

## プレビュー音声サイドカー（`src/preview-audio-sidecar.mjs`）

`ensurePreviewAudioSidecar` は、重い WAV や速度変更した台詞の代わりにプレビューが再生する 48 kHz FLAC サイドカー（`preview-audio-flac-v1`）を `<project>/.akari/cache/preview-audio/<key>.flac` に生成し、`sweepPreviewAudioSidecars` が不要分を掃除します。

- 生成は非同期です。ffmpeg / ffprobe は promise で包んだ `child_process.spawn` で走るので、素材を HTTP Range 配信する Theia バックエンドや preview-server の `/api/summary` は変換中も応答し続けます。非同期 probe は `probePreviewAudioSourceAsync`、同期版 `probePreviewAudioSource` はスクリプト向けに残しています。
- 同じサイドカーパスに解決される同時要求は 1 本の promise（ffmpeg 1 回）に合流し、ファイルができた後は再利用します（`skipped: true`）。
- 1 プロセスあたり ffmpeg の変換は 2 本、ffprobe は 4 本まで（`PREVIEW_AUDIO_CONCURRENCY`）。変換は 30 分、probe は 60 秒で kill します（`PREVIEW_AUDIO_TIMEOUT_MS`）。呼び出しごとに `concurrency: { ffmpeg, ffprobe }` / `timeoutMs: { ffmpeg, ffprobe }` で上書きできます（テストで使用）。

## テスト

```sh
npm --prefix packages/media-bin test
```
