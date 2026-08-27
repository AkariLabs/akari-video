# cuts パス実装・G1 実測レポート

このファイルは `npm run bench:cuts` の実走結果から更新される一次資料である。測定対象は
Electron 内の実 Chromium / WebCodecs / WebGL2 と、同じ入力を使う render-cut CLI。

## 条件

- upload path: requested=direct / effective=direct
- Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.265 Electron/39.8.7 Safari/537.36
- 390 frames / 13s / 1920×1080 / 30fps
- ratio 対象 3 runs（代表値 median、段階別 profile source run=2）
- v2/render-cut median=0.781 / cold run 除外 steady median=0.729
- 入力 SHA-256: `5165d51265a69862d249a34cd7e464e1a255de3401e481aaf2c4caec672f4f9c`（同一 bytes=true）。cuts は 3.25 秒 × 4、2 番目に transform を含む
- v2 最終出口: canvas → WebCodecs H.264（Annex B）→ ffmpeg copy mux
- 対照: render-cut `standard` / `videotoolbox`

## フェーズ状態

| phase | status | elapsed ms |
|---|---|---:|
| exportRawFfmpeg | 完了 | 12460.800 |
| exportWebCodecs | 完了 | 3127.640 |
| runRenderCut | 完了 | 4069.965 |
| psnr | 完了 | 962.990 |
| profileDecodeAndCache | 完了 | 1164.760 |
| gopAndWarmup | skipped: clip gop-warm-2 returned no video frame at 5966667us | 1773.045 |
| ipcComparison | 完了 | 228.110 |

skippedPhases:

- gopAndWarmup: clip gop-warm-2 returned no video frame at 5966667us

## 反復測定

| run | raw ffmpeg pipe before ms | WebCodecs after ms | render-cut ms | v2/render-cut |
|---:|---:|---:|---:|---:|
| 1 | 12398.685 | 3319.800 | 3917.987 | 0.847 |
| 2 | 12444.880 | 3109.560 | 3979.635 | 0.781 |
| 3 | 12329.880 | 2783.850 | 4114.661 | 0.677 |
| **minimum** | 12329.880 | 2783.850 | 3917.987 | 0.677 |
| **median** | 12398.685 | 3109.560 | 3979.635 | 0.781 |
| **maximum** | 12444.880 | 3319.800 | 4114.661 | 0.847 |

min=0.677〜max=0.847 は目標 1.0 を跨いでいない。

## ゴールデン（preview / export 自出口）

| 点 | 秒 | differing pixels | max delta | PNG SHA-256 | SHA prefix |
|---|---:|---:|---:|---|---|
| hard-cut-before | 0.900 | 0 | 0 | 一致 | `ec1a0e785e2a5bc3…` |
| hard-cut-after | 1.100 | 0 | 0 | 一致 | `fe557a1b03c449bb…` |
| speed-start | 1.250 | 0 | 0 | 一致 | `e5be7d343c00a969…` |
| speed-end | 1.750 | 0 | 0 | 一致 | `9f3366dfd9aea48f…` |
| framing-static | 2.500 | 0 | 0 | 一致 | `8034a52537527a09…` |
| zoom-start | 3.050 | 0 | 0 | 一致 | `0d58f071cbd2d83b…` |
| zoom-mid | 3.500 | 0 | 0 | 一致 | `531a5b630fab263b…` |
| zoom-end | 3.950 | 0 | 0 | 一致 | `4d133a1ce0ea5647…` |
| transform | 4.500 | 0 | 0 | 一致 | `733d8a2d6e73d2db…` |
| freeze-before | 5.200 | 0 | 0 | 一致 | `43e81ff9228ebb53…` |
| freeze-inside-a | 5.450 | 0 | 0 | 一致 | `2c34c1dc9bcaaca3…` |
| freeze-inside-b | 5.750 | 0 | 0 | 一致 | `2c34c1dc9bcaaca3…` |
| freeze-after | 6.200 | 0 | 0 | 一致 | `1111bc3ac188fcb5…` |
| dissolve-before | 7.160 | 0 | 0 | 一致 | `9521193e35ed7b8c…` |
| dissolve-mid | 7.350 | 0 | 0 | 一致 | `a8ef7bf4a3bb5243…` |
| dissolve-after | 7.540 | 0 | 0 | 一致 | `00f773912211a3b2…` |
| fade-black-before | 7.860 | 0 | 0 | 一致 | `14ea180fd23a60b4…` |
| fade-black-mid | 8.050 | 0 | 0 | 一致 | `3bacd02891ccf6de…` |
| fade-black-after | 8.240 | 0 | 0 | 一致 | `472f2a19014f94fa…` |
| fade-white-before | 8.560 | 0 | 0 | 一致 | `010ec03a6dcc30ac…` |
| fade-white-mid | 8.750 | 0 | 0 | 一致 | `09b6f9de5a7d61a5…` |
| fade-white-after | 8.940 | 0 | 0 | 一致 | `ad6d0f8db337fd24…` |
| reveal-down-before | 9.260 | 0 | 0 | 一致 | `2140330ad8d58647…` |
| reveal-down-mid | 9.450 | 0 | 0 | 一致 | `7a3a1f24c5ccbb8a…` |
| reveal-down-after | 9.640 | 0 | 0 | 一致 | `3fb738513311827a…` |
| reveal-up-before | 9.960 | 0 | 0 | 一致 | `9e72617a36564ed4…` |
| reveal-up-mid | 10.150 | 0 | 0 | 一致 | `4eba964431591860…` |
| reveal-up-after | 10.340 | 0 | 0 | 一致 | `9fb30bb3f0ea548c…` |

