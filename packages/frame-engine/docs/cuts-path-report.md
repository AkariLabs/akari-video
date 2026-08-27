# cuts パス実装・G1 実測レポート

このファイルは `npm run bench:cuts` の実走結果から更新される一次資料である。測定対象は
Electron 内の実 Chromium / WebCodecs / WebGL2 と、同じ入力を使う render-cut CLI。

## 条件

- Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.265 Electron/39.8.7 Safari/537.36
- 390 frames / 13s / 1920×1080 / 30fps
- ratio 対象 3 runs（代表値 median、段階別 profile source run=3）
- 入力 SHA-256: `e2661cca140696615c2d928cf2d685274e74db07a48c9f2b750c3d73435811e2`（同一 bytes=true）。cuts は 3.25 秒 × 4、2 番目に transform を含む
- v2 最終出口: canvas → WebCodecs H.264（Annex B）→ ffmpeg copy mux
- 対照: render-cut `standard` / `videotoolbox`

## フェーズ状態

| phase | status | elapsed ms |
|---|---|---:|
| exportRawFfmpeg | 完了 | 11247.230 |
| exportWebCodecs | 完了 | 3365.775 |
| runRenderCut | 完了 | 4006.625 |
| psnr | 完了 | 861.690 |
| profileDecodeAndCache | 完了 | 1062.220 |
| gopAndWarmup | 完了 | 2659.705 |
| ipcComparison | 完了 | 202.260 |

skippedPhases:

- なし

## 反復測定

| run | raw ffmpeg pipe before ms | WebCodecs after ms | render-cut ms | v2/render-cut |
|---:|---:|---:|---:|---:|
| 1 | 11675.545 | 4130.785 | 3955.631 | 1.044 |
| 2 | 11402.960 | 3264.830 | 3890.014 | 0.839 |
| 3 | 11235.670 | 3353.200 | 3907.729 | 0.858 |
| **minimum** | 11235.670 | 3264.830 | 3890.014 | 0.839 |
| **median** | 11402.960 | 3353.200 | 3907.729 | 0.858 |
| **maximum** | 11675.545 | 4130.785 | 3955.631 | 1.044 |

**注意: min=0.839〜max=1.044 が目標 1.0 を跨いでいる。判定代表値は median=0.858 だが、run 間変動を併記して G2 で扱う。**

## ゴールデン（preview / export 自出口）

| 点 | 秒 | differing pixels | max delta | PNG SHA-256 | SHA prefix |
|---|---:|---:|---:|---|---|
| hard-cut-before | 0.900 | 0 | 0 | 一致 | `9ae2ae1d169cf1f5…` |
| hard-cut-after | 1.100 | 0 | 0 | 一致 | `581b9cae17a2254c…` |
| speed-start | 1.250 | 0 | 0 | 一致 | `2d1a8a999776a359…` |
| speed-end | 1.750 | 0 | 0 | 一致 | `7dd3ca391fddf0fe…` |
| framing-static | 2.500 | 0 | 0 | 一致 | `2bb729bef74550cf…` |
| zoom-start | 3.050 | 0 | 0 | 一致 | `dd8134b0515f7629…` |
| zoom-mid | 3.500 | 0 | 0 | 一致 | `b23326e55db78d85…` |
| zoom-end | 3.950 | 0 | 0 | 一致 | `75dca0ef9a6cd758…` |
| transform | 4.500 | 0 | 0 | 一致 | `2cc48d2b6dac8a45…` |
| freeze-before | 5.200 | 0 | 0 | 一致 | `fca0622c33e923f6…` |
| freeze-inside-a | 5.450 | 0 | 0 | 一致 | `f15ec32012d91c74…` |
| freeze-inside-b | 5.750 | 0 | 0 | 一致 | `f15ec32012d91c74…` |
| freeze-after | 6.200 | 0 | 0 | 一致 | `1fade4319fef774b…` |
| dissolve-before | 7.160 | 0 | 0 | 一致 | `363fd10433243790…` |
| dissolve-mid | 7.350 | 0 | 0 | 一致 | `5b66faef83248228…` |
| dissolve-after | 7.540 | 0 | 0 | 一致 | `0c864617dd722e1e…` |
| fade-black-before | 7.860 | 0 | 0 | 一致 | `22d6c29bbc921e9a…` |
| fade-black-mid | 8.050 | 0 | 0 | 一致 | `3bacd02891ccf6de…` |
| fade-black-after | 8.240 | 0 | 0 | 一致 | `a1a3560ee2c2e082…` |
| fade-white-before | 8.560 | 0 | 0 | 一致 | `cc82c2a1faf3d72f…` |
| fade-white-mid | 8.750 | 0 | 0 | 一致 | `09b6f9de5a7d61a5…` |
| fade-white-after | 8.940 | 0 | 0 | 一致 | `6af98cea66d1eb93…` |
| reveal-down-before | 9.260 | 0 | 0 | 一致 | `ae6aa062ed647197…` |
| reveal-down-mid | 9.450 | 0 | 0 | 一致 | `eb22b52851e34d36…` |
| reveal-down-after | 9.640 | 0 | 0 | 一致 | `3e22106a3e5ce628…` |
| reveal-up-before | 9.960 | 0 | 0 | 一致 | `e9bfc8650c736627…` |
| reveal-up-mid | 10.150 | 0 | 0 | 一致 | `12c9ad58b658670e…` |
| reveal-up-after | 10.340 | 0 | 0 | 一致 | `a7ca2df936fd43c4…` |

