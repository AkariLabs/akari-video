# issue #36: shell の全画面オーバーレイ背景が消える

## 症状

1920×1080 の断片ルート自身が縦グラデーションを描画する fixture を 2.0 s、無選択で shell プレビューすると、テキスト周辺以外の背景が消え、`#preview-stage` の黒が外枠のように現れる。`before-shell-window.png` は CDP キャプチャ、`before-shell-screencapture.png` は macOS の実画面キャプチャである。

## 真因

`packages/overlay-runtime/src/interaction.js` の `fragmentBounds()`（修正後 L152 付近）は、断片ルートがコンテナの 98% 以上を覆うと透明な位置決めラッパーとみなし、子孫の可視矩形の union を返す。`computeHitClipPath()`（修正後 L394 付近）がその矩形を `inset(...)` へ変換し、`syncOverlayHitRegion()`（L419 付近）が `[data-overlay-id]` の inline `style.clipPath` へ設定する。

`clip-path` はポインタの当たり判定だけでなく描画もクリップする。そのため、透明ラッパーではなく自身に `background: linear-gradient(...)` を持つ全画面ルートまで、子要素の外接矩形へ視覚的に切り落とされていた。

## 修正

`computeHitClipPath()` の直前に `fragmentRootPaintsOutside()` を追加した。既存の `fragmentRoot()` と `drawsOwnContent()` を使い、断片ルート自身が背景・枠・影・置換要素・直接テキストを描画し、その border box が子孫 bbox の外へ広がる場合だけ `null` を返す。この場合は clip を掛けず、当たり判定は既存の `applyOverlayHitPolicy()` の `pointer-events` 規約に任せる。背景も枠も持たない透明な全画面ラッパーは従来どおり `inset(...)` を使う。

## BEFORE 実測

| 項目 | shell | Web UI |
|---|---:|---:|
| 出力 / fixture | 1920×1080, 2.0 s | 1920×1080, 2.0 s |
| 断片ルート | x=0–1920, y=0–1080（出力座標） | 全ステージ |
| コンテナの `clip-path` | `inset(40.7407% 26.5898% 40.7407% 8.33333%)` | `none` |
| clip の出力座標 | x=160–1409.5, y=440–640 | なし |
| ステージ四隅 | `rgb(0,0,0)` | グラデーション背景 |
| `#preview-stage` と `#preview-layers` の矩形差 | left/top/right/bottom = 0 px | — |

shell のステージ実測矩形は 821×461.8125 px、断片ルートも同一矩形である。幾何学的な隙間は 0 px。コンテナの inline `clip-path` を外すと全面背景が復帰することも実画面で確認した。

## 条件行列

| 条件 | `clip-path` | 全画面背景 | 判定 |
|---|---|---|---|
| shell / 2.0 s / 無選択 / 自身が背景を描画するルート | 子要素 bbox の `inset(...)` | 消失 | BEFORE 不具合 |
| shell / 同条件 / inline `clip-path` だけ除去 | `none` | 全面に復帰 | 真因切り分け |
| Web UI / 同一 fixture / 2.0 s | `none` | 全面に描画 | BEFORE 正常 |
| headless Chrome / 描画する全画面ルート / 修正後 | `none` | 四隅 2 px 内側が `rgb(0,128,255)` | 追加回帰テスト |
| headless Chrome / 透明な全画面ラッパー / 修正後 | 子要素 bbox の `inset(...)` | 子要素は残る | 既存入場アニメテスト |

## 再実行

shell L1 探針は fixture の場所だけを外から渡して実行する。出力先の既定値は `<tmp>/i36-out` である。

```sh
AKARI_FIXTURE=<fixture> \
  apps/shell/extensions/akari-preview/evidence/issue-36-overlay-frame/scripts/run-l1.sh after
```

Web UI 探針は起動済み preview-server の URL と出力先を渡す。

