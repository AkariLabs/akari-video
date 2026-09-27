# BEFORE（基点 7ad651c9b）

試作値を 1 件の `captions.json` の `captions[0].text_style` に手で書いて、基点の検証器とビルド済み edit-store の `parseCaptions` に通した。値は `stroke: {color:'#000000',width_px:9,inner:{color:'#ffffff',width_px:3}}`、`fill_gradient: {colors:['#fb923c','#f43f5e','#8b5cf6'],angle_deg:90}`、`extrude: {depth_px:6,color:'#a16207',color_end:'#5c2a09',angle_deg:45}`。

| 消費側 | 基点での実測 |
|---|---|
| `validate-captions.mjs` | exit 1。`fill_gradient` と `extrude` は `text_style` の未知キー、`inner` は `stroke` の未知キーとして NG。 |
| `edit-store/lib/caption-store.js` の `parseCaptions` | 字幕自体は残る。`fill_gradient` と `extrude` は警告のうえ無視され、`stroke` は `color:#000000` と `widthPx:9` だけ残って `inner` が落ちる。 |

原因は、検証器と JSON Schema の閉じた許可リスト、edit-store の正規化に 3 欄が無いこと。描画の共有 CSS 変数にも対応が無い。

## 字幕 CSS の写し（基点）

| 経路 | stroke | text-shadow |
|---|---|---|
| render-cut 通常字幕 | `-webkit-text-stroke:var(--caption-stroke,0.14em rgba(0,0,0,.9))`、`paint-order:stroke fill` | `var(--caption-text-shadow,0 2px 8px rgba(0,0,0,.35))` |
| render-cut 単一行字幕 | `var(--caption-webkit-text-stroke,0 transparent)`、`paint-order:var(--caption-paint-order,stroke fill)` | 黒の 5 層を fallback とする `--caption-text-shadow` |
| shell preview（通常/単一行） | `var(--caption-webkit-text-stroke,var(--caption-stroke,0.14em rgba(0,0,0,.9)))`、`--caption-paint-order` | `var(--caption-text-shadow,0 2px 8px rgba(0,0,0,.35))` |
| preview-server Web UI | shell preview と同形 | shell preview と同形 |
| GPU page-runtime | 独自の stroke / shadow CSS 宣言は無い。render-cut が作る字幕 HTML/CSS を入力として扱う。 | 同左 |

ここでいう「4 か所」は render-cut / shell preview / preview-server / GPU page-runtime の 4 消費経路。GPU は CSS の写しを持たず、render-cut の HTML を使用する。既存の差は render-cut の通常字幕が `--caption-webkit-text-stroke` を見ない点と、単一行の既定 shadow が別物である点。新しい見た目の指定がある時だけ同一規則を上乗せし、既存の指定が無い字幕の fallback は保持する必要がある。
