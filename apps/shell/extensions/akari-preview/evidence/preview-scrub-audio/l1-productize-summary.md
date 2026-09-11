# スクラブ音の製品化（C 案）— L1 実測サマリ（機械生成: scripts/summarize-productize.mjs）

- 合成純音: 2026-09-11T13:12:01.085Z / Electron 39.8.7 / Apple M1 8 cores / load 3.59 15.73 35.66
- 実素材: 2026-09-11T13:13:43.713Z / load 6.04 11.09 29.89 / 素材 ["video:h264(High) 1920x1080@30/1","audio:aac(LC) 44100 Hz 2 ch"]（元素材: video:hevc 1920x1080 + audio:aac 44100 Hz。ファイル名・パスは記録しない）
- 既定: mode=on / enabled=true（URL 指定なし）・AudioContext 48000 Hz・outputLatency 34 ms・断片 40 ms
- 公開面（window.akari.scrubAudio）: active, context, enabled, fragmentMs, lastError, mode, onPlaybackPaused, onSeek, prepare, stop

## 受け入れ条件の照合

| 判定 | 条件 | 実測 |
|---|---|---|
| ✅ | on-a: 音程一致（本編）≥ 99% | 99.3% |
| ✅ | on-a: 音程一致（BGM）≥ 99% | 99.3% |
| ✅ | on-a: クリック 0（素材に無い不連続） | artifact 0 / 候補 0（最大 Δ 0.061） |
| ✅ | on-a: 遅延 p50 ≤ 40 ms（録音） | 14 ms (p95 18) |
| ✅ | on-b: 音程一致（本編）≥ 99% | 100% |
| ✅ | on-b: 音程一致（BGM）≥ 99% | 100% |
| ✅ | on-b: クリック 0（素材に無い不連続） | artifact 0 / 候補 0（最大 Δ 0.058） |
| ✅ | on-b: 遅延 p50 ≤ 40 ms（録音） | 14 ms (p95 20) |
| ✅ | on-c: 音程一致（本編）≥ 99% | 100% |
| ✅ | on-c: 音程一致（BGM）≥ 99% | 100% |
| ✅ | on-c: クリック 0（素材に無い不連続） | artifact 0 / 候補 0（最大 Δ 0.061） |
| ✅ | on-c: 遅延 p50 ≤ 40 ms（録音） | 14.7 ms (p95 20) |
| ✅ | on-d（5 Hz・整数秒 seek）: 遅延 p95 ≤ 60 ms（elst 適用） | p50 9 / p95 14 / max 16.3 ms (20/20) |
| ✅ | on-d: 音程一致 100% とクリック 0 | 100% / artifact clicks 0 |
| ✅ | off-a: 無音（peak 0・断片 start 0・lastError なし） | peak 0 / played 0 / lastError – |
| ✅ | off-b: 無音（peak 0・断片 start 0・lastError なし） | peak 0 / played 0 / lastError – |
| ✅ | off-c: 無音（peak 0・断片 start 0・lastError なし） | peak 0 / played 0 / lastError – |
| ✅ | off-d: 無音（peak 0・断片 start 0・lastError なし） | peak 0 / played 0 / lastError – |
| ✅ | real-on-r: 10 秒のゆっくりドラッグ中にクリック 0（隣接サンプル差 > 0.2 のうち素材に無いもの） | artifact 0 / 候補 3（うち素材由来 3: Δ0.21@素材12.15735s(素材Δ0.245), Δ0.222@素材12.82081s(素材Δ0.235), Δ0.214@素材12.82106s(素材Δ0.235)・最大 Δ 0.222・peak 0.738・rms 0.083・無音 31.1%） |
| ✅ | real-on-r: 断片が鳴っている（played > 0・lastError なし） | played 300 / 300・lastError – |
| ✅ | real-off-r: 無音 | peak 0 / played 0 |
| ✅ | 合成: 本編の全量取得 0・sidecar .pcm 0・preview-audio API 0（開いた時〜終了） | 本編 full 0 / pcm 0 / api 0 / range 2669（fetch 1918）・既存の BGM 全量 fetch: GET /assets/bgm.m4a (Fetch) ×1 |
| ✅ | 合成: moov は src ごとに 1 回（fetch Range > 8 KB の回数 = 1） | 1 — /assets/main.mp4 bytes=32-157373 |
| ✅ | 合成: run 中の要求がすべて Range | off-a: 59 range / 0 full, off-b: 186 range / 0 full, off-c: 56 range / 0 full, off-d: 81 range / 0 full, on-a: 732 range / 0 full, on-b: 566 range / 0 full, on-c: 747 range / 0 full, on-d: 177 range / 0 full |
| ✅ | 合成: 失敗 run なし | 0 |
| ✅ | 合成: 後始末（Electron 残存 0・preview-server 残存 0） | {"electronPid":61248,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingElectronMainScript":0,"survivingShellBackend":0,"survivingPreviewServer":0} |
| ✅ | 実素材: 本編の全量取得 0・sidecar .pcm 0・preview-audio API 0（開いた時〜終了） | 本編 full 0 / pcm 0 / api 0 / range 829（fetch 791） |
| ✅ | 実素材: moov は src ごとに 1 回（fetch Range > 8 KB の回数 = 1） | 1 — /assets/main.mp4 bytes=32-65837 |
| ✅ | 実素材: run 中の要求がすべて Range | real-off-r: 15 range / 0 full, real-on-r: 795 range / 0 full |
| ✅ | 実素材: 失敗 run なし | 0 |
| ✅ | 実素材: 後始末（Electron 残存 0・preview-server 残存 0） | {"electronPid":62674,"electronExitCode":0,"electronSignal":null,"survivingElectronProcesses":0,"survivingElectronMainScript":0,"survivingShellBackend":0,"survivingPreviewServer":0} |
| ✅ | idle suspend: seek 後 30 s で suspend、次の seek で resume | 1 s 後 running → 33 s 後 suspended（suspend は seek から 30024.2 ms）→ 次の seek で resume true / state running / start 2 |

**すべて合格**（32 項目）

## 合成純音（1 秒ごとに半音上がる階段音 + BGM。詳細は l1-summary.md）

| run | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 無音 % / 10 ms 途切れ | クリック 候補 / 素材由来 / **artifact**（最大 Δ） | 断片長 p50 / min ms | renderer / gpu / audio CPU % | played / skipped | Range（fetch / media） | full / pcm | lastError |
|---|---|---|---|---|---|---|---|---|---|---|---|
| off-a | – / – (0/20) | – / – | 0% / 0% | – / 0 | 0 / 0 / **0** (0) | – / – | 32 / 21.2 / 0.5 | 0 / 300 | 59 (0 / 59) | 0 / 0 | – |
| off-b | – / – (0/90) | – / – | 0% / 0% | 100 / 0 | 0 / 0 / **0** (0) | – / – | 28.1 / 12.9 / 0.2 | 0 / 90 | 186 (0 / 186) | 0 / 0 | – |
| off-c | – / – (0/31) | – / – | 0% / 0% | 100 / 1 | 0 / 0 / **0** (0) | – / – | 30.1 / 18.8 / 0 | 0 / 180 | 56 (0 / 56) | 0 / 0 | – |
| off-d (5 Hz) | – / – (0/20) | – / – | 0% / 0% | – / 0 | 0 / 0 / **0** (0) | – / – | 12.3 / 6 / 0.2 | 0 / 20 | 81 (0 / 81) | 0 / 0 | – |
| on-a | 14 / 18 (20/20) | 10.3 / 15.7 | 99.3% / 99.3% | 0.1 / 0 | 0 / 0 / **0** (0.061) | 40 / 40 | 39.6 / 20.8 / 0.8 | 300 / 0 | 732 (713 / 19) | 0 / 0 | – |
| on-b | 14 / 20 (90/90) | 10.3 / 15.7 | 100% / 100% | 0 / 0 | 0 / 0 / **0** (0.058) | 40 / 40 | 33.7 / 11.8 / 0.9 | 90 / 0 | 566 (405 / 161) | 0 / 0 | – |
| on-c | 14.7 / 20 (31/31) | 10.3 / 15.7 | 100% / 100% | 0 / 0 | 0 / 0 / **0** (0.061) | 40 / 40 | 40.3 / 18.8 / 0.8 | 180 / 0 | 747 (691 / 56) | 0 / 0 | – |
| on-d (5 Hz) | 9 / 14 (20/20) | 10.3 / 15.7 | 100% / 100% | 69.4 / 19 | 0 / 0 / **0** (0.061) | 40 / 40 | 15 / 6 / 0.8 | 20 / 0 | 177 (96 / 81) | 0 / 0 | – |

## 実素材（声の入った実写 60 s・BGM なし。詳細は l1-summary-real.md）

| run | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 無音 % / 10 ms 途切れ | クリック 候補 / 素材由来 / **artifact**（最大 Δ） | 断片長 p50 / min ms | renderer / gpu / audio CPU % | played / skipped | Range（fetch / media） | full / pcm | lastError |
|---|---|---|---|---|---|---|---|---|---|---|---|
| real-off-r | – / – | – / – | – | – / 0 | 0 / 0 / **0** (0) | – / – | 22.4 / 18.7 / 0.4 | 0 / 300 | 15 (0 / 15) | 0 / 0 | – |
| real-on-r | – / – | 10.3 / 15.7 | – | 31.1 / 30 | 3 / 3 / **0** (0.222) | 40 / 40 | 32.4 / 19.4 / 0.9 | 300 / 0 | 795 (788 / 7) | 0 / 0 | – |

- 遅延（録音）= seek 到達 → 期待半音と完全一致する最初の 21 ms 解析窓の中心（窓半分 ≈ 10 ms + 5 ms フェードインを含む）。耳に届くまでは outputLatency が加わる
- 断片長 = 本編断片の `BufferSource.start(when, offset, duration)` の duration。4 パケット窓（≈ 85 ms）なので 40 ms が常に収まる（spike の 3 パケット窓では t がパケット後半にあると 21〜40 ms に切り詰められていた）
- クリック候補 = 録音の隣接サンプル差 > 0.2。素材由来 = 素材音声（ffmpeg で 48 kHz mono に復号した参照。ファイルは残さない）の同じ位置 ±2 ms に同等以上の隣接差があるもの（声の過渡）。**artifact = 素材に無い不連続 = 断片の継ぎ目のクリック**。受け入れ条件はこの artifact で判定する（純音では素材の最大差 0.06 なので候補 = artifact）
- 実素材の遅延・音程一致は測らない（純音ではないため）。無音 % = 駆動区間の 5 ms フレームのうち RMS < 0.01（声の間は自然に無音になる）
- idle suspend: {"stateAfter1s":"running","stateAfter33s":"suspended","suspendCalled":true,"suspendAfterSeekMs":30024.2,"lastError":null,"harnessSeekSentMsAgo":34510.5,"wake":{"stateAfterSeek":"running","resumeCalled":true,"starts":2,"seeks":1}}
