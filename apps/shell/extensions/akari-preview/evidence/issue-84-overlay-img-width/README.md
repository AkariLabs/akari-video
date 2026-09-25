# issue #84: 出力プレビューで overlay 内の `<img>` の明示幅が効かない

## fixture

`scripts/make-fixture.mjs <dir> compat|source` が 1080×1920・30 fps の v2 プロジェクトを作る（外部ツール不要）。

- 背景: 1080×1920 の灰（128,128,128）の PNG
- `overlays/img-frame.html`（報告の最小形）: `overflow:hidden` の枠 960×240（left 60 / top 840・背景は青）に
  `<img style="position:absolute; left:-152px; top:-270px; width:1300px; height:auto">`。画像は 1320×530 の PNG を data: URI で埋め込み、上半分 = 赤・下半分 = 緑
  - 正しく描けば枠の中は全面が緑（縮めた 1300×521.97 の画像の y 270〜510 はすべて下半分）。img が縮むと枠の中に青が出る
- `overlays/cap.html`（作者 CSS の保持確認）: `.i84-cap-root img { max-width: 300px }` の下で `width:600px` の img（書き出しでは 300px）。同じ overlay に `<kbd>` と `<code>`
- `overlays/vw-box.html`（回帰確認）: `<img>` を使わず `vw` / `vh` と px で置いた箱
- `compat` = `output.geometry` 無し（edit-lint が `geometry.fit-compat` の warning を出す = 報告と同じ条件）、`source` = `output.geometry: "source"`（warning 無し）

## 原因

出力プレビューは Theia の webview で描いており、Theia の webview 基盤はすべての webview 文書の head 先頭に
`<style id="_defaultStyles">`（`img { max-width: 100%; max-height: 100% }`・`a`・`code`・`blockquote`・`kbd`・focus の outline・スクロールバー・`body`）を差し込む。
HTML オーバーレイは同じ文書の `#overlay-stage [data-overlay-id]` の中へ差し込まれるので、この既定 CSS が overlay の要素にも当たっていた。書き出し（render-cut）の描画ページとブラウザプレビューにはこのシートが無い。

- CDP の `CSS.getMatchedStylesForNode` で img に当たる規則を取ると、`_defaultStyles` の `img { max-width: 100%; max-height: 100%; }` と、v0.1.80 で足された `#overlay-stage [data-overlay-id] img { max-width: none; max-height: none; }` の 2 つ（`before/shell-*.json` の `imgMatchedRules` / `sheetOrigin`）
- 報告の版（v0.1.79）は後者が無い。その 1 行だけを live CSSOM から外すと img は枠の 960×240 に押し込まれ（`max-width` と `max-height` の両方が効く）、位置 (-152, -270) のまま枠より上に出るので、枠が空（青）になる（`before/shell-v0179-sim-*.png`）
- 最新 main（v0.1.83）では報告の形は再現しない（img は 1300×521.97・枠基準 (-152, -270)）。ただし v0.1.80 の 1 行は詳細度 (1,1,1) で、作者が書いた `.i84-cap-root img { max-width: 300px }` まで上書きする（シェル 600px / 書き出し 300px）。kbd・code にも Theia の既定の枠・背景・色が当たったまま

## 修正

`src/common/webview-default-style-scope.ts` が `_defaultStyles` の各セレクタの主語に `:where(:not(#overlay-stage [data-overlay-id] *))` を付ける（疑似要素があればその直前）。`:where()` は詳細度 0 なので、overlay の外（シェルの UI）では元の規則と同じ詳細度・同じ順序のまま効き、overlay の中では一致しなくなる。
出力プレビューの webview スクリプトの先頭で 1 回呼び、v0.1.80 の高詳細度の 1 行は削除した。overlay の作者 CSS・書き出し側・ブラウザプレビューは変更していない。

## 実測（1.0 秒・無選択・論理座標 = 出力 1080×1920 基準）

| 面 | img の幅×高さ | 枠基準の位置 | 作者 cap の img 幅 | kbd の枠 | 書き出しと色の分類が違う点 |
|---|---|---|---|---|---|
| シェル v0.1.79 相当（0.1.80 の 1 行を外す） | 960×240 | (-152, -270) | 300 | 1px | 枠の中 10 点すべて青（書き出しは緑） |
| シェル main（BEFORE） | 1300×521.969 | (-152, -270) | **600** | 1px | `cap:x500` が赤（書き出しは灰） |
| **シェル AFTER** | **1300×521.969** | **(-152, -270)** | **300** | 0px | **0 点** |
| Web UI BEFORE / AFTER | 1300×521.969 | (-152, -270) | 300 | 0px | 0 点 |

- `compat` / `source` の両条件で同じ値（`compare.json`）。点の定義は `scripts/measure.mjs` の `SAMPLE_POINTS`（枠内 9 点 + 右寄り 1 点・枠外 2 点・cap 2 点・vw 箱・px 箱・背景）
- 色は表示プロファイル変換後のスクリーンショットなので、赤・緑・青・灰・マゼンタ・黄の分類で比べる（`scripts/compare.mjs`）
- 書き出し参照: `akari capture --engine osr -t 1.0 --full`（engine requested/resolved = osr、stamp 一致、launcher tier 2）と `render-cut --engine osr` の MP4 の 1.0 秒。両者の分類は全点一致（`export/`）。修正前後の capture PNG は sha256 が一致（書き出しは不変）
- AFTER の `_defaultStyles` は 13 規則すべてが書き換わり（`after/shell-*.json` の `defaultSheet.selectors`）、overlay の外に置いた kbd / img には従来どおり既定 CSS が当たる（kbd 1px solid・padding 3px、img max-width 100%）= シェル UI 側の見た目は不変
- 回帰: vw 箱 (108, 96, 324×192)・px 箱 (700, 1500, 300×200) は BEFORE / AFTER で一致

## 未確認

- 報告の「960px の枠が画面右端をはみ出して見える」は、どの条件でも再現しなかった（枠は常に x 60〜1020）。報告者の HTML の枠の配置が本 fixture と違う可能性がある
- overlay の文字の継承値（font-family / font-size / color）は、シェル（Theia の body 既定 13px・#eee）・Web UI（ページの body 16px・#eee）・書き出し（UA 既定・黒）で今も異なる。どちらもプレビューのページ側の継承で、本件の注入規則とは別の層なので変えていない

## 再実行

```sh
node scripts/make-fixture.mjs <tmp>/fx-compat compat
AKARI_REPO=<repo> scripts/run-shell.sh <tmp>/fx-compat after-compat <tmp>/out      # CDP 9487。I84_SIMULATE_079=1 で v0.1.79 相当も計測
AKARI_REPO=<repo> scripts/run-webui.sh <tmp>/fx-compat after-compat <tmp>/out      # preview-server 48870 + Chrome
node scripts/sample-osr.mjs <capture した 1080×1920 の PNG>
node scripts/compare.mjs <tmp>/out
```
