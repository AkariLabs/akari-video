# preview-chrome-top-layer — 出力プレビューの選択枠・つまみ・小さなメニューを最前面の UI 層へ（L1 証跡）

実機（開発ビルド `npm run build` の Electron + CDP・専用の `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace）で、
横長 1920×1080 と縦長 1080×1920 の fixture（下から 本編の動画 → 写真 → 図形 → キーフレーム付き写真 → 字幕（話した言葉 + 置いた文字）→ 字幕を覆う紫の写真 `cover-1`）を操作して測った記録。
`before/` は基点（origin/main `5e38b7a87`）のビルド、`after/` はこのブランチの最終ビルド。数値は各ディレクトリの `results.json`。

## 走らせ方

```
node scripts/run.mjs --label before|after --out <dir> --orient landscape|portrait [--only <筋書き名,...>]
node scripts/export-osr.mjs landscape|portrait <dir>      # (f) OSR 書き出し
python3 scripts/summarize.py <dir>/<label>.json
```

- 筋書きは `scripts/scenarios.mjs`。`--only` で筋書きを選ぶ（(c) と (d) は前の筋書きで素材が重ならないよう新しい fixture で単独に回した: `*-c` / `*-d` / `*-d2` / `*-c2`）
- 可視率 `visibleFrac` = 要素の矩形のうち、祖先の overflow と webview の表示範囲で切られずに見える割合。`hitSelf` = 中心の `elementFromPoint` が自分か
- ドラッグは CDP `Input.dispatchMouseEvent`。途中（押したまま）で止めて 0 / 150 / 600ms 後に測る

## 手順 0 で特定した原因（BEFORE の実測）

| # | 症状 | 実測（BEFORE） | 原因 |
|---|---|---|---|
| 1 | 端で切れる | 写真を左上端へ: `#layer-select-box` 可視 0.525・nw/ne/sw/n/w のつまみ 0。置いた文字を上端へ: 道具列と全ボタン 0。下端の字幕: 回転/移動の丸 0.293 | 枠・つまみ・道具列が `#preview-stage` / `#zoom-layer` の `overflow:hidden` の中 |
| 2 | 奥の字幕のつまみが隠れる・押せない | 青枠と道具列は見えるが白丸・折り返しつまみ・丸ボタンは紫の写真の下（`before/landscape/before-a-caption-bottom-fit.png`）。se を押すと字幕でなく上の写真が動く（cover の transform {x:0,y:389} → {x:160.6,y:437.2}） | 字幕のつまみが字幕プレート（字幕トラックの z）の中にある |
| 3 | 変形中にメニューが残る | 字幕の移動中: ホストのバーは隠れるが道具列の本体（黒背景）が残る。字幕の拡大縮小・折り返し幅: ホストのバーが出たまま（`before/*-c/`） | 道具列は中のボタンだけ `visibility:hidden`。busy 判定に `akari-caption-transforming` が無い。1.5 秒の安全タイマーは webview 内のドラッグを 2.8 秒止めても発火せず（ホストの mouseup でのみ起動・`before/landscape-hold/`） |
| 4 | 枠が遅れる | 写真の拡大中: 画像 104.6×68.7 → 158.1×103.9 に対し枠は 104.6×68.7 のまま、ポインタとつまみ 65.4px（0/150/600ms 不変・離して 0.9 秒後も旧サイズ）。キーフレーム付き 56.7px。回転: 画像 −109.18° に対し枠 0°。cut の拡大縮小: 45.8px | 枠の計算が保存値（`spec.transform`）の姿勢で scale / rotate を上書き（`previewMotionGeometryTransform`） |
| 5 | ガイドが水色 | `.akari-interaction-snap-guide` の背景 rgb(77,163,255) | シェル側 CSS が `var(--akari-accent)` で上書き |

## AFTER（最終ビルド）

| 受け入れ条件 | 実測 |
|---|---|
| 枠・つまみ・道具列・メニュー・丸ボタンが出力の枠の外で切れない | 下端の字幕・上端の置いた文字・端の図形: 切れ 0 件（横長・縦長・fit / 50% / 200%）。写真の左上端: 枠 0.933・上辺のつまみ 0.17（横長）/ 0.991（縦長）— 残りは webview の表示範囲の上端より外（stage の overflow ではない） |
| 表示範囲の端では見える位置へ逃がす | 置いた文字を上端へ: 道具列は枠の横へ（可視 1.0）。130% / 160% / 200% で枠が表示範囲の外（可視 0）でも道具列・回転/移動の丸は可視 1.0（`after/landscape-zp/`）。下端の字幕 200%: 道具列 1.0 |
| 上の素材に隠れた字幕のつまみが見えて押せる | 白丸・折り返しつまみ・丸ボタンが紫の写真の上に描かれる（`after/landscape/after-b-hidden-caption-selected.png`）。se を押すと字幕の `text_style.scale = 1.439` が書かれ、cover の transform は不変 |
| 変形中はホストのバー・道具列（本体ごと）が隠れ、離すと戻る | 字幕の移動 / 拡大縮小 / 折り返し幅・写真の移動の最中: ホストのバー非表示・道具列 `visibility:hidden`。離すとバーが戻る（横長・縦長）。押したまま 2.8 秒止めてもバーは戻らない |
| 拡大縮小・回転の最中に枠がポインタに毎フレーム追従（動きの付いた素材でも） | 写真の se: ポインタとつまみ 1.5px・枠 158.2×103.9 = 画像 158.1×103.9。キーフレーム付き写真: 1.5px・枠 = 画像。回転: 枠 −82.45° = 画像 −82.45°（縦長 −90° = −90°）。cut: 1.3px（横長）。縦長の cut は 22.6px だが、9:16 の等比の角が押した向きの対角線成分だけを追うため（枠の移動 (−19.2, −34.7) ≒ 対角線への射影 (−19.8, −35.3)、0/150/600ms で不変） |
| 吸着ガイドがオレンジ | 図形・写真のドラッグ中のガイド背景 rgb(255,139,44) = #ff8b2c（`interaction.css` と同じ） |
| 書き出しに UI 層が写らない | (f) render-cut `--engine osr`（`launcher_tier: 2`）の 1 秒のフレームで #4da3ff / #ff8b2c 近傍の画素 0（横長・縦長 `after/export/`）。プレビューの撮影（`html.akari-gen-capturing`）中は `#preview-chrome-layer` と枠・つまみが非表示 |
| 字幕の編集中のキャレット | (g) ダブルクリックで編集へ: `activeElement` は字幕プレートの中の contenteditable、選択範囲もプレートの中（`after/*-c/after-g-caption-caret.png`） |

証跡の JSON / スクショから作業機の絶対パスは除いてある。
