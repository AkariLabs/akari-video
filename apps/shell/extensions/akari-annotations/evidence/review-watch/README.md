# review.json 監視 root ガード L1 証跡

隔離プロジェクトでインスペクターを前面にした後、ワークスペース外および除外ディレクトリ内の
`review.json` が右パネルを奪わず、正規のプロジェクトレビューだけが注釈パネルを一度開くことを
CDP から検証する。

撮影内容:

- `01-skipped-review-inspector.png`: `AKARI_HOME/cli/**`、`node_modules/**`、`vendor/**` に
  `review.json` を各 3 本追加した後も、インスペクターが前面で activate 記録が 0 件
- `02-valid-review-panel.png`: `.akari/reviews/dogfood/**` に 3 本をほぼ同時に追加し、
  注釈パネルが前面になって activate 記録が 1 件

再現コマンド（先に `apps/shell` の production build を作る）:

```sh
cd apps/shell
npm run build
node extensions/akari-annotations/evidence/review-watch/scripts/l1-review-watch.mjs
```

実行結果は `results.json`、隔離した `AKARI_HOME`、`THEIA_CONFIG_DIR`、user-data と診断ログは
`runs/l1/` に保存される。本物のユーザー設定や AKARI_HOME は使用しない。スクリプトは Electron を
detached にせず起動し、終了時は自分が起動した PID だけを停止して、生存プロセス数を記録する。
