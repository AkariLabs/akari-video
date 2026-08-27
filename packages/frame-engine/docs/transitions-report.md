# gl-transitions 流用評価

## 結論

gl-transitions 本体は MIT License（`Copyright (c) 2017-present gl-transitions contributors`）であり、著作権表示と許諾文をコピーまたは substantial portion に含める条件で利用できる。公式 LICENSE は、`transitions/` 内の個別ファイルに別ライセンスがある場合はそちらを優先すると明記している。個別 GLSL を移植する場合は元ファイル名・作者・ライセンスをソースコメントに残し、配布物の第三者表記にも該当表示を含める。

ただし本実装では **流用 0 件**とした。理由は、正本である ffmpeg xfade が整数ピクセル座標、非中心ボックスブラー、固定の進行方向など固有の意味論を持ち、見た目の近い gl-transition を移植しても一致しないためである。xfade の数式だけを参照し、GLSL は独自に記述した。LGPL の `vf_xfade.c` は同梱・逐語コピーしていない。

## 24 語彙の対応評価

「対応物あり」は名前・基本構造が近いという評価であり、そのまま採用可能という意味ではない。「微妙に違う」は方向、座標移動、境界フェザー、または中間像が xfade と異なるものを示す。

集計は「対応物あり」6 件、「微妙に違う」18 件、「無い」0 件。候補があっても xfade の意味論を満たさないものは「微妙に違う」へ分類した。

| xfade 語彙 | gl-transitions 候補 | 評価 | 判断 |
|---|---|---|---|
| fade | `fade` | 対応物あり | 単純式なので独自実装 |
| fade-grays | `fadegrayscale` | 対応物あり | 無彩色化の位相と混合順が異なる |
| wipe-left | `wipeLeft` / `directionalwipe` | 微妙に違う | xfade は整数境界・硬いワイプ |
| wipe-right | `wipeRight` / `directionalwipe` | 微妙に違う | 同上、方向パラメータの意味も別 |
| wipe-up | `wipeUp` / `directionalwipe` | 微妙に違う | 同上 |
| wipe-down | `wipeDown` / `directionalwipe` | 微妙に違う | 同上 |
| radial | `Radial` | 対応物あり | 掃引式は近いが座標の向きと連続座標／整数座標が異なる |
| slide-left | `Directional` | 微妙に違う | xfade は A/B の両方を循環移動 |
| slide-right | `Directional` | 微妙に違う | 同上 |
| slide-up | `Directional` | 微妙に違う | 同上 |
| slide-down | `Directional` | 微妙に違う | 同上 |
| cover-left | `Directional` | 微妙に違う | xfade は A 固定・B のみ移動 |
| cover-right | `Directional` | 微妙に違う | 同上 |
| cover-up | `Directional` | 微妙に違う | 同上 |
| cover-down | `Directional` | 微妙に違う | 同上 |
| reveal-left | `Directional` | 微妙に違う | xfade は B 固定・A のみ移動 |
| reveal-right | `Directional` | 微妙に違う | 同上 |
| circle-open | `circleopen` (`opening=true`) | 対応物あり | smoothness と半径の進行式が異なる |
| circle-close | `circleopen` (`opening=false`) | 対応物あり | 同上 |
| zoom-in | `CrossZoom` | 微妙に違う | xfade は A の中心縮退後に B へ混合 |
| squeeze-h | `squeeze` | 微妙に違う | xfade は出力行を逆写像し、範囲外を B にする |
| squeeze-v | `squeeze` の軸交換 | 微妙に違う | 同上 |
| blur | `LinearBlur` | 微妙に違う | gl 側は 2D 対称 6×6、xfade は右向き causal box |
| pixelize | `pixelize` | 対応物あり | 50 step は同じだが xfade は短辺基準の正方ピクセル寸法 |

## 実装上の固定値

- `blur`: xfade 既定は `size = 1 + trunc((W / 2) * prog)` の完全 causal box。GPU 1 パスでは最大 65 タップを等間隔採用する近似とした。
- `pixelize`: xfade 既定どおり進行量を 1/50 刻みに量子化し、ブロック辺を `2 * dist * min(W,H) / 20` とした。

流用したソースは 0 件なので、ソースコード内に追加すべき個別作者表記はない。