- 全点: **PASS**
- 否定側: differingPixels=1、comparatorPassed=false
- freeze 出力尺: 宣言 11.000s / ffprobe 11.000s
- freeze 内 2 点の PNG hash: `f15ec32012d91c74…` / `f15ec32012d91c74…`

## トランジション中間フレーム

| 点 | 全体 mean RGB | 上半分 mean RGB | 下半分 mean RGB | 上下距離 |
|---|---|---|---|---:|
| dissolve-mid | 123.706, 121.219, 123.857 | 120.927, 117.303, 118.513 | 126.485, 125.136, 129.202 | 14.370 |
| fade-black-mid | 0.000, 0.000, 0.000 | 0.000, 0.000, 0.000 | 0.000, 0.000, 0.000 | 0.000 |
| fade-white-mid | 255.000, 255.000, 255.000 | 255.000, 255.000, 255.000 | 255.000, 255.000, 255.000 | 0.000 |
| reveal-down-mid | 113.538, 119.272, 119.885 | 109.834, 121.261, 117.678 | 117.242, 117.284, 122.092 | 9.497 |
| reveal-up-mid | 128.094, 125.206, 128.822 | 128.662, 121.566, 132.219 | 127.526, 128.845, 125.424 | 10.022 |

dissolve は前後どちらとも異なる中間値、fade-black/white は進行率 0.5 で色プレート、
reveal は上下半分の距離と 2 入力 plan により前後カットの同居を判定する。

## 段階別プロファイル

| stage | class | relationship | count | p50 ms | p95 ms | max ms | per-frame contribution ms |
|---|---|---|---:|---:|---:|---:|---:|
| decode | inclusive | contains tick and decode overhead | 390 | 0.090 | 0.115 | 108.165 | — |
| tick | exclusive | part of decode | 387 | 0.030 | 0.035 | 101.515 | 0.030 |
| copy | inclusive | contains copyTo + planeCompact | 390 | 2.605 | 2.815 | 5.795 | — |
| copyTo | exclusive | part of copy | 390 | 2.550 | 2.750 | 5.740 | 2.550 |
| planeCompact | exclusive | part of copy | 390 | 0.000 | 0.005 | 0.010 | 0.000 |
| upload | exclusive | standalone compositor stage | 390 | 0.105 | 0.175 | 0.715 | 0.105 |
| shader | inclusive | CPU wall for shader submission/synchronization | 390 | 0.010 | 0.015 | 0.045 | — |
| shaderGpu | exclusive | GPU measurement corresponding to shader | 390 | 0.000 | 0.000 | 0.000 | 0.000 |
| readback | inclusive | contains pboWait + rowFlip + buffer read | 390 | 6.415 | 7.890 | 11.975 | — |
| pboWait | exclusive | part of readback | 390 | 4.615 | 4.775 | 9.375 | 4.615 |
| rowFlip | exclusive | part of readback | 390 | 0.980 | 1.225 | 2.425 | 0.980 |
| sink | inclusive | contains ipcTransit + ipcWrite + ffmpegDrain | 390 | 17.265 | 20.930 | 146.905 | — |
| ipcWrite | exclusive | part of sink | 390 | 0.870 | 1.457 | 13.989 | 0.870 |
| ffmpegDrain | exclusive | part of sink | 390 | 3.862 | 5.424 | 130.948 | 3.862 |
| ffmpegClose | one-shot | once per export; excluded from per-frame ranking | 1 | 17.730 | 17.730 | 17.730 | — |
| ipcTransit | exclusive | derived part of sink | 390 | 12.533 | — | — | 12.533 |

inclusive は子段を含む wall、exclusive は per-frame ランキング対象、one-shot は export 全体で
一度だけ発生する後処理である。親子は二重計上しない。`ipcTransit` は
`sink.p50 - (ipcWrite.p50 + ffmpegDrain.p50)` = **12.533ms** として導出した。

### Exclusive per-frame 寄与ランキング

