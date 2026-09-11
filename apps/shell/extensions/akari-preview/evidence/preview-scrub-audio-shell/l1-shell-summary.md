# preview scrub audio — shell 配線 L1 実測サマリ（機械生成: scripts/summarize-shell.mjs）

- Electron 39.8.7 / Apple M1 8 cores 16 GB / Node v26.3.0。seek = 実マウスでタイムライン widget のプレイヘッドをドラッグ（30 Hz）・断片 40 ms・AudioContext 48000 Hz
- 構成: nobgm = legacy `<video>` 経路・BGM なし / bgm = legacy・BGM あり / engine = frame-engine 経路 ON（BGM あり。BGM 断片は対象外 — engine の音声供給は shell 側に AudioBuffer を持たない）/ real = legacy・声入りの実写（先頭 60 s・音声パケットは原本のまま）

| run | 構成 | mode | pattern | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 無音 % / 10ms 途切れ | クリック 総数 / 素材由来 / **artifact** | played / skipped | scrub fetch p50 / p90 / p99 ms | Range 要求 scrub / engine / media 要素 | 全量取得 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nobgm-off-a | nobgm | off | a | – / – (0/0) | – / – | –% / –% | 100 / 1 | 0 / 0 / **0** | 0 / 0 | – / – / – | 0 / 0 / 2 | 0 |
| nobgm-muted-a | nobgm | muted | a | – / – (0/19) | – / – | 0% / 0% | 100 / 1 | 0 / 0 / **0** | 0 / 285 | – / – / – | 0 / 0 / 3 | 0 |
| nobgm-playing-a | nobgm | playing | a | – / – (0/19) | – / – | 0% / 0% | 100 / 1 | 0 / 0 / **0** | 0 / 285 | – / – / – | 0 / 0 / 3 | 0 |
| nobgm-on-a | nobgm | on | a | 3.7 / 36.3 (19/19) | 10.3 / 21 | 100% / 0% | 0.4 / 2 | 0 / 0 / **0** | 284 / 1 | 5.2 / 8.1 / 12.4 | 679 / 0 / 4 | 0 |
| nobgm-on-b | nobgm | on | b | 17.3 / 25.7 (47/50) | 15.7 / 26.3 | 100% / 0% | 3.8 / 6 | 0 / 0 / **0** | 84 / 6 | 5 / 8.9 / 30.6 | 435 / 0 / 2 | 0 |
| nobgm-on-c | nobgm | on | c | 10.7 / 83.3 (34/36) | 15.7 / 21 | 100% / 0% | 1.6 / 4 | 0 / 0 / **0** | 174 / 6 | 5.3 / 8.5 / 17.6 | 691 / 0 / 0 | 0 |
| （nobgm: 開いた時〜ready） | nobgm | – | – | – | – | – | – | – | – | 7.8 / 17.1 / – | 3 / 0 / 1 | 0 (bgm 資産 0・sidecar 0) |
| bgm-on-a | bgm | on | a | 11.7 / 25.7 (19/19) | 10.3 / 26.3 | 100% / 100% | 3.1 / 8 | 0 / 0 / **0** | 273 / 12 | 5.9 / 9.8 / 34.5 | 699 / 0 / 2 | 0 |
| bgm-on-b | bgm | on | b | 17 / 57 (45/50) | 15.7 / 31.7 | 98.9% / 98.9% | 12.9 / 8 | 0 / 0 / **0** | 75 / 15 | 6 / 16.7 / 104.2 | 435 / 0 / 3 | 0 |
| bgm-on-c | bgm | on | c | 15 / 73 (34/36) | 15.7 / 26.3 | 100% / 100% | 2.2 / 6 | 0 / 0 / **0** | 175 / 5 | 5.4 / 8.8 / 20.3 | 691 / 0 / 0 | 0 |
| （bgm: 開いた時〜ready） | bgm | – | – | – | – | – | – | – | – | 3.4 / 8.9 / – | 3 / 0 / 1 | 0 (bgm 資産 1・sidecar 0) |
| engine-on-a | engine | on | a | 12.3 / 55 (19/19) | 5 / 21 | 100% / 0% | 3.8 / 12 | 0 / 0 / **0** | 265 / 20 | 5.3 / 10.1 / 36.8 | 702 / 568 / 0 | 0 |
| engine-on-b | engine | on | b | 17 / 41 (50/50) | 15.7 / 26.3 | 100% / 0% | 4.3 / 5 | 0 / 0 / **0** | 86 / 4 | 4.9 / 10.3 / 20.8 | 428 / 473 / 0 | 0 |
| engine-on-c | engine | on | c | 16.7 / 36.7 (30/31) | 15.7 / 26.3 | 100% / 0% | 6 / 10 | 0 / 0 / **0** | 168 / 12 | 6.5 / 13.3 / 54 | 686 / 80 / 0 | 0 |
| （engine: 開いた時〜ready） | engine | – | – | – | – | – | – | – | – | 21.9 / 73.2 / – | 3 / 19 / 0 | 0 (bgm 資産 2・sidecar 0) |
| real-on-r | real | on | r | – / – | 10.3 / 21 | –（実素材） | 36.3 / 36 | 3 / 3 / **0** | 277 / 8 | 4.2 / 7.5 / 25.3 | 763 / 0 / 0 | 0 |
| （real: 開いた時〜ready） | real | – | – | – | – | – | – | – | – | 2.8 / 154.4 / – | 3 / 0 / 1 | 0 (bgm 資産 0・sidecar 0) |

