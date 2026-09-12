# preview scrub audio — 速いドラッグ対応 L1 実測サマリ（機械生成: scripts/summarize-shell.mjs）

- Electron 39.8.7 / Apple M1 8 cores 16 GB / Node v26.3.0。seek = 実マウスでタイムライン widget のプレイヘッドをドラッグ・断片 40 ms・AudioContext 48000 Hz
- セッション: `nobgm-60` = legacy `<video>` 経路・BGM なし（30 / 60 Hz 駆動）/ `nobgm-120` = 同・**vsync 解除で 120 Hz 駆動** / `bgm-60` = legacy・BGM あり / `engine-60` = frame-engine 経路 / `real-60` = 声入りの実写（先頭 60 s・音声パケットは原本のまま）
- パターン: `a` ゆっくり（0→19 s を 9.5 s・×2）/ `b` 速い（0→50 s を 3 s・×16.7）/ `c` 往復（30↔35 s を 6 s・×5）/ **`f` 全長 1 秒走査（0→59 s を 1 s・×59）** / **`d` 全長 0.5 秒往復（0→59→0 s を 0.5 s・×236）** / `r` 実写ゆっくり

| run | セッション | mode | 駆動 Hz 要求 / 実測 | **可聴率 %** | **断片開始間隔 p50 / p95 ms** | 遅延 p50 / p95 ms（録音） | 音程一致 本編 / BGM | クリック 総数 / 素材由来 / **artifact** | played / skipped | 断片 start 数 | scrub fetch p50 / p90 / p99 ms | 窓 Range p50 / max B | Range 要求 scrub / engine / media 要素 | 全量 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nobgm-off-a-30hz | nobgm-60 | off | 30 / – | **0** | – / – | – / – (0/0) | –% / –% | 0 / 0 / **0** | 0 / 0 | 0 | – / – / – | – / – | 0 / 0 / 2 | 0 |
| nobgm-muted-a-30hz | nobgm-60 | muted | 30 / 29.9 | **0** | – / – | – / – (0/19) | 0% / 0% | 0 / 0 / **0** | 0 / 284 | 0 | – / – / – | – / – | 0 / 0 / 3 | 0 |
| nobgm-playing-a-30hz | nobgm-60 | playing | 30 / 30.1 | **0** | – / – | – / – (0/19) | 0% / 0% | 0 / 0 / **0** | 0 / 285 | 0 | – / – / – | – / – | 0 / 0 / 3 | 0 |
| nobgm-on-a-30hz | nobgm-60 | on | 30 / 30 | **97.5** | 32 / 64 | 7.7 / 47 (19/19) | 100% / 0% | 0 / 0 / **0** | 271 / 14 | 271 | 6.5 / 17.1 / 46.5 | 375 / 807 | 1048 / 0 / 3 | 0 |
| nobgm-on-b-30hz | nobgm-60 | on | 30 / 29.9 | **94.6** | 32 / 58.7 | 17 / 30.3 (46/50) | 97.8% / 0% | 0 / 0 / **0** | 80 / 10 | 80 | 5.3 / 13.8 / 42.1 | 373 / 828 | 615 / 0 / 2 | 0 |
| nobgm-on-c-30hz | nobgm-60 | on | 30 / 30 | **100** | 32 / 48 | 8.3 / 88.7 (35/36) | 100% / 0% | 0 / 0 / **0** | 179 / 1 | 179 | 6.4 / 11.9 / 54.4 | 381 / 828 | 313 / 0 / 0 | 0 |
| nobgm-on-a-60hz | nobgm-60 | on | 60 / 59.7 | **99.9** | 16 / 21.3 | 8 / 113 (19/19) | 100% / 0% | 0 / 0 / **0** | 568 / 0 | 568 | 5.8 / 12.2 / 30.8 | 381 / 807 | 920 / 0 / 1 | 0 |
| nobgm-on-c-60hz | nobgm-60 | on | 60 / 58.4 | **95** | 16 / 32 | 7.7 / 122.7 (35/36) | 100% / 0% | 0 / 0 / **0** | 316 / 35 | 316 | 7.1 / 22.7 / 116.1 | 368 / 828 | 463 / 0 / 0 | 0 |
| nobgm-on-f-60hz | nobgm-60 | on | 60 / 54 | **48.4** | 69.3 / 432 | 17.3 / 239.7 (12/55) | 53.6% / 0% | 0 / 0 / **0** | 9 / 47 | 9 | 5.8 / 28.7 / 124.4 | 384 / 807 | 226 / 0 / 11 | 0 |
| nobgm-on-d-60hz | nobgm-60 | on | 60 / 58.3 | **77.4** | 74.7 / 90.7 | 50.7 / 221.3 (22/29) | 75.9% / 0% | 0 / 0 / **0** | 8 / 21 | 8 | 13.9 / 30.6 / 37.8 | 367 / 754 | 64 / 0 / 35 | 0 |
| （nobgm-60: 開いた時〜ready） | nobgm-60 | – | – | – | – | – | – | – | – | – | 1.3 / 109.6 / – | – | 3 / 0 / 1 | 0 (bgm 資産 0・sidecar 0) |
| nobgm-on-a-120hz | nobgm-120 | on | 120 / 105.8 | **95.7** | 10.7 / 21.3 | 15 / 39.7 (19/19) | 99.3% / 0% | 0 / 0 / **0** | 831 / 178 | 831 | 9.5 / 33.6 / 199.2 | 373 / 807 | 1091 / 0 / 2 | 0 |
| nobgm-on-f-120hz | nobgm-120 | on | 120 / 108.9 | **41.3** | 53.3 / 330.7 | 31.7 / 255 (15/58) | 61.5% / 0% | 0 / 0 / **0** | 9 / 100 | 9 | 4.9 / 28.8 / 91.4 | 374 / 828 | 468 / 0 / 11 | 0 |
| nobgm-on-d-120hz | nobgm-120 | on | 120 / 112.9 | **68.8** | 74.7 / 122.7 | 68.7 / 254.7 (28/57) | 49.1% / 0% | 0 / 0 / **0** | 7 / 50 | 7 | 5.6 / 22.2 / 59.4 | 368 / 796 | 255 / 0 / 62 | 0 |
| （nobgm-120: 開いた時〜ready） | nobgm-120 | – | – | – | – | – | – | – | – | – | 0.9 / 49.3 / – | – | 3 / 0 / 1 | 0 (bgm 資産 0・sidecar 0) |
| bgm-on-a-30hz | bgm-60 | on | 30 / 30 | **98.3** | 32 / 58.7 | 5.3 / 21.7 (19/19) | 100% / 100% | 0 / 0 / **0** | 277 / 8 | 277 | 5.1 / 10.2 / 28.8 | 375 / 807 | 1074 / 0 / 2 | 0 |
| bgm-on-f-60hz | bgm-60 | on | 60 / 58.5 | **70.3** | 69.3 / 186.7 | 19 / 218.3 (20/58) | 78% / 93.2% | 0 / 0 / **0** | 13 / 46 | 13 | 5.5 / 16.8 / 83.4 | 367 / 807 | 234 / 0 / 3 | 0 |
| （bgm-60: 開いた時〜ready） | bgm-60 | – | – | – | – | – | – | – | – | – | 29.7 / 64.5 / – | – | 3 / 0 / 1 | 0 (bgm 資産 1・sidecar 0) |
| engine-on-a-30hz | engine-60 | on | 30 / 27.3 | **79.3** | 32 / 74.7 | 7.3 / 121.3 (16/19) | 93.4% / 0% | 0 / 0 / **0** | 219 / 40 | 219 | 6.4 / 30 / 104.4 | 380 / 796 | 937 / 509 / 0 | 0 |
| engine-on-f-60hz | engine-60 | on | 60 / 56.1 | **79** | 69.3 / 101.3 | 18.3 / 217.7 (23/56) | 86% / 0% | 0 / 0 / **0** | 15 / 42 | 15 | 4.6 / 9.3 / 25.6 | 364 / 810 | 237 / 182 / 0 | 0 |
| （engine-60: 開いた時〜ready） | engine-60 | – | – | – | – | – | – | – | – | – | 10.6 / 36.4 / – | – | 3 / 19 / 0 | 0 (bgm 資産 2・sidecar 0) |
| real-on-r-30hz | real-60 | on | 30 / 30 | **49.3** | 32 / 53.3 | – / – | –（実素材） | 1 / 0 / **1** | 283 / 2 | 283 | 2.4 / 4 / 7.6 | 1575 / 2594 | 310 / 0 / 0 | 0 |
| real-on-f-60hz | real-60 | on | 60 / 58.8 | **30** | 69.3 / 85.3 | – / – | –（実素材） | 0 / 0 / **0** | 15 / 44 | 15 | 2.5 / 6.1 / 7.6 | 1562 / 2141 | 41 / 0 / 0 | 0 |
| （real-60: 開いた時〜ready） | real-60 | – | – | – | – | – | – | – | – | – | 6.5 / 18.9 / – | – | 3 / 0 / 1 | 0 (bgm 資産 0・sidecar 0) |

