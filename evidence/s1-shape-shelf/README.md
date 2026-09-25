# S-1 図形の棚 — 検証の証跡

| パス | 中身 |
|---|---|
| `before/` | BEFORE（基点のビルド・実機）: ライブラリのホームの「図形」タイルが `disabled` +「近日」（`before.json`・`before-library-home.png`） |
| `after/` | AFTER（実機・Electron + CDP・1680×940）: `after.json` = 全手順の実測（棚の行・見本の色・左右スライド・星 → undo・ハート（center 指定）・ライン・タイムラインへのドロップ・叫び・最近使用・検索・書き出しとの SSIM）。`after-shelf-*.png` = 棚（暗い / 明るい / スライド / 最後の行）、`after-lines-all-*.png` = ラインのすべて表示、`after-*-stage.png` = 置いた直後のプレビュー、`compare-*` = 同じ時刻のプレビューと書き出し（render-cut）のフレーム、`after-edit.json` = 最後の edit.json |
| `static/` | 実機の代わりではない静的な描画。`static-shelf-*.png` = 本物の棚コンポーネントを react-dom/server で描いた見本の SVG を行ごとに並べたシート（暗い = 白・明るい = 黒）。`static-lines-all-dark.png` = ラインの「すべて表示」45 本。`static-placed-frame.png` = `addShapeAt` が書く item を edit-store の降下（プレビューと書き出しが使う SVG）で 1920×1080 に並べたもの（赤い点 = item の中心） |
| `run-before.mjs` / `run-after.mjs` | 実機（Electron + CDP）の手順。`run-after.mjs` は受け入れ条件の手順（棚 → 星 → undo → ハート → ライン → 叫び → 最近使用 → 検索 → 書き出しとの比較）を通す |
| `static-shelf-sheet.mjs` / `static-placed.mjs` | `static/` の生成 |
| `cdp-lib.mjs` / `fixture.mjs` | 共通部品（隔離プロジェクト・CDP） |
