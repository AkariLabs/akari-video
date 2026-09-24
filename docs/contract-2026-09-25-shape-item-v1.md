# contract — 図形アイテム v1

- 決定日: 2026-09-25
- 保存先: edit.json v2 の `source.kind: "shape"`
- 降下先: edit-store の決定論的なインライン SVG HTML オーバーレイ

## 1. 保存形

図形の形は `source.shape` と `source.params` に置き、位置・拡縮・回転・時間は item 共通の値を使う。棚から配置するときは形状と既定値を **値でコピー** する。`params.preset` は由来の ID であり、描画時の参照先ではない。

| 型 | 保存する値 |
| --- | --- |
| `path` | `params.path: {d, vb:[width,height], rule?}`。`d` は絶対座標の `M/L/C/Z` のみ。`rule` は `nonzero` または `evenodd` |
| 元の形 + 丸み | `shape: "path"` の `params.cornerRadius` だけを割合 0〜100（100 = 短辺の半分）として、直線同士の角を配置後の実寸 px で丸める。v0 の形名では `rounded-rect` だけが従来どおり px で丸まり、ほかの形名の同名値は描画に影響しない |
| `line` | `dash: solid/dash/dot`、`startCap` / `endCap: none/triangle/chevron/bar/square/circle/diamond`、各 `*CapFilled`、`lineCap: butt/round`。`arrow` は終端三角の別名 |
| `bubble` | `style: ellipse/rounded/rect/jagged/burst/cloud/wobble`、`count`（4〜48）、`depth`、`jitter`、`seed`、`tail: point/dots/none`、`tailAngle`（0〜360）、`tailLength`、`tailWidth`、`tailCurve`、`dash` |

`fill` / `stroke` は `#RRGGBB`、`#RRGGBBAA`、`none`、または `{type:"linear",angle,stops:[{color,offset}]}` / `{type:"radial",stops:[{color,offset}]}`。グラデーションは 2〜5 色、offset は 0〜1 で昇順。透明度は各色の AA に持つ。`strokeWidth` は 0〜100（1920px 幅基準で出力幅に比例）。閉じた形の枠は輪郭の内側だけに描き、開いた線は中心線のままにする。

四角を丸めたいときは、棚の四角を `path` として値で写し、`params.cornerRadius` を付ける。

棚の既定値は形 = `#a6a6a6` 塗り・枠なし、線 = `#000000`・4px、吹き出し = 白塗り・黒枠 5px。旧データは v0 の既定値と SVG 文字列を維持する。v1 の値は新しい型・フィールドを持つ item で適用する。

## 2. 降下と外形

path は棚の viewBox 余白を外して描画領域へ写す。角丸・吹き出しは実寸の座標で作り直す。SVG の viewBox に追加の余白を置かず、見える端を選択枠と吸着の基準にする。開いた線・閉じた形・吹き出しで同じ線種を使い、点線は角形の点（長さ = 見える太さ）、破線は長さ = 見える太さの 3 倍、どちらも間隔 = `max(見える太さ×2,3px)`。端のパーツは端点から内側へ向け、見える端を動かさない。

item の非一様な拡大は `sqrt(scaleX×scaleY)` で線幅・線種・端の寸法を補正する。方向ごとの幅差は残るが、プレビューと書き出しは同じ SVG の拡大結果を描く。

グラデーションと内側枠線の SVG ID は item ごとに決定論的に分離する。SVG 出力は同じ宣言に対してバイト同一とする。プレビューは HTML オーバーレイへ降下する。GPU 出口の SVG 適格性はこの契約では変更せず、書き出しは既存の OSR フォールバックを利用する。

## 3. 棚

`presets/shapes/index.jsonl` は 1 行 1 件で、`id/category/name/vb/d/kind/rule?/rounded_from?/defaults` を持つ。吹き出しは `kind: "bubble"` と params、線は `kind: "line"` と params を持つ。角丸のプリセットは `rounded_from: {base,radius}` を持ち、配置時は元の形と丸みをコピーする。生成スクリプトで同じバイト列を再生成できる。

## 4. 後続

棚の UI、配置操作、点編集、形の時間変化、GPU 適格化は別契約で扱う。
