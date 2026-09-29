# preview-3d-refresh（#100）— ブラウザプレビューの 3D 取り直し・失敗表示の実機証跡

Windows 11 + Edge（headless・SwiftShader）で、隔離プロジェクト（3D 断片 1 つ + glb 1 つ）を
`packages/preview-server/src/server.mjs` で開き、`scripts/l1-probe.mjs` が次の 3 段を自動で確かめた。
edit.json には一度も触れていない。

| 段 | 操作 | 判定 |
|---|---|---|
| 1 | glb を別名に退避した状態で開く | 画面に「3D」「読み込め」を含む可視要素がある |
| 2 | glb を rename で戻す | 8 秒以内に canvas 中央が赤（R>150, G<90, B<90） |
| 3 | glb を緑の glb で上書き | 8 秒以内に canvas 中央が緑（G>150 かつ R・B より 50 以上大きい） |

canvas の色は実スクリーンショットの中央 1 px から読む（`preserveDrawingBuffer` に依存しない）。
緑の閾値は、修正前コードで緑の glb を最初から置いて開いた対照（`data/control-green-base-results.json`）の
実測色 (147,228,89)（トーンマッピング後の純緑）で決めた。

## 結果

| | 1 失敗表示 | 2 復帰後の描画 | 3 差し替え後の色 |
|---|---|---|---|
| 修正前（49af07a62） | 出ない | 描かれない（8.1 s 待って背景色 22,35,56 のまま） | 変わらない（背景色のまま） |
| 修正後（1 回目） | 出る（`3Dを読み込めませんでした: fetch for "…/assets/models/probe.glb?akari_preview_rev=0" responded with 40…`） | 2.1 s で赤 (250,16,20) | 2.7 s で緑 (147,228,89) |
| 修正後（2 回目） | 出る | 1.9 s で赤 | 1.8 s で緑 |

スクリーンショット: `before-*.png` / `after-*.png`。生データ: `data/*.json`。

## 再現

```
node scripts/gen-glb.mjs fixture-src/red.glb 1 0 0
node scripts/gen-glb.mjs fixture-src/green.glb 0 1 0
node scripts/l1-probe.mjs <repoRoot> <label> <outDir> [port]
```

`l1-probe.mjs` はスクリプトの 1 つ上の `fixture-src/` から glb を読み、`proj-<label>/` に隔離プロジェクトを作る。
ブラウザは `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`、puppeteer-core は `packages/render-cut` から解決する。
