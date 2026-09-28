# 素材プレビュー実機観測

`before.json` は未修正ビルドの記録で、そのまま保持した。`after.json` は修正後の `npm run build` を用いた Electron 39.8.7 / CDP 9657 の記録。`run-l1.mjs` は `AKARI_L1_TMP_ROOT` で指定した専用一時ルートにプロジェクトとメディアを生成する。BEFORE 採取の Playwright はリポジトリ外の `PLAYWRIGHT_CORE_PATH` を使い、AFTER は `capture-after-cdp.mjs` の直接 CDP 観測を使う。証跡には実行環境の絶対パスを記録しない。

最新の AFTER は高負荷で `run-l1.mjs` の起動待ちが切れたため、同じ隔離設定で Electron を手動起動し、`captureAfter` を直接実行して採取した。採取後は起動した PID を停止した。

## 結果

- BEFORE: 候補 MP4 は h264 Constrained Baseline 832×480 と AAC LC 32 kHz stereo。映像の `currentTime` と画素は進むが、映像要素の音声トラック数と Web Audio の peak/RMS は 0。meta の有無、`assets/generated/` 直下への配置、無音ファイル、ダブルクリックも観測した。
- AFTER: 同じ候補 MP4 を開き、映像は 0→1.504474 秒に進み、画素も変化。抽出した FLAC の `<audio>` は 1.504 秒、音声トラック 1、`webkitAudioDecodedByteCount=145617`、peak 0.0881、RMS 0.0614。映像との時刻差は 0.002734 秒。
- 一時停止時は映像と音声がともに `paused=true`。2.5 秒へのシーク後は双方 2.5 秒。1.5 倍速では双方の `playbackRate=1.5`、時刻差 0.021464 秒。映像側は sidecar 再生中だけ muted、音声側は `muted=false`、`volume=1`。
- 生成静止画は 832×480 で表示。ナレーション WAV/MP3 は各音声トラック 1 で開き、`play()` が成功した。
- AFTER のコンソールに、素材切り替え時の annotations 由来 `publishClipAnnotationLabels` の `normalizePath` 例外を 1 件記録。通信失敗は 0 件。

修正は raw 素材プレビューだけで sidecar RPC を要求・ポーリングし、ready の FLAC 音声要素を映像に同期させる。音声抽出が失敗しても映像は従来どおり再生する。出力プレビュー側の音声経路は変更していない。L0 と全体テストの数値は `l0.json` に記録する。

修正後の全体テストは pure lane 3,243 件中 3,235 件通過・失敗 2 件・skip 6 件、shell lane 6,830 件中 6,828 件通過・失敗 2 件で完走した。失敗はそれぞれ基点と同じ拡張依存検査 2 件、vendored ffprobe 不在と表示名期待値の各 1 件。shell lane 内の akari-preview は 1,757/1,757 件、拡張単体の `node --test` 全体は 1,763/1,763 件、新規テストは 3/3 件通過した。`build:ext`・`build`・frame-engine の tsc・変更ファイルの eslint はすべて exit 0。内訳は `l0.json` に記録した。
