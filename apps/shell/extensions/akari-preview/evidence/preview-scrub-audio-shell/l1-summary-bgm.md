# preview scrub audio — L1 実測サマリ（合成純音・機械生成: scripts/analyze.mjs）

- 実行: 2026-09-11T15:06:51.330Z / Electron 39.8.7 / Apple M1 8 cores 16 GB / Node v26.3.0
- seek 30 Hz・断片 40 ms・AudioContext 48000 Hz（baseLatency 5.3 ms / outputLatency 32 ms）

| run | mode | pattern | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 古い音 % | 無音 % / 10ms 途切れ | クリック 総数 / 素材由来 / artifact（最大 Δ） | 断片長 p50 / min ms（窓） | renderer / gpu / audio CPU % | played / skipped | lastError |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bgm-on-a | on | a | 11.7 / 25.7 (19/19) | 10.3 / 26.3 | 100% / 100% | 0.2 | 3.1 / 8 | 0 / 0 / **0** (0.061) | 40 / 40 (149.3) | 72.9 / 28.6 / 1.1 | 273 / 12 | – |
| bgm-on-b | on | b | 17 / 57 (45/50) | 15.7 / 31.7 | 98.9% / 98.9% | 0.2 | 12.9 / 8 | 0 / 0 / **0** (0.061) | 40 / 40 (149.3) | 65 / 24 / 0.9 | 75 / 15 | – |
| bgm-on-c | on | c | 15 / 73 (34/36) | 15.7 / 26.3 | 100% / 100% | 0.2 | 2.2 / 6 | 0 / 0 / **0** (0.061) | 40 / 40 (149.3) | 74.6 / 26.4 / 0.9 | 175 / 5 | – |

- 遅延（録音）= seek 到達（ページ側 audioContext.currentTime・onSeek ラップで記録）→ 期待半音と完全一致する最初の 21 ms 分析窓の中心。期待半音が直前の seek と変わる seek だけを数える（found / n）。アプリ予約 = 到達 → 本編断片の BufferSource.start(when) の差
- 音程一致 = seek 到達から 300 ms 以内に期待半音 ±1 の音が出た seek の割合（手順 5）。古い音 = 可聴フレームのうち直近 250 ms のどの seek の音程にも合わないもの
- 無音 % = 駆動区間の 5 ms フレームのうち RMS < 0.01。クリック = 隣接サンプル差 > 0.2 の個数（純音の最大差は 0.06）。素材由来 = 素材（ffmpeg で 48 kHz mono に復号した参照）の同じ位置 ±2 ms に同等以上（差 −0.05 まで）の隣接差があるもの（声の過渡）。artifact = 素材に無い不連続 = 断片の継ぎ目で生じたクリック

| run | HTTP 要求 合計 | media Range 取得（fetch / media 要素） | media 全量取得 | moov 相当（fetch Range > 8 KB） | preview-audio API | sidecar .pcm | その他 |
|---|---|---|---|---|---|---|---|
| （開いた時〜ready） | 17 | 7 (3 / 1) | 0 | 1 | 0 | 0 | 9 |
| bgm-on-a | 701 | 701 (699 / 2) | 0 | 0 | 0 | 0 | 0 |
| bgm-on-b | 438 | 438 (435 / 3) | 0 | 0 | 0 | 0 | 0 |
| bgm-on-c | 691 | 691 (691 / 0) | 0 | 0 | 0 | 0 | 0 |
| **全体（開いた時〜終了）** | 1847 | 1837 (1828 / 6) | 0 | 1 | 0 | 0 | 9 |

- HTTP 要求 = webview が出した要求（CDP Network.requestWillBeSent）。media Range = `/assets/*.mp4|m4a` への `Range:` 付き要求（fetch = スクラブ音の moov / 断片取得、media 要素 = `<video>` の部分取得）。moov 相当 = fetch 由来で 8 KB を超える Range（断片は約 1.3 KB・box ヘッダ探索は 16 B）。src ごとに 1 回なら全体で 1。sidecar .pcm / preview-audio API が 0 なら前処理の産物に触っていない
- moov 取得の実体: /media/<id> bytes=32-53393 (@558.3 ms)
- 後始末: {"electronPid":24783,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingShellBackend":0}
- プロジェクト配下キャッシュ（前処理の有無）: [{"file":".gitignore","bytes":2},{"file":"preview-audio","bytes":160},{"file":"project-card","bytes":96},{"file":"thumbnails","bytes":128},{"file":"timeline","bytes":96},{"file":"preview-audio/160b3488647ea5cf1ae40142d9a7ff5186717f5a.flac","bytes":3746699},{"file":"preview-audio/160b3488647ea5cf1ae40142d9a7ff5186717f5a.json","bytes":255},{"file":"preview-audio/probe-cbcf720b8a384c8627654f4ab260639eac0aa4a3.json","bytes":196},{"file":"project-card/3761c449cf42e054","bytes":224},{"file":"thumbnails/10cf1fa2f100ff7f.png","bytes":6528},{"file":"thumbnails/e189877ca999ca67.jpg","bytes":7370},{"file":"timeline/filmstrip","bytes":128},{"file":"project-card/3761c449cf42e054/frame-1.jpg","bytes":11770},{"file":"project-card/3761c449cf42e054/frame-2.jpg","bytes":12607},{"file":"project-card/3761c449cf42e054/frame-3.jpg","bytes":12294},{"file":"project-card/3761c449cf42e054/frame-4.jpg","bytes":12400},{"file":"project-card/3761c449cf42e054/frame-5.jpg","bytes":11922},{"file":"timeline/filmstrip/fa5de810e705645b53ad80efd82011a7fd19e6d0.jpg","bytes":161906},{"file":"timeline/filmstrip/fa5de810e705645b53ad80efd82011a7fd19e6d0.json","bytes":142}]
