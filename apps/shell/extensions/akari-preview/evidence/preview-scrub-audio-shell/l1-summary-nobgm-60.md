# preview scrub audio — L1 実測サマリ（合成純音・機械生成: scripts/analyze.mjs）

- 実行: 2026-09-12T02:15:16.123Z / Electron 39.8.7 / Apple M1 8 cores 16 GB / Node v26.3.0
- 断片 40 ms・AudioContext 48000 Hz（baseLatency 5.3 ms / outputLatency 32 ms）

| run | mode | pattern | 駆動 Hz 要求 / 実測 | **可聴率 %** | **断片開始間隔 p50 / p95 ms** | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 古い音 % | 無音 % / 10ms 途切れ | クリック 総数 / 素材由来 / artifact（最大 Δ） | 断片長 p50 / min ms（窓） | renderer / gpu / audio CPU % | played / skipped | lastError |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nobgm-off-a-30hz | off | a | 30 / – | **0** | – / – | – / – (0/0) | – / – | –% / –% | – | 100 / 1 | 0 / 0 / **0** (0) | – / – (–) | 60.1 / 27.9 / 1.1 | 0 / 0 | – |
| nobgm-muted-a-30hz | muted | a | 30 / 29.9 | **0** | – / – | – / – (0/19) | – / – | 0% / 0% | – | 100 / 1 | 0 / 0 / **0** (0) | – / – (–) | 64.1 / 28.4 / 1 | 0 / 284 | – |
| nobgm-playing-a-30hz | playing | a | 30 / 30.1 | **0** | – / – | – / – (0/19) | – / – | 0% / 0% | – | 100 / 1 | 0 / 0 / **0** (0) | – / – (–) | 68.5 / 31.4 / 0.8 | 0 / 285 | – |
| nobgm-on-a-30hz | on | a | 30 / 30 | **97.5** | 32 / 64 | 7.7 / 47 (19/19) | 5 / 21 | 100% / 0% | 0.1 | 2.5 / 9 | 0 / 0 / **0** (0.056) | 40 / 40 (149.3) | 82.7 / 32.6 / 1.2 | 271 / 14 | – |
| nobgm-on-b-30hz | on | b | 30 / 29.9 | **94.6** | 32 / 58.7 | 17 / 30.3 (46/50) | 15.7 / 26.3 | 97.8% / 0% | 0 | 5.4 / 2 | 0 / 0 / **0** (0.054) | 40 / 40 (149.3) | 71 / 25.4 / 0.9 | 80 / 10 | – |
| nobgm-on-c-30hz | on | c | 30 / 30 | **100** | 32 / 48 | 8.3 / 88.7 (35/36) | 5 / 15.7 | 100% / 0% | 0 | 0 / 0 | 0 / 0 / **0** (0.054) | 40 / 30.6 (213.3) | 58.9 / 24.5 / 0.8 | 179 / 1 | – |
| nobgm-on-a-60hz | on | a | 60 / 59.7 | **99.9** | 16 / 21.3 | 8 / 113 (19/19) | 5 / 5 | 100% / 0% | 0.2 | 0.1 / 0 | 0 / 0 / **0** (0.056) | 40 / 40 (149.3) | 118.5 / 39.6 / 1 | 568 / 0 | – |
| nobgm-on-c-60hz | on | c | 60 / 58.4 | **95** | 16 / 32 | 7.7 / 122.7 (35/36) | 5 / 10.3 | 100% / 0% | 0 | 5 / 3 | 0 / 0 / **0** (0.055) | 40 / 24 (149.3) | 103.3 / 35.2 / 1.1 | 316 / 35 | – |
| nobgm-on-f-60hz | on | f | 60 / 54 | **48.4** | 69.3 / 432 | 17.3 / 239.7 (12/55) | 5 / 31.7 | 53.6% / 0% | 0 | 51.6 / 7 | 0 / 0 / **0** (0.054) | 40 / 40 (149.3) | 57.7 / 14.6 / 0.9 | 9 / 47 | – |
| nobgm-on-d-60hz | on | d | 60 / 58.3 | **77.4** | 74.7 / 90.7 | 50.7 / 221.3 (22/29) | 5 / 63.7 | 75.9% / 0% | 0 | 22.6 / 5 | 0 / 0 / **0** (0.054) | 40 / 34.7 (149.3) | 36.3 / 11.1 / 0.8 | 8 / 21 | – |

