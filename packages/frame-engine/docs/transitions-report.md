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

- `dissolve`: ffmpeg は疑似乱数しきい値ディゾルブ、frame-engine は線形クロスフェード（xfade の `fade` 相当）なので、意図的に意味論が異なる。
- `blur`: frame-engine は 1 パスを有限化するため最大 65 タップの近似であり、xfade の完全 causal box との差が残る。
- `pixelize`: 整数ピクセルへの丸め差が境界に残りうる。
- `zoom-in`: `u = 0.5` で前カット中央の単色が全面を占めるため、微小な時刻差や色変換差が MAD に増幅される。