参照: [gl-transitions LICENSE](https://github.com/gl-transitions/gl-transitions/blob/master/LICENSE)、[transition collection](https://github.com/gl-transitions/gl-transitions/tree/master/transitions)。

## xfade 突き合わせの方法

30 fps のタイムライン上で、各遷移を `u = 0.25 / 0.5 / 0.75` の 3 点で比較する。遷移尺は 0.4 秒（12 コマ）とし、遷移 `i` の標本時刻を `t = 0.6 * (i + 1) + 0.4 * u` 秒に置く。これにより各点は 3 / 6 / 9 コマ目のちょうどのフレーム境界となる。frame-engine 側は `transitions.edit.json` から解決した実タイムライン plan を使い、render-cut 側も同じ出力フレームを抽出する。解決後の全 `sourceTimeUs` は素材フレーム番号へ変換し、GOP 最終コマでないことを機械検査する。

フィクスチャの全カットは同一素材の先頭 1 秒へ固定した。ランダムアクセスで後方 GOP の指定時刻ではなく直前のキーフレームが返る既知のデコード層の課題があるためであり、比較表がデコード位置ではなくトランジションシェーダーの一致度を測れるようにするための隔離である。解決される素材時刻は outgoing が 0.7 / 0.8 / 0.9 秒、incoming が 0.1 / 0.2 / 0.3 秒となり、いずれも先頭 GOP 内かつ GOP 最終コマを避ける。

差分値を読む際の既知差分は次のとおり。

- `dissolve`: 決定論的しきい値場は非圧縮の理想フレームとの fail-closed 検査で一致を確認する。render-cut mp4 との直接比較に残る差は、yuv444p の画素別 A/B 選択を yuv420p へ出力するときの 2×2 クロマ平均に由来し、実装差ではない。
- `fade-black` / `fade-white`: phase 0.2 の二段 smoothstep plate mix へ揃えて解消済み。
- `blur`: frame-engine は 1 パスを有限化するため最大 65 タップの近似であり、xfade の完全 causal box との差が残る。
- `pixelize`: 整数ピクセルへの丸め差が境界に残りうる。
- `zoom-in`: `u = 0.5` で前カット中央の単色が全面を占めるため、微小な時刻差や色変換差が MAD に増幅される。

<!-- BEGIN GENERATED XFADE COMPARISON -->
## Generated xfade comparison

- noise floor: maximum hard-cut MAD = 1.9634
- dissolve selection-field match: 99.939% (57565/57600); required ≥ 99.5%
- dissolve engine-vs-non-encoded-ideal MAD cap: 4
- fade-black / fade-white cap: noise floor × 2 + 2
- engine-side error rows: 0

### Dissolve measurement evidence

The implementation check compares the engine PNG with a non-encoded ideal assembled from the exact outgoing/incoming source frames and the CPU threshold field. The mp4 and yuv420p columns quantify the 4:2:0 measurement cost separately.

| u | source frames outgoing / incoming | engine vs ideal MAD / max | mp4 vs ideal MAD / max | ideal 4:2:0 round trip MAD / max | implementation check |
|---:|---|---:|---:|---:|---|
| 0.25 | 21 / 3 | 2.0050 / 171 | 13.9376 / 255 | 12.8755 / 255 | pass |
| 0.5 | 24 / 6 | 1.9835 / 163 | 18.3512 / 255 | 17.2673 / 255 | pass |
| 0.75 | 27 / 9 | 1.9886 / 159 | 15.1221 / 255 | 13.9892 / 255 | pass |

### Direct render-cut comparison

| id | u | frame | MAD | MAD limit | differingPixels | maxChannelDelta | classification | reason |
|---|---:|---:|---:|---:|---:|---:|---|---|
| hard-cut | 0.25 | 21 | 1.9634 | 1.9634 | 50576 | 150 | noise floor | maximum MAD of the three hard-cut reference samples |
| hard-cut | 0.5 | 24 | 1.8619 | 1.9634 | 30253 | 150 | noise floor | maximum MAD of the three hard-cut reference samples |
| hard-cut | 0.75 | 27 | 1.9386 | 1.9634 | 48607 | 153 | noise floor | maximum MAD of the three hard-cut reference samples |
| dissolve | 0.25 | 21 | 13.8246 | 15.9009 | 57515 | 255 | known measurement-instrument difference | xfade selects A/B per pixel in yuv444p, then yuv420p output averages each 2x2 chroma block; random dissolve chroma is necessarily lost by that measurement path |
| dissolve | 0.5 | 24 | 18.1523 | 20.3145 | 57502 | 255 | known measurement-instrument difference | xfade selects A/B per pixel in yuv444p, then yuv420p output averages each 2x2 chroma block; random dissolve chroma is necessarily lost by that measurement path |
| dissolve | 0.75 | 27 | 14.9523 | 17.0855 | 57500 | 255 | known measurement-instrument difference | xfade selects A/B per pixel in yuv444p, then yuv420p output averages each 2x2 chroma block; random dissolve chroma is necessarily lost by that measurement path |
| fade | 0.25 | 39 | 2.5440 | 6.9267 | 57313 | 90 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| fade | 0.5 | 42 | 2.3266 | 6.9267 | 55185 | 85 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| fade | 0.75 | 45 | 2.5479 | 6.9267 | 57390 | 92 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| fade-black | 0.25 | 57 | 0.0000 | 5.9267 | 0 | 0 | within reviewed envelope | phase-0.2 black-plate fade must remain at the encoding noise floor |
| fade-black | 0.5 | 60 | 1.4498 | 5.9267 | 57117 | 43 | within reviewed envelope | phase-0.2 black-plate fade must remain at the encoding noise floor |
| fade-black | 0.75 | 63 | 2.1866 | 5.9267 | 57389 | 83 | within reviewed envelope | phase-0.2 black-plate fade must remain at the encoding noise floor |
| fade-white | 0.25 | 75 | 0.0004 | 5.9267 | 53 | 5 | within reviewed envelope | phase-0.2 white-plate fade must remain at the encoding noise floor |
| fade-white | 0.5 | 78 | 1.6332 | 5.9267 | 57374 | 43 | within reviewed envelope | phase-0.2 white-plate fade must remain at the encoding noise floor |
| fade-white | 0.75 | 81 | 2.2734 | 5.9267 | 57487 | 83 | within reviewed envelope | phase-0.2 white-plate fade must remain at the encoding noise floor |
| fade-grays | 0.25 | 93 | 1.2977 | 6.9267 | 57510 | 23 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| fade-grays | 0.5 | 96 | 1.7952 | 6.9267 | 57513 | 44 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| fade-grays | 0.75 | 99 | 2.6210 | 6.9267 | 57569 | 87 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| wipe-left | 0.25 | 111 | 2.2682 | 6.9267 | 54403 | 114 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| wipe-left | 0.5 | 114 | 2.1685 | 6.9267 | 40358 | 116 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| wipe-left | 0.75 | 117 | 2.1872 | 6.9267 | 35177 | 108 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| wipe-right | 0.25 | 129 | 2.2286 | 6.9267 | 52298 | 99 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| wipe-right | 0.5 | 132 | 2.0884 | 6.9267 | 40886 | 145 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| wipe-right | 0.75 | 135 | 2.2278 | 6.9267 | 42203 | 120 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| wipe-up | 0.25 | 147 | 2.2933 | 6.9267 | 52851 | 137 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| wipe-up | 0.5 | 150 | 2.3356 | 6.9267 | 38880 | 241 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| wipe-up | 0.75 | 153 | 2.3508 | 6.9267 | 38582 | 142 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| wipe-down | 0.25 | 165 | 2.1657 | 6.9267 | 52976 | 102 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| wipe-down | 0.5 | 168 | 2.4166 | 6.9267 | 43856 | 172 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| wipe-down | 0.75 | 171 | 2.2148 | 6.9267 | 39863 | 108 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| radial | 0.25 | 183 | 2.1823 | 6.9267 | 54318 | 105 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| radial | 0.5 | 186 | 2.2150 | 6.9267 | 43556 | 116 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| radial | 0.75 | 189 | 2.0810 | 6.9267 | 38459 | 108 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| slide-left | 0.25 | 201 | 5.2391 | 6.9267 | 52249 | 194 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| slide-left | 0.5 | 204 | 5.0707 | 6.9267 | 42678 | 240 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| slide-left | 0.75 | 207 | 5.0259 | 6.9267 | 41812 | 241 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| slide-right | 0.25 | 219 | 5.1199 | 6.9267 | 53273 | 213 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| slide-right | 0.5 | 222 | 5.1985 | 6.9267 | 40907 | 226 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| slide-right | 0.75 | 225 | 5.1084 | 6.9267 | 36737 | 226 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| slide-up | 0.25 | 237 | 3.8499 | 6.9267 | 53703 | 214 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| slide-up | 0.5 | 240 | 4.3232 | 6.9267 | 45206 | 193 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| slide-up | 0.75 | 243 | 4.0409 | 6.9267 | 39784 | 238 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| slide-down | 0.25 | 255 | 3.6512 | 6.9267 | 53308 | 206 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| slide-down | 0.5 | 258 | 4.0620 | 6.9267 | 39754 | 211 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| slide-down | 0.75 | 261 | 3.8570 | 6.9267 | 39797 | 227 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| cover-left | 0.25 | 273 | 2.8284 | 6.9267 | 53829 | 190 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| cover-left | 0.5 | 276 | 3.8607 | 6.9267 | 44693 | 234 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| cover-left | 0.75 | 279 | 4.5714 | 6.9267 | 41875 | 240 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| cover-right | 0.25 | 291 | 2.9373 | 6.9267 | 52381 | 229 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| cover-right | 0.5 | 294 | 4.1057 | 6.9267 | 38105 | 228 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| cover-right | 0.75 | 297 | 4.5209 | 6.9267 | 36590 | 226 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| cover-up | 0.25 | 309 | 3.2905 | 6.9267 | 54192 | 214 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| cover-up | 0.5 | 312 | 3.5629 | 6.9267 | 41224 | 198 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| cover-up | 0.75 | 315 | 3.9420 | 6.9267 | 40030 | 232 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| cover-down | 0.25 | 327 | 2.2314 | 6.9267 | 52289 | 173 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| cover-down | 0.5 | 330 | 3.0503 | 6.9267 | 43174 | 209 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| cover-down | 0.75 | 333 | 2.9591 | 6.9267 | 39282 | 228 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| reveal-left | 0.25 | 345 | 4.5113 | 6.9267 | 52416 | 193 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| reveal-left | 0.5 | 348 | 3.4808 | 6.9267 | 37486 | 160 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| reveal-left | 0.75 | 351 | 2.9150 | 6.9267 | 35710 | 203 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| reveal-right | 0.25 | 363 | 4.3575 | 6.9267 | 53933 | 191 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| reveal-right | 0.5 | 366 | 3.3763 | 6.9267 | 44011 | 195 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| reveal-right | 0.75 | 369 | 3.0750 | 6.9267 | 41433 | 188 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| reveal-down | 0.25 | 381 | 3.7552 | 6.9267 | 54129 | 206 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| reveal-down | 0.5 | 384 | 3.4595 | 6.9267 | 40504 | 185 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| reveal-down | 0.75 | 387 | 3.4116 | 6.9267 | 39871 | 197 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| reveal-up | 0.25 | 399 | 2.9627 | 6.9267 | 52490 | 207 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| reveal-up | 0.5 | 402 | 3.1661 | 6.9267 | 43907 | 158 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| reveal-up | 0.75 | 405 | 2.4400 | 6.9267 | 38747 | 239 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| circle-open | 0.25 | 417 | 2.1660 | 6.9267 | 53592 | 99 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| circle-open | 0.5 | 420 | 2.5717 | 6.9267 | 57151 | 91 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| circle-open | 0.75 | 423 | 2.1747 | 6.9267 | 38174 | 115 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| circle-close | 0.25 | 435 | 2.2214 | 6.9267 | 53711 | 104 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| circle-close | 0.5 | 438 | 2.5497 | 6.9267 | 56864 | 98 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| circle-close | 0.75 | 441 | 2.1368 | 6.9267 | 36541 | 106 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| zoom-in | 0.25 | 453 | 1.5168 | 8.9267 | 50626 | 104 | within reviewed envelope | documented bounded sampling or integer-coordinate approximation plus encoding noise |
| zoom-in | 0.5 | 456 | 5.7500 | 8.9267 | 57600 | 11 | within reviewed envelope | documented bounded sampling or integer-coordinate approximation plus encoding noise |
| zoom-in | 0.75 | 459 | 2.7136 | 8.9267 | 57593 | 56 | within reviewed envelope | documented bounded sampling or integer-coordinate approximation plus encoding noise |
| squeeze-h | 0.25 | 471 | 2.6265 | 6.9267 | 53302 | 156 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| squeeze-h | 0.5 | 474 | 2.9573 | 6.9267 | 43478 | 196 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| squeeze-h | 0.75 | 477 | 2.8725 | 6.9267 | 39051 | 150 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| squeeze-v | 0.25 | 489 | 2.4693 | 6.9267 | 54617 | 246 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| squeeze-v | 0.5 | 492 | 3.1271 | 6.9267 | 46895 | 195 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| squeeze-v | 0.75 | 495 | 3.2779 | 6.9267 | 43034 | 237 | within reviewed envelope | same xfade geometry/formula with bounded color conversion and frame-encoding noise |
| blur | 0.25 | 507 | 2.2063 | 8.9267 | 57473 | 99 | within reviewed envelope | documented bounded sampling or integer-coordinate approximation plus encoding noise |
| blur | 0.5 | 510 | 6.5158 | 8.9267 | 57496 | 93 | within reviewed envelope | documented bounded sampling or integer-coordinate approximation plus encoding noise |
| blur | 0.75 | 513 | 2.3915 | 8.9267 | 57468 | 98 | within reviewed envelope | documented bounded sampling or integer-coordinate approximation plus encoding noise |
| pixelize | 0.25 | 525 | 3.1176 | 8.9267 | 57373 | 197 | within reviewed envelope | documented bounded sampling or integer-coordinate approximation plus encoding noise |
| pixelize | 0.5 | 528 | 2.2769 | 8.9267 | 54761 | 129 | within reviewed envelope | documented bounded sampling or integer-coordinate approximation plus encoding noise |
| pixelize | 0.75 | 531 | 3.0900 | 8.9267 | 57384 | 200 | within reviewed envelope | documented bounded sampling or integer-coordinate approximation plus encoding noise |
<!-- END GENERATED XFADE COMPARISON -->
