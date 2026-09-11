# preview scrub audio — L1 実測サマリ（合成純音・機械生成: scripts/analyze.mjs）

- 実行: 2026-09-11T13:12:01.085Z / Electron 39.8.7 / Apple M1 8 cores 16 GB / Node v26.3.0
- seek 30 Hz・断片 40 ms・AudioContext 48000 Hz（baseLatency 5.3 ms / outputLatency 34 ms）

| run | mode | pattern | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 古い音 % | 無音 % / 10ms 途切れ | クリック 総数 / 素材由来 / artifact（最大 Δ） | 断片長 p50 / min ms（窓） | renderer / gpu / audio CPU % | played / skipped | lastError |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| off-a | off | a | – / – (0/20) | – / – | 0% / 0% | – | – / 0 | 0 / 0 / **0** (0) | – / – (–) | 32 / 21.2 / 0.5 | 0 / 300 | – |
| off-b | off | b | – / – (0/90) | – / – | 0% / 0% | – | 100 / 0 | 0 / 0 / **0** (0) | – / – (–) | 28.1 / 12.9 / 0.2 | 0 / 90 | – |
| off-c | off | c | – / – (0/31) | – / – | 0% / 0% | – | 100 / 1 | 0 / 0 / **0** (0) | – / – (–) | 30.1 / 18.8 / 0 | 0 / 180 | – |
| off-d | off | d (5 Hz) | – / – (0/20) | – / – | 0% / 0% | – | – / 0 | 0 / 0 / **0** (0) | – / – (–) | 12.3 / 6 / 0.2 | 0 / 20 | – |
| on-a | on | a | 14 / 18 (20/20) | 10.3 / 15.7 | 99.3% / 99.3% | 0 | 0.1 / 0 | 0 / 0 / **0** (0.061) | 40 / 40 (149.3) | 39.6 / 20.8 / 0.8 | 300 / 0 | – |
| on-b | on | b | 14 / 20 (90/90) | 10.3 / 15.7 | 100% / 100% | 0 | 0 / 0 | 0 / 0 / **0** (0.058) | 40 / 40 (149.3) | 33.7 / 11.8 / 0.9 | 90 / 0 | – |
| on-c | on | c | 14.7 / 20 (31/31) | 10.3 / 15.7 | 100% / 100% | 0 | 0 / 0 | 0 / 0 / **0** (0.061) | 40 / 40 (149.3) | 40.3 / 18.8 / 0.8 | 180 / 0 | – |
| on-d | on | d (5 Hz) | 9 / 14 (20/20) | 10.3 / 15.7 | 100% / 100% | 0 | 69.4 / 19 | 0 / 0 / **0** (0.061) | 40 / 40 (149.3) | 15 / 6 / 0.8 | 20 / 0 | – |

- 遅延（録音）= seek 到達（ページ側 audioContext.currentTime・onSeek ラップで記録）→ 期待半音と完全一致する最初の 21 ms 分析窓の中心。期待半音が直前の seek と変わる seek だけを数える（found / n）。アプリ予約 = 到達 → 本編断片の BufferSource.start(when) の差
- 音程一致 = seek 到達から 300 ms 以内に期待半音 ±1 の音が出た seek の割合（手順 5）。古い音 = 可聴フレームのうち直近 250 ms のどの seek の音程にも合わないもの
- 無音 % = 駆動区間の 5 ms フレームのうち RMS < 0.01。クリック = 隣接サンプル差 > 0.2 の個数（純音の最大差は 0.06）。素材由来 = 素材（ffmpeg で 48 kHz mono に復号した参照）の同じ位置 ±2 ms に同等以上（差 −0.05 まで）の隣接差があるもの（声の過渡）。artifact = 素材に無い不連続 = 断片の継ぎ目で生じたクリック

| run | HTTP 要求 合計 | media Range 取得（fetch / media 要素） | media 全量取得 | moov 相当（fetch Range > 8 KB） | preview-audio API | sidecar .pcm | その他 |
|---|---|---|---|---|---|---|---|
| （開いた時〜ready） | 90 | 55 (3 / 52) | 1 | 1 | 0 | 0 | 34 |
| off-a | 59 | 59 (0 / 59) | 0 | 0 | 0 | 0 | 0 |
| off-b | 186 | 186 (0 / 186) | 0 | 0 | 0 | 0 | 0 |
| off-c | 56 | 56 (0 / 56) | 0 | 0 | 0 | 0 | 0 |
| off-d | 81 | 81 (0 / 81) | 0 | 0 | 0 | 0 | 0 |
| on-a | 732 | 732 (713 / 19) | 0 | 0 | 0 | 0 | 0 |
| on-b | 566 | 566 (405 / 161) | 0 | 0 | 0 | 0 | 0 |
| on-c | 747 | 747 (691 / 56) | 0 | 0 | 0 | 0 | 0 |
| on-d | 177 | 177 (96 / 81) | 0 | 0 | 0 | 0 | 0 |
| **全体（開いた時〜終了）** | 2704 | 2669 (1918 / 751) | 1 | 1 | 0 | 0 | 34 |

- HTTP 要求 = webview が出した要求（CDP Network.requestWillBeSent）。media Range = `/assets/*.mp4|m4a` への `Range:` 付き要求（fetch = スクラブ音の moov / 断片取得、media 要素 = `<video>` の部分取得）。moov 相当 = fetch 由来で 8 KB を超える Range（断片は約 1.3 KB・box ヘッダ探索は 16 B）。src ごとに 1 回なら全体で 1。sidecar .pcm / preview-audio API が 0 なら前処理の産物に触っていない
- moov 取得の実体: /assets/main.mp4 bytes=32-157373 (@12014.4 ms)
- idle suspend（seek 後 30 s）: 1 s 後 state=running → 33 s 後 state=suspended、suspend 呼び出し あり（seek から 30024.2 ms）、次の seek で resume あり → state=running（断片 start 2 件）
- 後始末: {"electronPid":61248,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingElectronMainScript":0,"survivingShellBackend":0,"survivingPreviewServer":0}
- プロジェクト配下キャッシュ（前処理の有無）: [{"file":"preview-audio","bytes":224},{"file":"preview-audio/0b92ec942654137d0d1dd6ad01207d340b4ffcc2.json","bytes":297},{"file":"preview-audio/0b92ec942654137d0d1dd6ad01207d340b4ffcc2.pcm","bytes":8640000},{"file":"preview-audio/5d318fc6dd11bd81722e67eca35f82ca47e3f34e.json","bytes":297},{"file":"preview-audio/5d318fc6dd11bd81722e67eca35f82ca47e3f34e.pcm","bytes":8640000},{"file":"preview-audio/probe-8206c3718461c5ab12e66bd4af7838b175358fd3.json","bytes":194}]