- 遅延（録音）= seek 到達（ページ側 audioContext.currentTime・onSeek ラップで記録）→ 期待半音と完全一致する最初の 21 ms 分析窓の中心。期待半音が直前の seek と変わる seek だけを数える（found / n）。アプリ予約 = 到達 → 本編断片の BufferSource.start(when) の差
- 音程一致 = seek 到達から 300 ms 以内に期待半音 ±1 の音が出た seek の割合（手順 5）。古い音 = 可聴フレームのうち直近 250 ms のどの seek の音程にも合わないもの
- 駆動 Hz = 要求（実マウスの送出レート）/ 実測（onSeek 到達間隔から。アプリの rAF 間引きを通った後の実効レート）。可聴率 = 駆動区間の 5 ms フレームのうち RMS ≥ 0.01 の割合（無音 % の裏返し）。断片開始間隔 = 本編断片の BufferSource.start(when) の差分
- 無音 % = 駆動区間の 5 ms フレームのうち RMS < 0.01。クリック = 隣接サンプル差 > 0.2 の個数（純音の最大差は 0.06）。素材由来 = 素材（ffmpeg で 48 kHz mono に復号した参照）の同じ位置 ±2 ms に同等以上（差 −0.05 まで）の隣接差があるもの（声の過渡）。artifact = 素材に無い不連続 = 断片の継ぎ目で生じたクリック

| run | HTTP 要求 合計 | media Range 取得（fetch / media 要素） | media 全量取得 | moov 相当（fetch Range > 8 KB） | preview-audio API | sidecar .pcm | その他 |
|---|---|---|---|---|---|---|---|
| （開いた時〜ready） | 13 | 4 (3 / 1) | 0 | 1 | 0 | 0 | 9 |
| nobgm-off-a-30hz | 2 | 2 (0 / 2) | 0 | 0 | 0 | 0 | 0 |
| nobgm-muted-a-30hz | 3 | 3 (0 / 3) | 0 | 0 | 0 | 0 | 0 |
| nobgm-playing-a-30hz | 3 | 3 (0 / 3) | 0 | 0 | 0 | 0 | 0 |
| nobgm-on-a-30hz | 1051 | 1051 (1048 / 3) | 0 | 0 | 0 | 0 | 0 |
| nobgm-on-b-30hz | 617 | 617 (615 / 2) | 0 | 0 | 0 | 0 | 0 |
| nobgm-on-c-30hz | 313 | 313 (313 / 0) | 0 | 0 | 0 | 0 | 0 |
| nobgm-on-a-60hz | 921 | 921 (920 / 1) | 0 | 0 | 0 | 0 | 0 |
| nobgm-on-c-60hz | 463 | 463 (463 / 0) | 0 | 0 | 0 | 0 | 0 |
| nobgm-on-f-60hz | 237 | 237 (226 / 11) | 0 | 0 | 0 | 0 | 0 |
| nobgm-on-d-60hz | 99 | 99 (64 / 35) | 0 | 0 | 0 | 0 | 0 |
| **全体（開いた時〜終了）** | 3722 | 3713 (3652 / 61) | 0 | 1 | 0 | 0 | 9 |

- HTTP 要求 = webview が出した要求（CDP Network.requestWillBeSent）。media Range = `/assets/*.mp4|m4a` への `Range:` 付き要求（fetch = スクラブ音の moov / 断片取得、media 要素 = `<video>` の部分取得）。moov 相当 = fetch 由来で 8 KB を超える Range（断片は約 1.3 KB・box ヘッダ探索は 16 B）。src ごとに 1 回なら全体で 1。sidecar .pcm / preview-audio API が 0 なら前処理の産物に触っていない
- moov 取得の実体: /media/<id> bytes=32-53393 (@727.6 ms)
- 後始末: {"electronPid":38483,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingShellBackend":0}
- プロジェクト配下キャッシュ（前処理の有無）: [{"file":".gitignore","bytes":2},{"file":"preview-audio","bytes":128},{"file":"project-card","bytes":96},{"file":"thumbnails","bytes":96},{"file":"timeline","bytes":96},{"file":"preview-audio/cfcf9bb03905d9af11b9d119f1065567a25c3321.flac","bytes":3746699},{"file":"preview-audio/cfcf9bb03905d9af11b9d119f1065567a25c3321.json","bytes":255},{"file":"project-card/eec46395122be5e1","bytes":224},{"file":"thumbnails/f0f254320f9096bf.jpg","bytes":7370},{"file":"timeline/filmstrip","bytes":128},{"file":"project-card/eec46395122be5e1/frame-1.jpg","bytes":11770},{"file":"project-card/eec46395122be5e1/frame-2.jpg","bytes":12607},{"file":"project-card/eec46395122be5e1/frame-3.jpg","bytes":12294},{"file":"project-card/eec46395122be5e1/frame-4.jpg","bytes":12400},{"file":"project-card/eec46395122be5e1/frame-5.jpg","bytes":11922},{"file":"timeline/filmstrip/d5db94b71b02d5755f0fd8b7b8075e716571abb0.jpg","bytes":161906},{"file":"timeline/filmstrip/d5db94b71b02d5755f0fd8b7b8075e716571abb0.json","bytes":142}]