- 遅延（録音）= seek 到達（webview 側 audioContext.currentTime・onSeek ラップで記録。タイムライン → host → postMessage → rAF 間引き → seekTimelineTime の後）→ 期待半音と完全一致する最初の 21 ms 分析窓の中心。アプリ予約 = 到達 → 本編断片の BufferSource.start(when)
- 音程一致 = seek 到達から 300 ms 以内に期待半音 ±1 の音が出た seek の割合。skipped = 次の seek に追い越されて断片を鳴らせなかった seek（最新の seek が勝つ設計。実マウスの 30 Hz は host 側の処理で 16 ms 間隔に詰まることがあり、その先行 seek は追い越される）
- scrub fetch = initiator が scrub-audio.js の Range 要求（CDP Network.requestWillBeSent → loadingFinished）。engine = frame-engine.js 由来の映像デコード用 Range（本票の対象外・既存挙動）。media 要素 = `<video>` の部分取得

## 受け入れ条件の機械照合

| 判定 | 項目 | 実測 |
|---|---|---|
| ✅ | nobgm-off-a: 録音が無音（peak 0） | peak=0 |
| ✅ | nobgm-off-a: 断片 start 0 | starts=0 |
| ✅ | nobgm-off-a: 設定 OFF で onSeek が呼ばれない | seeks=0 |
| ✅ | nobgm-off-a: 設定 OFF で scrub 由来の fetch 0 | fetch=0 |
| ✅ | nobgm-muted-a: 録音が無音（peak 0） | peak=0 |
| ✅ | nobgm-muted-a: 断片 start 0 | starts=0 |
| ✅ | nobgm-muted-a: onSeek は届くが鳴らさない | seeks=285 played=0 |
| ✅ | nobgm-playing-a: 録音が無音（peak 0） | peak=0 |
| ✅ | nobgm-playing-a: 断片 start 0 | starts=0 |
| ✅ | nobgm-playing-a: onSeek は届くが鳴らさない | seeks=285 played=0 |
| ✅ | nobgm-on-a: 音程一致 ≥ 99%（本編） | 100% |
| ✅ | nobgm-on-a: 遅延 p50 ≤ 50 ms（録音） | 3.7 ms |
| ✅ | nobgm-on-a: クリック（artifact）0 | 0 |
| ✅ | nobgm-on-a: run 中の scrub 要求がすべて Range（全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | nobgm-on-a: run 中に moov（8 KB 超の scrub Range）0 | 0 |
| ✅ | nobgm-on-a: 断片長 40 ms | 40 / 40 |
| ✅ | nobgm-on-b: 音程一致 ≥ 99%（本編） | 100% |
| ✅ | nobgm-on-b: 遅延 p50 ≤ 50 ms（録音） | 17.3 ms |
| ✅ | nobgm-on-b: クリック（artifact）0 | 0 |
| ✅ | nobgm-on-b: run 中の scrub 要求がすべて Range（全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | nobgm-on-b: run 中に moov（8 KB 超の scrub Range）0 | 0 |
| ✅ | nobgm-on-b: 断片長 40 ms | 40 / 40 |
| ✅ | nobgm-on-c: 音程一致 ≥ 99%（本編） | 100% |
| ✅ | nobgm-on-c: 遅延 p50 ≤ 50 ms（録音） | 10.7 ms |
| ✅ | nobgm-on-c: クリック（artifact）0 | 0 |
| ✅ | nobgm-on-c: run 中の scrub 要求がすべて Range（全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | nobgm-on-c: run 中に moov（8 KB 超の scrub Range）0 | 0 |
| ✅ | nobgm-on-c: 断片長 40 ms | 40 / 40 |
| ✅ | nobgm: 開いた時の moov 取得が src ごとに 1 回 | moovFetch=1 ([{"at":510.9,"path":"/media/<id>","range":"bytes=32-53393","ms":2.4}]) |
| ✅ | nobgm: scrub 由来の全量取得 0（開いた時〜終了） | scrubFull=0 |
| ✅ | nobgm: 既定 ON（initial scrubAudioEnabled=true・controller enabled） | {"initial":true,"enabled":true} |
| ✅ | nobgm: 後始末（Electron 残存 0・shell backend 残存 0） | {"electronPid":23711,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingShellBackend":0} |
| ✅ | nobgm: BGM なし（previewAudio null）でも scrub の AudioContext が立つ | {"previewAudio":false,"contextState":"running"} |
| ✅ | bgm-on-a: 音程一致 ≥ 99%（本編） | 100% |
| ✅ | bgm-on-a: 音程一致 ≥ 99%（BGM 断片） | 100% |
| ✅ | bgm-on-a: 遅延 p50 ≤ 50 ms（録音） | 11.7 ms |
| ✅ | bgm-on-a: クリック（artifact）0 | 0 |
| ✅ | bgm-on-a: run 中の scrub 要求がすべて Range（全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | bgm-on-a: run 中に moov（8 KB 超の scrub Range）0 | 0 |
| ✅ | bgm-on-a: 断片長 40 ms | 40 / 40 |
| ❌ | bgm-on-b: 音程一致 ≥ 99%（本編） | 98.9% |
| ❌ | bgm-on-b: 音程一致 ≥ 99%（BGM 断片） | 98.9% |
| ✅ | bgm-on-b: 遅延 p50 ≤ 50 ms（録音） | 17 ms |
| ✅ | bgm-on-b: クリック（artifact）0 | 0 |
| ✅ | bgm-on-b: run 中の scrub 要求がすべて Range（全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | bgm-on-b: run 中に moov（8 KB 超の scrub Range）0 | 0 |
| ✅ | bgm-on-b: 断片長 40 ms | 40 / 40 |
| ✅ | bgm-on-c: 音程一致 ≥ 99%（本編） | 100% |
| ✅ | bgm-on-c: 音程一致 ≥ 99%（BGM 断片） | 100% |
| ✅ | bgm-on-c: 遅延 p50 ≤ 50 ms（録音） | 15 ms |
| ✅ | bgm-on-c: クリック（artifact）0 | 0 |
| ✅ | bgm-on-c: run 中の scrub 要求がすべて Range（全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | bgm-on-c: run 中に moov（8 KB 超の scrub Range）0 | 0 |
| ✅ | bgm-on-c: 断片長 40 ms | 40 / 40 |
| ✅ | bgm: 開いた時の moov 取得が src ごとに 1 回 | moovFetch=1 ([{"at":558.3,"path":"/media/<id>","range":"bytes=32-53393","ms":8.9}]) |
| ✅ | bgm: scrub 由来の全量取得 0（開いた時〜終了） | scrubFull=0 |
| ✅ | bgm: 既定 ON（initial scrubAudioEnabled=true・controller enabled） | {"initial":true,"enabled":true} |
| ✅ | bgm: 後始末（Electron 残存 0・shell backend 残存 0） | {"electronPid":24783,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingShellBackend":0} |
| ✅ | bgm: scrub は legacy の音声グラフ（previewAudio）と同じ AudioContext を共有 | {"shared":true,"bgmDuration":60} |
| ✅ | engine-on-a: 音程一致 ≥ 99%（本編） | 100% |
| ✅ | engine-on-a: 遅延 p50 ≤ 50 ms（録音） | 12.3 ms |
| ✅ | engine-on-a: クリック（artifact）0 | 0 |
| ✅ | engine-on-a: run 中の scrub 要求がすべて Range（全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | engine-on-a: run 中に moov（8 KB 超の scrub Range）0 | 0 |
| ✅ | engine-on-a: 断片長 40 ms | 40 / 40 |
| ✅ | engine-on-b: 音程一致 ≥ 99%（本編） | 100% |
| ✅ | engine-on-b: 遅延 p50 ≤ 50 ms（録音） | 17 ms |
| ✅ | engine-on-b: クリック（artifact）0 | 0 |
| ✅ | engine-on-b: run 中の scrub 要求がすべて Range（全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | engine-on-b: run 中に moov（8 KB 超の scrub Range）0 | 0 |
| ✅ | engine-on-b: 断片長 40 ms | 40 / 40 |
| ✅ | engine-on-c: 音程一致 ≥ 99%（本編） | 100% |
| ✅ | engine-on-c: 遅延 p50 ≤ 50 ms（録音） | 16.7 ms |
| ✅ | engine-on-c: クリック（artifact）0 | 0 |
| ✅ | engine-on-c: run 中の scrub 要求がすべて Range（全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | engine-on-c: run 中に moov（8 KB 超の scrub Range）0 | 0 |
| ✅ | engine-on-c: 断片長 40 ms | 40 / 40 |
| ✅ | engine: 開いた時の moov 取得が src ごとに 1 回 | moovFetch=1 ([{"at":750.2,"path":"/media/<id>","range":"bytes=32-53393","ms":21.9}]) |
| ✅ | engine: scrub 由来の全量取得 0（開いた時〜終了） | scrubFull=0 |
| ✅ | engine: 既定 ON（initial scrubAudioEnabled=true・controller enabled） | {"initial":true,"enabled":true} |
| ✅ | engine: 後始末（Electron 残存 0・shell backend 残存 0） | {"electronPid":25387,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingShellBackend":0} |
| ✅ | engine: frame-engine 経路 ON で同じ配線が動く（frameEngineActive・controller・断片 start > 0） | {"frameEngineActive":true,"played":[265,86,168]} |
| ✅ | real-on-r: クリック（artifact）0 | 0 |
| ✅ | real-on-r: run 中の scrub 要求がすべて Range（全量 0・sidecar 0） | {"scrubFull":0,"sidecarPcm":0,"mediaFull":0} |
| ✅ | real-on-r: run 中に moov（8 KB 超の scrub Range）0 | 0 |
| ✅ | real-on-r: 断片長 40 ms | 40 / 40 |
| ✅ | real: 開いた時の moov 取得が src ごとに 1 回 | moovFetch=1 ([{"at":671.7,"path":"/media/<id>","range":"bytes=32-65837","ms":0.6}]) |
| ✅ | real: scrub 由来の全量取得 0（開いた時〜終了） | scrubFull=0 |
| ✅ | real: 既定 ON（initial scrubAudioEnabled=true・controller enabled） | {"initial":true,"enabled":true} |
| ✅ | real: 後始末（Electron 残存 0・shell backend 残存 0） | {"electronPid":28651,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingShellBackend":0} |
| ✅ | 録音 wav の合計 ≤ 20 MB・各 ≤ 10 s・16 bit | 9.4 MB |

- 合格 89 / 91
