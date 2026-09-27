# データ形と描画方針

- `stroke_inner: {color, width_px}` を `text_style` の独立欄にする。既存の `stroke` の形とマージ規則を変えず、外縁と内縁を別々に削除・undo・調整できる。`stroke.inner` より cue/default 合成と部分更新が単純になる。
- `fill_gradient: {colors: [hex, hex, hex?], angle_deg}` は文字の塗りだけを変える。`angle_deg` は CSS `linear-gradient` の角度。
- `extrude: {depth_px, color, color_end?, angle_deg}` は 1px 間隔の影を合成する。`color_end` を省略したときは `color` 一色。角度は CSS 方向（0° 上、90° 右、180° 下）として扱う。`depth_px` は 1 以上の整数で上限 32 にする。
- `stroke.width_px`、`stroke_inner.width_px`、`extrude.depth_px` は `reference_height_px` / reference-pixel layout の scale 対象。角度と色は拡縮しない。
- 二重縁取り（グラデーションなし）は外縁を従来の `-webkit-text-stroke`、内縁を半径 `stroke_inner.width_px` の 16 方向 `text-shadow` にする。Chrome 実測で、影が stroke の上に描かれるため、この順で内縁が見える。押し出し影と既存 shadow / glow は同じ `text-shadow` リストの後ろに合成する。
- グラデーションは行の `background-clip:text` に載せる。グラデーション時には行の `-webkit-text-stroke:0` と `text-shadow:none` を宣言し、縁・押し出し・shadow / glow を `--caption-fill-filter` の `drop-shadow()` 連鎖へ移す。縁は各方向を 1, 2, 4, … px の刻みで太らせ、二重縁は内縁を先、外縁の残り幅を後にする。旧字幕にはこの CSS 規則を出さず、HTML バイト列を保つ。
- Chrome で語ごとの `.akari-caption__tok` を持つ styled 字幕を撮影した結果、行だけの `background-clip:text` では token の文字が消えた。各 token にグラデーションと filter を適用し、行の filter を外すと表示できた（`chrome-styled-gradient.png`）。語ごとにグラデーションが再始点になる。カラオケの時刻・色の規則には触れていない。
- per-line 座布団の背景とグラデーションを同じ行に付けると、`background-clip:text` が座布団も文字形に切るため座布団は見えない（`chrome-gradient-background.png` で実測）。filter も行の描画結果全体へ掛かる。効果カードでグラデーションを選ぶ操作は座布団の opacity を 0 にする。手書きの同時指定はスキーマ上受け付けるが、per-line 座布団の面は描けない。block 座布団は別の親要素に載る。
- `captionRun.style` は本票では新しい見た目を使えない。`stroke_inner` / `fill_gradient` / `extrude` は cue と default の `text_style` に限定する。既存の run 単位の stroke と時刻処理は変更しない。
- GPU は新しい 3 欄のいずれかを使う字幕を unsupported とし、OSR に回す。GPU page-runtime の CSS を増やさない。
