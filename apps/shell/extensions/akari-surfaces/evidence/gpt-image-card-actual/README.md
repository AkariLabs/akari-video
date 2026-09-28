# 設定 › AI モデル — GPT Image 2.5 のカードに実際の料金と大きさを出す（L1 証跡）

開発ビルドの Electron を一時プロファイル（`HOME` / `AKARI_HOME` / `THEIA_CONFIG_DIR` /
`--user-data-dir` / 作業場をすべて使い捨て）で起動し、CDP 経由で `capture.mjs` が
設定 › AI モデル › 静止画を開いて観測する。「まだ呼べないモデルも表示」を入れて
Sunburst も比べるの候補に入れ、Flare・Nano Banana 2・Sunburst の 3 つを比べる。

| ファイル | 中身 |
|---|---|
| `before-01-flare-card.png` | 修正前のカード: `$0.006 / 枚`・`解像度 〜3840×2160` |
| `before-02-compare-table-radar.png` / `before-03-compare-table.png` | 修正前の比べる（料金・安さ $0.006、レーダーの解像度 3840） |
| `after-01-flare-card.png` | 修正後のカード: `$0.053 / 枚（品質 高・1024² 基準）` + 小さく `低 $0.006 · 中 $0.013`、`解像度 16:9 で 1088×608` + 小さく `モデルの上限 3840×2160` |
| `after-02-compare-table-radar.png` / `after-03-compare-table.png` | 修正後の比べる: 料金・安さが $0.053（品質 高）、出力: 解像度が `16:9 で 1088×608（モデルの上限 3840×2160）`、レーダーの解像度軸は `AKARI で最大 2016 px`（2016 / 3840）。Nano Banana 2（by_resolution）は `$0.06 / 枚`・`〜4K` のまま |
| `before-observed.json` / `after-observed.json` | CDP で読んだカードの文言・比べるの表の全行・レーダーの座標 |

## 再現

```sh
cd apps/shell && npm run build
# 使い捨てのプロファイルで Electron を --remote-debugging-port=<port> 付きで起動してから:
L1_PORT=<port> L1_OUT=<出力先> L1_PHASE=after NODE_PATH=<playwright-core を入れたスクラッチ>/node_modules \
  node apps/shell/extensions/akari-surfaces/evidence/gpt-image-card-actual/capture.mjs
```