- 駆動 Hz 要求 = 実マウスの mousemove 送出レート。実測 = webview の `onSeek` 到達間隔から出した実効レート（アプリの rAF 間引きを通った後）。`nobgm-120` だけ Chromium の vsync / フレームレート上限を外して 120 Hz を通した
- **可聴率** = 駆動区間［最初の seek, 最後の seek + 50 ms］の 5 ms フレームのうち RMS ≥ 0.01 の割合。**断片開始間隔** = 本編断片の `BufferSource.start(when)` の差分（等間隔性）
- **実写（real-*）は素材そのものに無音区間（声の間）があるため、可聴率・断片開始間隔の受け入れ判定の対象外**（クリックと前処理なしの確認だけを行う）
- 音程一致 = seek 到達から 300 ms 以内に期待半音 ±1 の音が出た seek の割合。速いドラッグでは間引きが入るため「鳴った seek の割合（played）」は下がるが、可聴率と等間隔性で評価する
- 窓 Range = スクラブ音が断片のために取る Range のバイト数（moov 取得と box ヘッダ探索 16 B を除く）。moov は `Mp4AudioTrack#open()` の「16 B の box ヘッダ読み → 大きい 1 本」でしか起きないので、その並びで判定する

## 受け入れ条件の機械照合

| 判定 | 項目 | 実測 |
|---|---|---|
| ✅ | nobgm-off-a-30hz: 録音が無音（peak 0） | peak=0 |
| ✅ | nobgm-off-a-30hz: 断片 start 0 | starts=0 |
| ✅ | nobgm-off-a-30hz: 設定 OFF で onSeek が呼ばれない | seeks=0 |
| ✅ | nobgm-off-a-30hz: 設定 OFF で scrub 由来の fetch 0 | fetch=0 |
| ✅ | nobgm-muted-a-30hz: 録音が無音（peak 0） | peak=0 |
| ✅ | nobgm-muted-a-30hz: 断片 start 0 | starts=0 |
| ✅ | nobgm-muted-a-30hz: onSeek は届くが鳴らさない | seeks=284 played=0 |
| ✅ | nobgm-playing-a-30hz: 録音が無音（peak 0） | peak=0 |
| ✅ | nobgm-playing-a-30hz: 断片 start 0 | starts=0 |
| ✅ | nobgm-playing-a-30hz: onSeek は届くが鳴らさない | seeks=285 played=0 |
| ✅ | nobgm-on-a-30hz: 【30 Hz 退行なし】音程一致 ≥ 99%（本編） | 100% |
| ✅ | nobgm-on-a-30hz: 【30 Hz 退行なし】遅延 p50 ≤ 40 ms | 7.7 ms |
| ✅ | nobgm-on-a-30hz: artifact クリック 0 | 0 |
| ✅ | nobgm-on-a-30hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | nobgm-on-a-30hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | nobgm-on-a-30hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=807 B / p50=375 B |
| ✅ | nobgm-on-a-30hz: 断片長 40 ms | 40 / 40 |
| ❌ | nobgm-on-b-30hz: 【30 Hz 退行なし】音程一致 ≥ 99%（本編） | 97.8% |
| ✅ | nobgm-on-b-30hz: 【30 Hz 退行なし】遅延 p50 ≤ 40 ms | 17 ms |
| ✅ | nobgm-on-b-30hz: artifact クリック 0 | 0 |
| ✅ | nobgm-on-b-30hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | nobgm-on-b-30hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | nobgm-on-b-30hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=828 B / p50=373 B |
| ✅ | nobgm-on-b-30hz: 断片長 40 ms | 40 / 40 |
| ✅ | nobgm-on-c-30hz: 【30 Hz 退行なし】音程一致 ≥ 99%（本編） | 100% |
| ✅ | nobgm-on-c-30hz: 【30 Hz 退行なし】遅延 p50 ≤ 40 ms | 8.3 ms |
| ✅ | nobgm-on-c-30hz: artifact クリック 0 | 0 |
| ✅ | nobgm-on-c-30hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | nobgm-on-c-30hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | nobgm-on-c-30hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=828 B / p50=381 B |
| ❌ | nobgm-on-c-30hz: 断片長 40 ms | 40 / 30.6 |
| ✅ | nobgm-on-a-60hz: 【ゆっくり = 現行水準】音程一致 ≥ 99%（本編） | 100% |
| ✅ | nobgm-on-a-60hz: artifact クリック 0 | 0 |
| ✅ | nobgm-on-a-60hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | nobgm-on-a-60hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | nobgm-on-a-60hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=807 B / p50=381 B |
| ✅ | nobgm-on-a-60hz: 断片長 40 ms | 40 / 40 |
| ✅ | nobgm-on-c-60hz: artifact クリック 0 | 0 |
| ✅ | nobgm-on-c-60hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | nobgm-on-c-60hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | nobgm-on-c-60hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=828 B / p50=368 B |
| ❌ | nobgm-on-c-60hz: 断片長 40 ms | 40 / 24 |
| ❌ | nobgm-on-f-60hz: 【60 Hz・全長 1 秒走査】可聴率 ≥ 70% | 48.4% |
| ❌ | nobgm-on-f-60hz: 【60 Hz・全長 1 秒走査】断片開始間隔 p95 ≤ 150 ms | 432 ms |
| ✅ | nobgm-on-f-60hz: 【60 Hz・全長 1 秒走査】artifact クリック 0 | 0 |
| ✅ | nobgm-on-f-60hz: artifact クリック 0 | 0 |
| ✅ | nobgm-on-f-60hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | nobgm-on-f-60hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | nobgm-on-f-60hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=807 B / p50=384 B |
| ✅ | nobgm-on-f-60hz: 断片長 40 ms | 40 / 40 |
| ✅ | nobgm-on-d-60hz: artifact クリック 0 | 0 |
| ✅ | nobgm-on-d-60hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | nobgm-on-d-60hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | nobgm-on-d-60hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=754 B / p50=367 B |
| ❌ | nobgm-on-d-60hz: 断片長 40 ms | 40 / 34.7 |
| ✅ | nobgm-60: 開いた時の moov 取得が src ごとに 1 回 | moovFetch=1 ([{"at":727.6,"path":"/media/<id>","range":"bytes=32-53393","ms":1.3}]) |
| ✅ | nobgm-60: scrub 由来の全量取得 0（開いた時〜終了） | scrubFull=0 |
| ✅ | nobgm-60: 既定 ON（initial scrubAudioEnabled=true・controller enabled） | {"initial":true,"enabled":true} |
| ✅ | nobgm-60: 後始末（Electron 残存 0・shell backend 残存 0） | {"electronPid":38483,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingShellBackend":0} |
| ✅ | nobgm-60: BGM なし（previewAudio null）でも scrub の AudioContext が立つ | {"previewAudio":false,"contextState":"running"} |
| ✅ | nobgm-on-a-120hz: 【120 Hz 駆動】可聴率 ≥ 60% | 95.7% |
| ✅ | nobgm-on-a-120hz: 【120 Hz 駆動】artifact クリック 0 | 0 |
| ✅ | nobgm-on-a-120hz: artifact クリック 0 | 0 |
| ✅ | nobgm-on-a-120hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | nobgm-on-a-120hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | nobgm-on-a-120hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=807 B / p50=373 B |
| ✅ | nobgm-on-a-120hz: 断片長 40 ms | 40 / 40 |
| ❌ | nobgm-on-f-120hz: 【120 Hz 駆動】可聴率 ≥ 60% | 41.3% |
| ✅ | nobgm-on-f-120hz: 【120 Hz 駆動】artifact クリック 0 | 0 |
| ✅ | nobgm-on-f-120hz: artifact クリック 0 | 0 |
| ✅ | nobgm-on-f-120hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | nobgm-on-f-120hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | nobgm-on-f-120hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=828 B / p50=374 B |
| ✅ | nobgm-on-f-120hz: 断片長 40 ms | 40 / 40 |
| ✅ | nobgm-on-d-120hz: 【120 Hz 駆動】可聴率 ≥ 60% | 68.8% |
| ✅ | nobgm-on-d-120hz: 【120 Hz 駆動】artifact クリック 0 | 0 |
| ✅ | nobgm-on-d-120hz: artifact クリック 0 | 0 |
| ✅ | nobgm-on-d-120hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | nobgm-on-d-120hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | nobgm-on-d-120hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=796 B / p50=368 B |
| ❌ | nobgm-on-d-120hz: 断片長 40 ms | 40 / 37.3 |
| ✅ | nobgm-120: 開いた時の moov 取得が src ごとに 1 回 | moovFetch=1 ([{"at":544.2,"path":"/media/<id>","range":"bytes=32-53393","ms":0.9}]) |
| ✅ | nobgm-120: scrub 由来の全量取得 0（開いた時〜終了） | scrubFull=0 |
| ✅ | nobgm-120: 既定 ON（initial scrubAudioEnabled=true・controller enabled） | {"initial":true,"enabled":true} |
| ✅ | nobgm-120: 後始末（Electron 残存 0・shell backend 残存 0） | {"electronPid":96802,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingShellBackend":0} |
| ✅ | nobgm-120: BGM なし（previewAudio null）でも scrub の AudioContext が立つ | {"previewAudio":false,"contextState":"running"} |
| ✅ | bgm-on-a-30hz: 【30 Hz 退行なし】音程一致 ≥ 99%（本編） | 100% |
| ✅ | bgm-on-a-30hz: 【30 Hz 退行なし】遅延 p50 ≤ 40 ms | 5.3 ms |
| ✅ | bgm-on-a-30hz: 音程一致 ≥ 99%（BGM 断片） | 100% |
| ✅ | bgm-on-a-30hz: artifact クリック 0 | 0 |
| ✅ | bgm-on-a-30hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | bgm-on-a-30hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | bgm-on-a-30hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=807 B / p50=375 B |
| ✅ | bgm-on-a-30hz: 断片長 40 ms | 40 / 40 |
| ✅ | bgm-on-f-60hz: 【60 Hz・全長 1 秒走査】可聴率 ≥ 70% | 70.3% |
| ❌ | bgm-on-f-60hz: 【60 Hz・全長 1 秒走査】断片開始間隔 p95 ≤ 150 ms | 186.7 ms |
| ✅ | bgm-on-f-60hz: 【60 Hz・全長 1 秒走査】artifact クリック 0 | 0 |
| ✅ | bgm-on-f-60hz: artifact クリック 0 | 0 |
| ✅ | bgm-on-f-60hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | bgm-on-f-60hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | bgm-on-f-60hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=807 B / p50=367 B |
| ✅ | bgm-on-f-60hz: 断片長 40 ms | 40 / 40 |
| ✅ | bgm-60: 開いた時の moov 取得が src ごとに 1 回 | moovFetch=1 ([{"at":644.1,"path":"/media/<id>","range":"bytes=32-53393","ms":7.8}]) |
| ✅ | bgm-60: scrub 由来の全量取得 0（開いた時〜終了） | scrubFull=0 |
| ✅ | bgm-60: 既定 ON（initial scrubAudioEnabled=true・controller enabled） | {"initial":true,"enabled":true} |
| ✅ | bgm-60: 後始末（Electron 残存 0・shell backend 残存 0） | {"electronPid":97722,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingShellBackend":0} |
| ✅ | bgm-60: scrub は legacy の音声グラフ（previewAudio）と同じ AudioContext を共有 | {"shared":true,"bgmDuration":60} |
| ❌ | engine-on-a-30hz: 【30 Hz 退行なし】音程一致 ≥ 99%（本編） | 93.4% |
| ✅ | engine-on-a-30hz: 【30 Hz 退行なし】遅延 p50 ≤ 40 ms | 7.3 ms |
| ✅ | engine-on-a-30hz: artifact クリック 0 | 0 |
| ✅ | engine-on-a-30hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | engine-on-a-30hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | engine-on-a-30hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=796 B / p50=380 B |
| ✅ | engine-on-a-30hz: 断片長 40 ms | 40 / 40 |
| ✅ | engine-on-f-60hz: 【60 Hz・全長 1 秒走査】可聴率 ≥ 70% | 79% |
| ✅ | engine-on-f-60hz: 【60 Hz・全長 1 秒走査】断片開始間隔 p95 ≤ 150 ms | 101.3 ms |
| ✅ | engine-on-f-60hz: 【60 Hz・全長 1 秒走査】artifact クリック 0 | 0 |
| ✅ | engine-on-f-60hz: artifact クリック 0 | 0 |
| ✅ | engine-on-f-60hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | engine-on-f-60hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | engine-on-f-60hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=810 B / p50=364 B |
| ✅ | engine-on-f-60hz: 断片長 40 ms | 40 / 40 |
| ✅ | engine-60: 開いた時の moov 取得が src ごとに 1 回 | moovFetch=1 ([{"at":1305.4,"path":"/media/<id>","range":"bytes=32-53393","ms":3}]) |
| ✅ | engine-60: scrub 由来の全量取得 0（開いた時〜終了） | scrubFull=0 |
| ✅ | engine-60: 既定 ON（initial scrubAudioEnabled=true・controller enabled） | {"initial":true,"enabled":true} |
| ✅ | engine-60: 後始末（Electron 残存 0・shell backend 残存 0） | {"electronPid":98281,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingShellBackend":0} |
| ✅ | engine-60: frame-engine 経路 ON で同じ配線が動く | {"frameEngineActive":true,"played":[219,15]} |
| ❌ | real-on-r-30hz: artifact クリック 0 | 1 |
| ✅ | real-on-r-30hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | real-on-r-30hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | real-on-r-30hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=2594 B / p50=1575 B |
| ✅ | real-on-r-30hz: 断片長 40 ms | 40 / 40 |
| ✅ | real-on-f-60hz: artifact クリック 0 | 0 |
| ✅ | real-on-f-60hz: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | real-on-f-60hz: run 中に moov の再取得なし（box ヘッダ探索 0） | moov=0 boxProbe=0 |
| ✅ | real-on-f-60hz: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB） | max=2141 B / p50=1562 B |
| ❌ | real-on-f-60hz: 断片長 40 ms | 40 / 28.6 |
| ✅ | real-60: 開いた時の moov 取得が src ごとに 1 回 | moovFetch=1 ([{"at":533.3,"path":"/media/<id>","range":"bytes=32-69750","ms":1.7}]) |
| ✅ | real-60: scrub 由来の全量取得 0（開いた時〜終了） | scrubFull=0 |
| ✅ | real-60: 既定 ON（initial scrubAudioEnabled=true・controller enabled） | {"initial":true,"enabled":true} |
| ✅ | real-60: 後始末（Electron 残存 0・shell backend 残存 0） | {"electronPid":99939,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingShellBackend":0} |
| ✅ | 録音 wav の合計 ≤ 20 MB | 11.6 MB |
| ✅ | 録音 wav が各 ≤ 10 s | max 10 s |

- 合格 131 / 143
