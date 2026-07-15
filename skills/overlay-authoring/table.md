# 表・グラフ設計

## 原則

- 正確な値の照合・比較が主目的なら semantic な `<table>` を使う。傾向、順位、構成比を一目で示すなら DOM のラベルと値に CSS Grid / Flex を組み合わせる。
- データを HTML テキストとして残す。canvas のピクセルだけに値やラベルを閉じ込めない。
- 表示する値、順序、単位、丸めは authoring 前に確定する。同じ画面で並べる値は同じ基準と単位にそろえる。
- 色だけで系列を区別せず、ラベル、形、位置も併用する。軸、凡例、基準線を装飾より先に読める状態にする。
- `--accent-*`、`--label-color`、`--value-color`、`--row-gap`、`--bar-scale` などを CSS 変数で公開する。
- セレクタと `@keyframes` 名を断片固有のルート配下へ閉じる。

## HTML/CSS の構成

- 表は `<caption>`、`<thead>`、`<tbody>`、`<th scope>` を使い、見た目のためだけに div 表へ崩さない。
- 棒グラフは「ラベル」「静的な数値」「track」「fill」を DOM に持つ。値を定義域から **0〜1** に正規化し、fill を `transform: scaleX(var(--ratio))` または `scaleY()` で表す。
- 数字の桁が動く場合は `font-variant-numeric: tabular-nums` を使う。wall-clock の count-up ではなく、最終値を静的に置いて reveal する。
- 円弧や連続曲線が本当に必要な場合も、値を読める DOM の要約を残す。外部 chart library を安易に追加しない。
- 行数、文字サイズ、余白の一律閾値はリポ契約にない。収まらない場合は縮小せず、画面を分割する。具体値は出力プロファイルで **要検証** とする。

## アニメーション

- 棒は `transform-origin` を基点側へ置き、scale で伸ばす。`width` / `height` を毎フレーム変えない。
- 行やカードは translate + opacity で段階表示する。DOM の挿入・削除でレイアウトを揺らさない。
- 並べ替えは最終順を先に DOM へ置き、必要なら子要素の transform で見せる。再生中に table row を入れ替えない。
- CSS animation / WAAPI を使い、可視区間 `start <= t < start + duration` のローカル時刻に決定的に対応させる。
- 静的 Chrome fallback では animation が無効になる。静止状態だけでも値、単位、結論が伝わる構図にする。

## よくある間違い

- 精密な比較を 3D 円グラフや装飾だけで表す。
- canvas/chart library を導入し、live preview で script が動くと仮定する。
- 棒の `width`、行の `top`、grid track をアニメーションする。
- `setInterval` で数値を加算する。
- 系列色だけで意味を区別する。
- 情報量が多いまま任意の「最大行数」を発明する、または文字を極端に縮める。
- グローバルな `table` セレクタや一般名の `@keyframes grow` を使い、他断片と衝突する。

## 根拠

- 時刻、単一ルート、CSS 変数、compositor の契約: `CLAUDE.md` と `docs/contract-2026-07-13-m1-m4.md`
- 静的 fallback の制約: `scripts/render-overlays.mjs`