- 全点: **PASS**
- 否定側: differingPixels=1、comparatorPassed=false
- freeze 出力尺: 宣言 11.000s / ffprobe 11.000s
- freeze 内 2 点の PNG hash: `2c34c1dc9bcaaca3…` / `2c34c1dc9bcaaca3…`

## トランジション中間フレーム

| 点 | 全体 mean RGB | 上半分 mean RGB | 下半分 mean RGB | 上下距離 |
|---|---|---|---|---:|
| dissolve-mid | 123.003, 121.550, 123.032 | 120.192, 117.677, 117.681 | 125.815, 125.424, 128.384 | 14.359 |
| fade-black-mid | 0.000, 0.000, 0.000 | 0.000, 0.000, 0.000 | 0.000, 0.000, 0.000 | 0.000 |
| fade-white-mid | 255.000, 255.000, 255.000 | 255.000, 255.000, 255.000 | 255.000, 255.000, 255.000 | 0.000 |
| reveal-down-mid | 112.890, 119.500, 119.104 | 109.159, 121.523, 116.876 | 116.620, 117.478, 121.332 | 9.586 |
| reveal-up-mid | 127.379, 125.459, 128.011 | 127.927, 121.822, 131.451 | 126.831, 129.097, 124.570 | 10.074 |

dissolve は前後どちらとも異なる中間値、fade-black/white は進行率 0.5 で色プレート、
reveal は上下半分の距離と 2 入力 plan により前後カットの同居を判定する。

## 段階別プロファイル

| stage | class | relationship | count | p50 ms | p95 ms | max ms | per-frame contribution ms |
|---|---|---|---:|---:|---:|---:|---:|
| decode | inclusive | contains tick and decode overhead | 390 | 0.105 | 0.145 | 103.005 | — |
| tick | exclusive | part of decode | 389 | 0.040 | 0.055 | 21.730 | 0.040 |
| copy | inclusive | contains copyTo + planeCompact | 0 | — | — | — | — |
| copyTo | exclusive | part of copy | 0 | — | — | — | — |
| planeCompact | exclusive | part of copy | 0 | — | — | — | — |
| upload | exclusive | standalone compositor stage | 390 | 1.210 | 1.510 | 2.765 | 1.210 |
| shader | inclusive | CPU wall for shader submission/synchronization | 390 | 0.025 | 0.035 | 0.105 | — |
| shaderGpu | exclusive | GPU measurement corresponding to shader | 390 | 0.025 | 0.035 | 0.105 | 0.025 |
| present | exclusive | standalone stage | 0 | — | — | — | — |
| readback | inclusive | contains pboWait + rowFlip + buffer read | 390 | 10.980 | 11.905 | 16.735 | — |
| pboWait | exclusive | part of readback | 390 | 9.140 | 9.910 | 14.685 | 9.140 |
| rowFlip | exclusive | part of readback | 390 | 0.970 | 1.360 | 3.635 | 0.970 |
| sink | inclusive | contains ipcTransit + ipcWrite + ffmpegDrain | 390 | 18.020 | 20.970 | 150.990 | — |
| ipcWrite | exclusive | part of sink | 390 | 0.939 | 1.408 | 2.315 | 0.939 |
| ffmpegDrain | exclusive | part of sink | 390 | 4.003 | 5.715 | 135.151 | 4.003 |
| ffmpegClose | one-shot | once per export; excluded from per-frame ranking | 1 | 19.402 | 19.402 | 19.402 | — |
| ipcTransit | exclusive | derived part of sink | 390 | 13.078 | — | — | 13.078 |

inclusive は子段を含む wall、exclusive は per-frame ランキング対象、one-shot は export 全体で
一度だけ発生する後処理である。親子は二重計上しない。`ipcTransit` は
`sink.p50 - (ipcWrite.p50 + ffmpegDrain.p50)` = **13.078ms** として導出した。

### Exclusive per-frame 寄与ランキング

| rank | stage | count | p50 ms | p50 × count / frameCount ms |
|---:|---|---:|---:|---:|
| 1 | ipcTransit | 390 | 13.078 | 13.078 |
| 2 | pboWait | 390 | 9.140 | 9.140 |
| 3 | ffmpegDrain | 390 | 4.003 | 4.003 |
| 4 | upload | 390 | 1.210 | 1.210 |
| 5 | rowFlip | 390 | 0.970 | 0.970 |
| 6 | ipcWrite | 390 | 0.939 | 0.939 |
| 7 | tick | 389 | 0.040 | 0.040 |
| 8 | shaderGpu | 390 | 0.025 | 0.025 |

支配段は **ipcTransit = 13.078ms/frame**（p50=13.078ms、count=390）。

