# preview scrub audio — L1 実測サマリ（実素材・機械生成: scripts/analyze.mjs）

- 実行: 2026-09-11T13:13:43.713Z / Electron 39.8.7 / Apple M1 8 cores 16 GB / Node v26.3.0
- seek 30 Hz・断片 40 ms・AudioContext 48000 Hz（baseLatency 5.3 ms / outputLatency 34 ms）

| run | mode | pattern | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 古い音 % | 無音 % / 10ms 途切れ | クリック 総数 / 素材由来 / artifact（最大 Δ） | 断片長 p50 / min ms（窓） | renderer / gpu / audio CPU % | played / skipped | lastError |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| real-off-r | off | r | – / – | – / – | –（実素材） | – | – / 0 | 0 / 0 / **0** (0) | – / – (–) | 22.4 / 18.7 / 0.4 | 0 / 300 | – |
| real-on-r | on | r | – / – | 10.3 / 15.7 | –（実素材） | – | 31.1 / 30 | 3 / 3 / **0** (0.222) | 40 / 40 (162.5) | 32.4 / 19.4 / 0.9 | 300 / 0 | – |

- 遅延（録音）= seek 到達（ページ側 audioContext.currentTime・onSeek ラップで記録）→ 期待半音と完全一致する最初の 21 ms 分析窓の中心。期待半音が直前の seek と変わる seek だけを数える（found / n）。アプリ予約 = 到達 → 本編断片の BufferSource.start(when) の差
- 音程一致 = seek 到達から 300 ms 以内に期待半音 ±1 の音が出た seek の割合（手順 5）。古い音 = 可聴フレームのうち直近 250 ms のどの seek の音程にも合わないもの
- 無音 % = 駆動区間の 5 ms フレームのうち RMS < 0.01。クリック = 隣接サンプル差 > 0.2 の個数（純音の最大差は 0.06）。素材由来 = 素材（ffmpeg で 48 kHz mono に復号した参照）の同じ位置 ±2 ms に同等以上（差 −0.05 まで）の隣接差があるもの（声の過渡）。artifact = 素材に無い不連続 = 断片の継ぎ目で生じたクリック

| run | HTTP 要求 合計 | media Range 取得（fetch / media 要素） | media 全量取得 | moov 相当（fetch Range > 8 KB） | preview-audio API | sidecar .pcm | その他 |
|---|---|---|---|---|---|---|---|
| （開いた時〜ready） | 53 | 19 (3 / 16) | 0 | 1 | 0 | 0 | 34 |
| real-off-r | 15 | 15 (0 / 15) | 0 | 0 | 0 | 0 | 0 |
| real-on-r | 795 | 795 (788 / 7) | 0 | 0 | 0 | 0 | 0 |
| **全体（開いた時〜終了）** | 863 | 829 (791 / 38) | 0 | 1 | 0 | 0 | 34 |

- HTTP 要求 = webview が出した要求（CDP Network.requestWillBeSent）。media Range = `/assets/*.mp4|m4a` への `Range:` 付き要求（fetch = スクラブ音の moov / 断片取得、media 要素 = `<video>` の部分取得）。moov 相当 = fetch 由来で 8 KB を超える Range（断片は約 1.3 KB・box ヘッダ探索は 16 B）。src ごとに 1 回なら全体で 1。sidecar .pcm / preview-audio API が 0 なら前処理の産物に触っていない
- moov 取得の実体: /assets/main.mp4 bytes=32-65837 (@16589.1 ms)
- 後始末: {"electronPid":62674,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingElectronMainScript":0,"survivingShellBackend":0,"survivingPreviewServer":0}
- プロジェクト配下キャッシュ（前処理の有無）: [{"file":"preview-audio","bytes":128},{"file":"preview-audio/c1609ad5fbe8f7326121864139a5c15dd273f665.flac","bytes":4973765},{"file":"preview-audio/c1609ad5fbe8f7326121864139a5c15dd273f665.json","bytes":255}]
