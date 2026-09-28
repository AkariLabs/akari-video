# 証跡: 出力プレビューの素材解決を要求元ウィンドウの roots で判定する（#98）

## L1（Windows 11・開発配置の Electron 39.8.7）

隔離環境（`--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME` をすべて `C:/t/pwr/<tag>/` 以下）で、

1. プロジェクト A（`ws-a`）を開く
2. 同じユーザーデータで 2 回目の起動をしてプロジェクト B（`ws-b`）を開く
   （singleInstance の second-instance 経路。1 つの backend に 2 窓がぶら下がる。
   `recentworkspace.json` の先頭 = B）
3. A の窓で `edit.json` を開く（出力プレビュー）

fixture は `test-project` の複製で、主動画を `assets/source.mp4` に移し、`sources[].path` を
`assets/source.mp4` に書き換えたもの（出力プレビューが `resolveProjectAssetUri` を通す形）。

| 版 | 結果 | 画像 |
|---|---|---|
| 修正前（基点 49af07a62 を同じ手順でビルドしたもの） | 通知「edit.json: 動画プレビューを開けませんでした — Project is outside the workspace」。backend ログのスタックは `resolveProjectAssetUri` | `before-01-window-a-output-preview-attempt1.png` |
| 修正後（本ブランチ） | エラー通知なし。出力プレビューが開き、ステージに動画の 1 コマ目（青）が描かれる | `after-01-window-a-output-preview-attempt1.png` |

- `*-00-two-windows-{a,b}.png`: プレビューを開く直前の 2 窓
- `data/{before,after}-l1.json`: 手順ごとの観測値（窓の準備・MRU・通知・プレビューの DOM 状態・backend ログの該当行）
- スクリーンショットはステータスバー（OS ユーザー名が出る）を除いて撮っている

再実行: `scripts/l1-fixture.mjs <tag>` → `scripts/l1-run.mjs <tag> <cdpPort> <outDir>`
（環境変数 `AKARI_WT` = worktree ルート。`apps/shell` で `theia build` 済みであること。
`ELECTRON_RUN_AS_NODE` は子プロセスの env から外している）

## 単体テスト

`test/preview-window-roots.test.mjs`（MRU を別プロジェクト B に向けた状態）:

- 基点のソースでビルドした lib: 2 件とも赤（`Project is outside the workspace`）
- 修正後: 2 件とも緑

`scripts/failset.mjs` は `node --test --test-reporter=spec` の出力から失敗テストの集合を取り出す道具
（Windows の既存失敗があるため、件数ではなく集合で基点と比べた）。
