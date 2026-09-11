# preview scrub audio — L1 実測サマリ（合成純音・機械生成: scripts/analyze.mjs）

- 実行: 2026-09-11T15:07:34.971Z / Electron 39.8.7 / Apple M1 8 cores 16 GB / Node v26.3.0
- seek 30 Hz・断片 40 ms・AudioContext 48000 Hz（baseLatency 5.3 ms / outputLatency 32 ms）

| run | mode | pattern | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 古い音 % | 無音 % / 10ms 途切れ | クリック 総数 / 素材由来 / artifact（最大 Δ） | 断片長 p50 / min ms（窓） | renderer / gpu / audio CPU % | played / skipped | lastError |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| engine-on-a | on | a | 12.3 / 55 (19/19) | 5 / 21 | 100% / 0% | 0.1 | 3.8 / 12 | 0 / 0 / **0** (0.056) | 40 / 40 (149.3) | 56.4 / 21.1 / 1.2 | 265 / 20 | – |
| engine-on-b | on | b | 17 / 41 (50/50) | 15.7 / 26.3 | 100% / 0% | 0 | 4.3 / 5 | 0 / 0 / **0** (0.054) | 40 / 40 (149.3) | 68.7 / 28.6 / 1.1 | 86 / 4 | – |
| engine-on-c | on | c | 16.7 / 36.7 (30/31) | 15.7 / 26.3 | 100% / 0% | 0 | 6 / 10 | 0 / 0 / **0** (0.054) | 40 / 40 (149.3) | 63.1 / 38.5 / 1.3 | 168 / 12 | – |

- 遅延（録音）= seek 到達（ページ側 audioContext.currentTime・onSeek ラップで記録）→ 期待半音と完全一致する最初の 21 ms 分析窓の中心。期待半音が直前の seek と変わる seek だけを数える（found / n）。アプリ予約 = 到達 → 本編断片の BufferSource.start(when) の差
- 音程一致 = seek 到達から 300 ms 以内に期待半音 ±1 の音が出た seek の割合（手順 5）。古い音 = 可聴フレームのうち直近 250 ms のどの seek の音程にも合わないもの
- 無音 % = 駆動区間の 5 ms フレームのうち RMS < 0.01。クリック = 隣接サンプル差 > 0.2 の個数（純音の最大差は 0.06）。素材由来 = 素材（ffmpeg で 48 kHz mono に復号した参照）の同じ位置 ±2 ms に同等以上（差 −0.05 まで）の隣接差があるもの（声の過渡）。artifact = 素材に無い不連続 = 断片の継ぎ目で生じたクリック

| run | HTTP 要求 合計 | media Range 取得（fetch / media 要素） | media 全量取得 | moov 相当（fetch Range > 8 KB） | preview-audio API | sidecar .pcm | その他 |
|---|---|---|---|---|---|---|---|
| （開いた時〜ready） | 38 | 25 (3 / 0) | 0 | 1 | 0 | 0 | 11 |
| engine-on-a | 1270 | 1270 (702 / 0) | 0 | 0 | 0 | 0 | 0 |
| engine-on-b | 901 | 901 (428 / 0) | 0 | 0 | 0 | 0 | 0 |
| engine-on-c | 766 | 766 (686 / 0) | 0 | 0 | 0 | 0 | 0 |
| **全体（開いた時〜終了）** | 2975 | 2962 (1819 / 0) | 0 | 1 | 0 | 0 | 11 |

- HTTP 要求 = webview が出した要求（CDP Network.requestWillBeSent）。media Range = `/assets/*.mp4|m4a` への `Range:` 付き要求（fetch = スクラブ音の moov / 断片取得、media 要素 = `<video>` の部分取得）。moov 相当 = fetch 由来で 8 KB を超える Range（断片は約 1.3 KB・box ヘッダ探索は 16 B）。src ごとに 1 回なら全体で 1。sidecar .pcm / preview-audio API が 0 なら前処理の産物に触っていない
- moov 取得の実体: /media/<id> bytes=32-53393 (@750.2 ms)
- 後始末: {"electronPid":25387,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingShellBackend":0}
- プロジェクト配下キャッシュ（前処理の有無）: [{"file":".gitignore","bytes":2},{"file":"preview-audio","bytes":160},{"file":"project-card","bytes":96},{"file":"thumbnails","bytes":128},{"file":"timeline","bytes":96},{"file":"preview-audio/a3b0afe3203dec5e1481b060b8b18616ed500d1e.flac","bytes":3746699},{"file":"preview-audio/a3b0afe3203dec5e1481b060b8b18616ed500d1e.json","bytes":255},{"file":"preview-audio/probe-870ce864358f765f538a11d06ddf22fcb43d2659.json","bytes":199},{"file":"project-card/08b7f97b53334bc8","bytes":224},{"file":"thumbnails/a7204bd52b8cd31e.png","bytes":6528},{"file":"thumbnails/b8ddaa3daf6f9bdc.jpg","bytes":7370},{"file":"timeline/filmstrip","bytes":128},{"file":"project-card/08b7f97b53334bc8/frame-1.jpg","bytes":11770},{"file":"project-card/08b7f97b53334bc8/frame-2.jpg","bytes":12607},{"file":"project-card/08b7f97b53334bc8/frame-3.jpg","bytes":12294},{"file":"project-card/08b7f97b53334bc8/frame-4.jpg","bytes":12400},{"file":"project-card/08b7f97b53334bc8/frame-5.jpg","bytes":11922},{"file":"timeline/filmstrip/30680ef828bf4f8112fcb93837436f2c059a46ae.jpg","bytes":161906},{"file":"timeline/filmstrip/30680ef828bf4f8112fcb93837436f2c059a46ae.json","bytes":142}]
