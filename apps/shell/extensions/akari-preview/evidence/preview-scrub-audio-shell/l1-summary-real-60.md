# preview scrub audio — L1 実測サマリ（実素材・機械生成: scripts/analyze.mjs）

- 実行: 2026-09-12T01:34:31.947Z / Electron 39.8.7 / Apple M1 8 cores 16 GB / Node v26.3.0
- 断片 40 ms・AudioContext 48000 Hz（baseLatency 5.3 ms / outputLatency 32 ms）

| run | mode | pattern | 駆動 Hz 要求 / 実測 | **可聴率 %** | **断片開始間隔 p50 / p95 ms** | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 古い音 % | 無音 % / 10ms 途切れ | クリック 総数 / 素材由来 / artifact（最大 Δ） | 断片長 p50 / min ms（窓） | renderer / gpu / audio CPU % | played / skipped | lastError |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| real-on-r-30hz | on | r | 30 / 30 | **49.3** | 32 / 53.3 | – / – | 5 / 10.3 | –（実素材） | – | 50.7 / 29 | 1 / 0 / **1** (0.24) | 40 / 40 (149.3) | 53.9 / 23.9 / 0.9 | 283 / 2 | – |
| real-on-f-60hz | on | f | 60 / 58.8 | **30** | 69.3 / 85.3 | – / – | 10.3 / 31.7 | –（実素材） | – | 70 / 8 | 0 / 0 / **0** (0.123) | 40 / 28.6 (149.3) | 29.2 / 11.1 / 0.6 | 15 / 44 | – |

- 遅延（録音）= seek 到達（ページ側 audioContext.currentTime・onSeek ラップで記録）→ 期待半音と完全一致する最初の 21 ms 分析窓の中心。期待半音が直前の seek と変わる seek だけを数える（found / n）。アプリ予約 = 到達 → 本編断片の BufferSource.start(when) の差
- 音程一致 = seek 到達から 300 ms 以内に期待半音 ±1 の音が出た seek の割合（手順 5）。古い音 = 可聴フレームのうち直近 250 ms のどの seek の音程にも合わないもの
- 駆動 Hz = 要求（実マウスの送出レート）/ 実測（onSeek 到達間隔から。アプリの rAF 間引きを通った後の実効レート）。可聴率 = 駆動区間の 5 ms フレームのうち RMS ≥ 0.01 の割合（無音 % の裏返し）。断片開始間隔 = 本編断片の BufferSource.start(when) の差分
- 無音 % = 駆動区間の 5 ms フレームのうち RMS < 0.01。クリック = 隣接サンプル差 > 0.2 の個数（純音の最大差は 0.06）。素材由来 = 素材（ffmpeg で 48 kHz mono に復号した参照）の同じ位置 ±2 ms に同等以上（差 −0.05 まで）の隣接差があるもの（声の過渡）。artifact = 素材に無い不連続 = 断片の継ぎ目で生じたクリック

| run | HTTP 要求 合計 | media Range 取得（fetch / media 要素） | media 全量取得 | moov 相当（fetch Range > 8 KB） | preview-audio API | sidecar .pcm | その他 |
|---|---|---|---|---|---|---|---|
| （開いた時〜ready） | 13 | 4 (3 / 1) | 0 | 1 | 0 | 0 | 9 |
| real-on-r-30hz | 310 | 310 (310 / 0) | 0 | 0 | 0 | 0 | 0 |
| real-on-f-60hz | 41 | 41 (41 / 0) | 0 | 0 | 0 | 0 | 0 |
| **全体（開いた時〜終了）** | 364 | 355 (354 / 1) | 0 | 1 | 0 | 0 | 9 |

- HTTP 要求 = webview が出した要求（CDP Network.requestWillBeSent）。media Range = `/assets/*.mp4|m4a` への `Range:` 付き要求（fetch = スクラブ音の moov / 断片取得、media 要素 = `<video>` の部分取得）。moov 相当 = fetch 由来で 8 KB を超える Range（断片は約 1.3 KB・box ヘッダ探索は 16 B）。src ごとに 1 回なら全体で 1。sidecar .pcm / preview-audio API が 0 なら前処理の産物に触っていない
- moov 取得の実体: /media/<id> bytes=32-69750 (@533.3 ms)
- 後始末: {"electronPid":99939,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingShellBackend":0}
- プロジェクト配下キャッシュ（前処理の有無）: [{"file":".gitignore","bytes":2},{"file":"preview-audio","bytes":128},{"file":"project-card","bytes":96},{"file":"thumbnails","bytes":96},{"file":"timeline","bytes":96},{"file":"preview-audio/ffcd4ee9ec43d9bd58e8f3ad9b9e3ca1232b0fe7.flac","bytes":3969369},{"file":"preview-audio/ffcd4ee9ec43d9bd58e8f3ad9b9e3ca1232b0fe7.json","bytes":262},{"file":"project-card/44a9b9c3db2e84b2","bytes":224},{"file":"thumbnails/b81dca0656ca0f94.jpg","bytes":6350},{"file":"timeline/filmstrip","bytes":128},{"file":"project-card/44a9b9c3db2e84b2/frame-1.jpg","bytes":12285},{"file":"project-card/44a9b9c3db2e84b2/frame-2.jpg","bytes":12297},{"file":"project-card/44a9b9c3db2e84b2/frame-3.jpg","bytes":12292},{"file":"project-card/44a9b9c3db2e84b2/frame-4.jpg","bytes":16211},{"file":"project-card/44a9b9c3db2e84b2/frame-5.jpg","bytes":12308},{"file":"timeline/filmstrip/c104a09f6ff40fd51f1459803471e0c5d9512386.jpg","bytes":104684},{"file":"timeline/filmstrip/c104a09f6ff40fd51f1459803471e0c5d9512386.json","bytes":142}]
