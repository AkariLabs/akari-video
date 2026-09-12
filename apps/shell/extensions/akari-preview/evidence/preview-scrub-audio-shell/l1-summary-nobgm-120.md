# preview scrub audio — L1 実測サマリ（合成純音・機械生成: scripts/analyze.mjs）

- 実行: 2026-09-12T01:31:32.281Z / Electron 39.8.7 / Apple M1 8 cores 16 GB / Node v26.3.0
- 断片 40 ms・AudioContext 48000 Hz（baseLatency 5.3 ms / outputLatency 32 ms）・vsync 解除（120 Hz 駆動用）

| run | mode | pattern | 駆動 Hz 要求 / 実測 | **可聴率 %** | **断片開始間隔 p50 / p95 ms** | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 古い音 % | 無音 % / 10ms 途切れ | クリック 総数 / 素材由来 / artifact（最大 Δ） | 断片長 p50 / min ms（窓） | renderer / gpu / audio CPU % | played / skipped | lastError |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nobgm-on-a-120hz | on | a | 120 / 105.8 | **95.7** | 10.7 / 21.3 | 15 / 39.7 (19/19) | 5 / 10.3 | 99.3% / 0% | 5.1 | 4.3 / 4 | 0 / 0 / **0** (0.055) | 40 / 40 (149.3) | 166.4 / 53.5 / 1.2 | 831 / 178 | – |
| nobgm-on-f-120hz | on | f | 120 / 108.9 | **41.3** | 53.3 / 330.7 | 31.7 / 255 (15/58) | 7.7 / 37 | 61.5% / 0% | 0 | 58.7 / 5 | 0 / 0 / **0** (0.051) | 40 / 40 (149.3) | 62.8 / 17.5 / 0.6 | 9 / 100 | – |
| nobgm-on-d-120hz | on | d | 120 / 112.9 | **68.8** | 74.7 / 122.7 | 68.7 / 254.7 (28/57) | 10.3 / 21 | 49.1% / 0% | 0 | 31.2 / 5 | 0 / 0 / **0** (0.054) | 40 / 37.3 (149.3) | 45.5 / 12.9 / 0.8 | 7 / 50 | – |

- 遅延（録音）= seek 到達（ページ側 audioContext.currentTime・onSeek ラップで記録）→ 期待半音と完全一致する最初の 21 ms 分析窓の中心。期待半音が直前の seek と変わる seek だけを数える（found / n）。アプリ予約 = 到達 → 本編断片の BufferSource.start(when) の差
- 音程一致 = seek 到達から 300 ms 以内に期待半音 ±1 の音が出た seek の割合（手順 5）。古い音 = 可聴フレームのうち直近 250 ms のどの seek の音程にも合わないもの
- 駆動 Hz = 要求（実マウスの送出レート）/ 実測（onSeek 到達間隔から。アプリの rAF 間引きを通った後の実効レート）。可聴率 = 駆動区間の 5 ms フレームのうち RMS ≥ 0.01 の割合（無音 % の裏返し）。断片開始間隔 = 本編断片の BufferSource.start(when) の差分
- 無音 % = 駆動区間の 5 ms フレームのうち RMS < 0.01。クリック = 隣接サンプル差 > 0.2 の個数（純音の最大差は 0.06）。素材由来 = 素材（ffmpeg で 48 kHz mono に復号した参照）の同じ位置 ±2 ms に同等以上（差 −0.05 まで）の隣接差があるもの（声の過渡）。artifact = 素材に無い不連続 = 断片の継ぎ目で生じたクリック

| run | HTTP 要求 合計 | media Range 取得（fetch / media 要素） | media 全量取得 | moov 相当（fetch Range > 8 KB） | preview-audio API | sidecar .pcm | その他 |
|---|---|---|---|---|---|---|---|
| （開いた時〜ready） | 13 | 4 (3 / 1) | 0 | 1 | 0 | 0 | 9 |
| nobgm-on-a-120hz | 1093 | 1093 (1091 / 2) | 0 | 0 | 0 | 0 | 0 |
| nobgm-on-f-120hz | 479 | 479 (468 / 11) | 0 | 0 | 0 | 0 | 0 |
| nobgm-on-d-120hz | 317 | 317 (255 / 62) | 0 | 0 | 0 | 0 | 0 |
| **全体（開いた時〜終了）** | 1902 | 1893 (1817 / 76) | 0 | 1 | 0 | 0 | 9 |

- HTTP 要求 = webview が出した要求（CDP Network.requestWillBeSent）。media Range = `/assets/*.mp4|m4a` への `Range:` 付き要求（fetch = スクラブ音の moov / 断片取得、media 要素 = `<video>` の部分取得）。moov 相当 = fetch 由来で 8 KB を超える Range（断片は約 1.3 KB・box ヘッダ探索は 16 B）。src ごとに 1 回なら全体で 1。sidecar .pcm / preview-audio API が 0 なら前処理の産物に触っていない
- moov 取得の実体: /media/<id> bytes=32-53393 (@544.2 ms)
- 後始末: {"electronPid":96802,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingShellBackend":0}
- プロジェクト配下キャッシュ（前処理の有無）: [{"file":".gitignore","bytes":2},{"file":"preview-audio","bytes":128},{"file":"project-card","bytes":96},{"file":"thumbnails","bytes":96},{"file":"timeline","bytes":96},{"file":"preview-audio/56a9bdae1a849604a6529e44ec0bd4d2f53cfe3c.flac","bytes":3746699},{"file":"preview-audio/56a9bdae1a849604a6529e44ec0bd4d2f53cfe3c.json","bytes":255},{"file":"project-card/587a535bbd8b6900","bytes":224},{"file":"thumbnails/02b6164924f0bd2d.jpg","bytes":7370},{"file":"timeline/filmstrip","bytes":128},{"file":"project-card/587a535bbd8b6900/frame-1.jpg","bytes":11770},{"file":"project-card/587a535bbd8b6900/frame-2.jpg","bytes":12607},{"file":"project-card/587a535bbd8b6900/frame-3.jpg","bytes":12294},{"file":"project-card/587a535bbd8b6900/frame-4.jpg","bytes":12400},{"file":"project-card/587a535bbd8b6900/frame-5.jpg","bytes":11922},{"file":"timeline/filmstrip/1202749fc736a5b133c23e99e4fdfd9a0109cab1.jpg","bytes":161906},{"file":"timeline/filmstrip/1202749fc736a5b133c23e99e4fdfd9a0109cab1.json","bytes":142}]