```sh
node apps/shell/extensions/akari-preview/evidence/issue-36-overlay-frame/scripts/run-webui-l1.mjs \
  http://127.0.0.1:<port>/ <tmp>/i36-out after-web
```

`before-measure.json` と `before-webui-measure.json` は、この探針で得た DOM・CSS・座標・RGB の数値証跡である。

## AFTER 実測（shell・2.0 s・無選択）

コンテナ `[data-overlay-id]` の inline `clip-path` は `none`、computed value も `none` となった。

| 項目 | BEFORE | AFTER |
|---|---|---|
| 断片が描画した領域（ステージ内の非黒画素の外接矩形・出力座標・2 px 刻み走査） | x 160–1408 / y 438–640（子要素 bbox） | x 2–1916 / y 2–1076（全画面） |
| 断片ルート四辺・四隅の 2 px 内側 8 点 | 8 点すべて `rgb(0,0,0)` | グラデーション背景色 |
| 8 点と「同じ y の 8 px 内側」参照画素との最大差 | — | **1/255**（受け入れ条件 Δ ≤ 8 を満たす） |
| `#preview-stage` 外側 2 px（上下左右 4 点） | `rgb(44,45,48)` | `rgb(44,45,48)` |
| 走査線上の「断片背景でも pasteboard でもない画素」 | 0 px（最長連続 0 px） | 0 px（最長連続 0 px） |

AFTER の断片ルート内側 8 点の実画素 RGB は次のとおり。

| 点 | RGB |
|---|---|
| top-mid | `rgb(14,26,56)` |
| bottom-mid | `rgb(25,42,89)` |
| left-mid | `rgb(20,34,73)` |
| right-mid | `rgb(20,34,73)` |
| tl | `rgb(14,26,56)` |
| tr | `rgb(14,26,56)` |
| bl | `rgb(25,42,89)` |
| br | `rgb(25,42,89)` |

`#preview-stage` 外側の `rgb(44,45,48)` は、dark テーマの pasteboard `#2b2d30` を表示プロファイル込みで実測した値である。断片ルート外周の走査線は、上辺 y−2 / 下辺 y+2 / 左辺 x−2 / 右辺 x+2、全長はそれぞれ 822 / 822 / 462 / 462 px である。

## AFTER 実測（パリティ）

| 面 | BEFORE | AFTER | 判定 |
|---|---|---|---|
| Web UI（preview-server + 実 Chromium・2.0 s）24 点 RGB | — | — | **完全一致**（`before-webui-measure.json` と `after-webui-measure.json` の `points` が JSON 一致） |
| Web UI コンテナの `clip-path` | `none` | `none` | 不変 |
| 書き出し参照フレーム（`akari capture -t 2.0`・1920×1080 PNG） | sha256 `30bc1e96cb4b06a4c2396d16cd7b713cd30c233ff2cce729f45438481401fa8a` | 同じ sha256 | **バイト一致** |
| 書き出しフレームの四隅 2 px 内側 | tl/tr `rgb(11,26,58)` · bl/br `rgb(20,41,91)` | 同じ | 参照（shell AFTER と Δ ≤ 5） |

## 選択枠の往復（AFTER・実測）

| 状態 | `data-akari-interaction-selected` | 可視の `.akari-interaction-selection-frame` | コンテナ `clip-path` |
|---|---|---|---|
| 無選択 | なし | 0 個 | `none` |
| 断片テキストをクリック | `true` | 1 個（`1px solid rgba(255,157,66,0.98)`・矩形 104.4/488.7/534.3×85.5 webview px） | `none` |
| 解除（余白クリック + Esc） | なし | 0 個 | `none` |

## 逸脱

`akari capture --engine osr` は本機で `frame 60: offscreen paint returned an empty bitmap` / `stamp verify failed` により失敗した。そのため、書き出し参照は既定エンジン（`akari capture -t 2.0`）で取得した。BEFORE / AFTER の sha256 一致で「書き出しの絵が変わっていない」ことは満たしている。