### One-shot

| stage | count | p50 ms |
|---|---:|---:|
| ffmpegClose | 1 | 19.402 |

one-shot は per-frame ランキングと per-frame 合計から除外する。

## 律速分離 5 計画

1. 段階別計時: 390 frames の inclusive / exclusive / one-shot と p50/p95 を上表へ記録。exclusive だけを per-frame 寄与で順位づけ。
2. decode 対照: full=430.900ms、事前 cache=327.040ms、decode 無し固定面=253.770ms、decode 比率=0.241、cache/full=0.759、fixed/full=0.589。
3. GOP / Lookahead / Warmup: skipped: clip gop-warm-2 returned no video frame at 5966667us。cut 境界ごとの直前 keyframe 距離は benchmark JSON の `details` に保存。
4. 8MB IPC: main invoke copy=12.750ms、main MessagePort copy=11.815ms、main SAB available=false（PROCESS_BOUNDARY_UNSUPPORTED: SharedArrayBuffer does not cross the renderer-to-main process boundary; MessagePortMain receives event.data as null）、Worker ArrayBuffer transfer=0.120ms、Worker SAB=0.135ms（available=true）。
5. encoder: raw RGBA→ffmpeg=12444.880ms、WebCodecs→copy mux=3109.560ms、after/before=0.250。

renderer → main の SharedArrayBuffer はプロセス境界を越えず、MessagePortMain では
`event.data` が null 化するため測定対象外（`available:false`）とした。共有メモリ系の
プロセス越え評価は Phase 4 の WebCodecs 出口評価へ送る。
8MB の renderer → main invoke copy と renderer → Worker ArrayBuffer transfer の実測比は
**106.250倍**。raw sink から導出した ipcTransit=13.078ms と
独立 IPC レーン invoke=12.750ms を相互検証し、8MB IPC を WebCodecs 最終出口から
外す改善の定量根拠とする。

## 改善の before / after

| 改善 | before ms | after ms | delta ms | after/before | evidence |
|---|---:|---:|---:|---:|---|
| WebCodecs direct surface export | 12398.685 | 3109.560 | -9289.125 | 0.251 | repeated-run medians on the same surface path: before includes RGBA readback, 8MB/frame renderer-to-main copy, and raw ffmpeg pipe; after uses WebCodecs H.264 plus copy mux |

- profile source run (2) render-cut: 3979.635ms
- **最終 v2/render-cut（median）= 0.781**（min=0.677 / max=0.847）
- encoded cross-engine PSNR sanity: average=25.062dB（pixel equality の判定には使用しない）

**G1 GO**。median 最終比 0.781 は目標 `v2/render-cut ≤ 1.0` を満たした。



## 律速の結論

raw path から readback・8MB/frame IPC・raw pipe encode をまとめて外せる WebCodecs path を採用した。
decode は cut ID ごとの独立 lane（同じ parsed MP4 backing store から fork）へ分け、transition の
outgoing / incoming が同じ MP4Clip 状態を交互 seek しない。直前 VideoFrame の表示区間内要求は
所有 clone から返し、freeze の sub-frame 時刻で decoder cursor を不要に進めない。
plane compact は stride が既に tight な native plane では view を返し、texture は初回確保後
`texSubImage2D` で再利用する。WebCodecs 直結時は surface consumer が同期点になるため
per-frame `gl.finish` を `gl.flush` へ替え、profile / golden の GPU timer 経路だけ finish を維持する。
最終 surface path（tick + copyTo + compact + upload + shader GPU）の p50 積算 × 390 frames は
497.210ms、WebCodecs 最終 wall との差（encode queue / chunk IPC / mux / scheduling）は
2612.350ms。未達時の物理床根拠と G2 裁定はこの二つを分けて扱う。

## timeline-map カーネルへの freeze 昇格素案

現在は frame-engine の `buildResolvedTimelinePlan` が、(1) freeze 分を source range に換算して
仮想 cut 尺を伸ばす、(2) その列を `buildTimelineMap` へ渡して transition overlap を解決する、
(3) `playbackSecondsAt` で出力秒を「前進→静止→前進」の区分写像へ戻す、の 3 段を担う。

G2 で共有カーネルへ上げる場合は、`packages/edit-store/src/timeline-map.ts` の
`buildTimelineMap` に freeze-aware duration provider を追加し、`TimelineSegment` に
`sourceTimeAt(outputT)` 相当の宣言データ（freezeAt / freezeDuration）を持たせ、
`outputToSource` の線形式を区分写像へ拡張する。transition window はこの拡張後の segment
境界から作る。gap/track 併用時に「後続をどの track cursor だけずらすか」を先に裁定し、
現行の明示例外を無言許容へ変えないことが昇格条件である。

## 既知差分

- render-cut の crop / perspective にある 1px 量子化・区分保持は引き継がず、GPU 上で連続補間する。
- transform の回転は固定 output canvas 内でクリップする。ffmpeg の拡大 bounding box を経由しない。
- cross-engine は encode 後 PSNR の sanity のみ。preview/export 自出口だけを pixel diff 0 / PNG SHA-256 一致で判定する。
