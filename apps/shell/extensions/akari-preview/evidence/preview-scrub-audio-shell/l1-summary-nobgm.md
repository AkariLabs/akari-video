# preview scrub audio — L1 実測サマリ（合成純音・機械生成: scripts/analyze.mjs）

- 実行: 2026-09-11T15:06:07.847Z / Electron 39.8.7 / Apple M1 8 cores 16 GB / Node v26.3.0
- seek 30 Hz・断片 40 ms・AudioContext 48000 Hz（baseLatency 5.3 ms / outputLatency 32 ms）

| run | mode | pattern | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 古い音 % | 無音 % / 10ms 途切れ | クリック 総数 / 素材由来 / artifact（最大 Δ） | 断片長 p50 / min ms（窓） | renderer / gpu / audio CPU % | played / skipped | lastError |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nobgm-off-a | off | a | – / – (0/0) | – / – | –% / –% | – | 100 / 1 | 0 / 0 / **0** (0) | – / – (–) | 57.1 / 26.1 / 1 | 0 / 0 | – |
| nobgm-muted-a | muted | a | – / – (0/19) | – / – | 0% / 0% | – | 100 / 1 | 0 / 0 / **0** (0) | – / – (–) | 58 / 25.6 / 0.9 | 0 / 285 | – |
| nobgm-playing-a | playing | a | – / – (0/19) | – / – | 0% / 0% | – | 100 / 1 | 0 / 0 / **0** (0) | – / – (–) | 65.4 / 29.8 / 0.9 | 0 / 285 | – |
| nobgm-on-a | on | a | 3.7 / 36.3 (19/19) | 10.3 / 21 | 100% / 0% | 0.3 | 0.4 / 2 | 0 / 0 / **0** (0.055) | 40 / 40 (149.3) | 69.4 / 27.6 / 1.1 | 284 / 1 | – |
| nobgm-on-b | on | b | 17.3 / 25.7 (47/50) | 15.7 / 26.3 | 100% / 0% | 0 | 3.8 / 6 | 0 / 0 / **0** (0.054) | 40 / 40 (149.3) | 62.9 / 22.8 / 0.9 | 84 / 6 | – |
| nobgm-on-c | on | c | 10.7 / 83.3 (34/36) | 15.7 / 21 | 100% / 0% | 0 | 1.6 / 4 | 0 / 0 / **0** (0.054) | 40 / 40 (149.3) | 68.8 / 25.9 / 0.9 | 174 / 6 | – |

- 遅延（録音）= seek 到達（ページ側 audioContext.currentTime・onSeek ラップで記録）→ 期待半音と完全一致する最初の 21 ms 分析窓の中心。期待半音が直前の seek と変わる seek だけを数える（found / n）。アプリ予約 = 到達 → 本編断片の BufferSource.start(when) の差
- 音程一致 = seek 到達から 300 ms 以内に期待半音 ±1 の音が出た seek の割合（手順 5）。古い音 = 可聴フレームのうち直近 250 ms のどの seek の音程にも合わないもの
- 無音 % = 駆動区間の 5 ms フレームのうち RMS < 0.01。クリック = 隣接サンプル差 > 0.2 の個数（純音の最大差は 0.06）。素材由来 = 素材（ffmpeg で 48 kHz mono に復号した参照）の同じ位置 ±2 ms に同等以上（差 −0.05 まで）の隣接差があるもの（声の過渡）。artifact = 素材に無い不連続 = 断片の継ぎ目で生じたクリック

| run | HTTP 要求 合計 | media Range 取得（fetch / media 要素） | media 全量取得 | moov 相当（fetch Range > 8 KB） | preview-audio API | sidecar .pcm | その他 |
|---|---|---|---|---|---|---|---|
| （開いた時〜ready） | 13 | 4 (3 / 1) | 0 | 1 | 0 | 0 | 9 |
| nobgm-off-a | 2 | 2 (0 / 2) | 0 | 0 | 0 | 0 | 0 |
| nobgm-muted-a | 3 | 3 (0 / 3) | 0 | 0 | 0 | 0 | 0 |
| nobgm-playing-a | 3 | 3 (0 / 3) | 0 | 0 | 0 | 0 | 0 |
| nobgm-on-a | 683 | 683 (679 / 4) | 0 | 0 | 0 | 0 | 0 |
| nobgm-on-b | 437 | 437 (435 / 2) | 0 | 0 | 0 | 0 | 0 |
| nobgm-on-c | 691 | 691 (691 / 0) | 0 | 0 | 0 | 0 | 0 |
| **全体（開いた時〜終了）** | 1832 | 1823 (1808 / 15) | 0 | 1 | 0 | 0 | 9 |

- HTTP 要求 = webview が出した要求（CDP Network.requestWillBeSent）。media Range = `/assets/*.mp4|m4a` への `Range:` 付き要求（fetch = スクラブ音の moov / 断片取得、media 要素 = `<video>` の部分取得）。moov 相当 = fetch 由来で 8 KB を超える Range（断片は約 1.3 KB・box ヘッダ探索は 16 B）。src ごとに 1 回なら全体で 1。sidecar .pcm / preview-audio API が 0 なら前処理の産物に触っていない
- moov 取得の実体: /media/<id> bytes=32-53393 (@510.9 ms)
- 後始末: {"electronPid":23711,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingShellBackend":0}
- プロジェクト配下キャッシュ（前処理の有無）: [{"file":".gitignore","bytes":2},{"file":"preview-audio","bytes":128},{"file":"project-card","bytes":96},{"file":"thumbnails","bytes":96},{"file":"timeline","bytes":96},{"file":"preview-audio/387b9042d399b7ec1665e2e8933640d347b9c521.flac","bytes":3746699},{"file":"preview-audio/387b9042d399b7ec1665e2e8933640d347b9c521.json","bytes":255},{"file":"project-card/4ce24024dae82ce6","bytes":224},{"file":"thumbnails/75b0a59c0a2e50cb.jpg","bytes":7370},{"file":"timeline/filmstrip","bytes":128},{"file":"project-card/4ce24024dae82ce6/frame-1.jpg","bytes":11770},{"file":"project-card/4ce24024dae82ce6/frame-2.jpg","bytes":12607},{"file":"project-card/4ce24024dae82ce6/frame-3.jpg","bytes":12294},{"file":"project-card/4ce24024dae82ce6/frame-4.jpg","bytes":12400},{"file":"project-card/4ce24024dae82ce6/frame-5.jpg","bytes":11922},{"file":"timeline/filmstrip/8be0e416712965bcbc37ab655f61e4acaeabf4a4.jpg","bytes":161906},{"file":"timeline/filmstrip/8be0e416712965bcbc37ab655f61e4acaeabf4a4.json","bytes":142}]