| rank | stage | count | p50 ms | p50 × count / frameCount ms |
|---:|---|---:|---:|---:|
| 1 | ipcTransit | 390 | 12.533 | 12.533 |
| 2 | pboWait | 390 | 4.615 | 4.615 |
| 3 | ffmpegDrain | 390 | 3.862 | 3.862 |
| 4 | copyTo | 390 | 2.550 | 2.550 |
| 5 | rowFlip | 390 | 0.980 | 0.980 |
| 6 | ipcWrite | 390 | 0.870 | 0.870 |
| 7 | upload | 390 | 0.105 | 0.105 |
| 8 | tick | 387 | 0.030 | 0.030 |
| 9 | planeCompact | 390 | 0.000 | 0.000 |
| 10 | shaderGpu | 390 | 0.000 | 0.000 |

支配段は **ipcTransit = 12.533ms/frame**（p50=12.533ms、count=390）。

### One-shot

| stage | count | p50 ms |
|---|---:|---:|
| ffmpegClose | 1 | 17.730 |

one-shot は per-frame ランキングと per-frame 合計から除外する。

## 律速分離 5 計画

1. 段階別計時: 390 frames の inclusive / exclusive / one-shot と p50/p95 を上表へ記録。exclusive だけを per-frame 寄与で順位づけ。
2. decode 対照: full=351.900ms、事前 cache=315.490ms、decode 無し固定面=246.480ms、decode 比率=0.103、cache/full=0.897、fixed/full=0.700。
3. GOP / Lookahead / Warmup: cold p50/p95=76.710/97.580ms、warm p50/p95=0.040/19.265ms、warm/cold=0.001、Lookahead hit p50=0.000ms。cut 境界ごとの直前 keyframe 距離は benchmark JSON の `details` に保存。
4. 8MB IPC: main invoke copy=11.750ms、main MessagePort copy=9.985ms、main SAB available=false（PROCESS_BOUNDARY_UNSUPPORTED: SharedArrayBuffer does not cross the renderer-to-main process boundary; MessagePortMain receives event.data as null）、Worker ArrayBuffer transfer=0.095ms、Worker SAB=0.100ms（available=true）。
5. encoder: raw RGBA→ffmpeg=11235.670ms、WebCodecs→copy mux=3353.200ms、after/before=0.298。

renderer → main の SharedArrayBuffer はプロセス境界を越えず、MessagePortMain では
`event.data` が null 化するため測定対象外（`available:false`）とした。共有メモリ系の
プロセス越え評価は Phase 4 の WebCodecs 出口評価へ送る。
8MB の renderer → main invoke copy と renderer → Worker ArrayBuffer transfer の実測比は
**123.684倍**。raw sink から導出した ipcTransit=12.533ms と
独立 IPC レーン invoke=11.750ms を相互検証し、8MB IPC を WebCodecs 最終出口から
外す改善の定量根拠とする。

## 改善の before / after

| 改善 | before ms | after ms | delta ms | after/before | evidence |
|---|---:|---:|---:|---:|---|
| WebCodecs direct surface export | 11402.960 | 3353.200 | -8049.760 | 0.294 | repeated-run medians on the same surface path: before includes RGBA readback, 8MB/frame renderer-to-main copy, and raw ffmpeg pipe; after uses WebCodecs H.264 plus copy mux |

- profile source run (3) render-cut: 3907.729ms
- **最終 v2/render-cut（median）= 0.858**（min=0.839 / max=1.044）
- encoded cross-engine PSNR sanity: average=23.039dB（pixel equality の判定には使用しない）

**G1 GO**。median 最終比 0.858 は目標 `v2/render-cut ≤ 1.0` を満たした。



## 律速の結論

raw path から readback・8MB/frame IPC・raw pipe encode をまとめて外せる WebCodecs path を採用した。
decode は cut ID ごとの独立 lane（同じ parsed MP4 backing store から fork）へ分け、transition の
outgoing / incoming が同じ MP4Clip 状態を交互 seek しない。直前 VideoFrame の表示区間内要求は
所有 clone から返し、freeze の sub-frame 時刻で decoder cursor を不要に進めない。
plane compact は stride が既に tight な native plane では view を返し、texture は初回確保後
`texSubImage2D` で再利用する。WebCodecs 直結時は surface consumer が同期点になるため
per-frame `gl.finish` を `gl.flush` へ替え、profile / golden の GPU timer 経路だけ finish を維持する。
最終 surface path（tick + copyTo + compact + upload + shader GPU）の p50 積算 × 390 frames は
1047.060ms、WebCodecs 最終 wall との差（encode queue / chunk IPC / mux / scheduling）は
2306.140ms。未達時の物理床根拠と G2 裁定はこの二つを分けて扱う。

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
