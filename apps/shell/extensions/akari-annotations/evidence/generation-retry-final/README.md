# Generation retry / draft / final quality — L1

ラッパーが GUI の使えるホストで実行する。Electron 起動・L1 実行は実装者のサンドボックスでは行わない。

リポジトリルートから:

```sh
cd apps/shell
npm run build
cd ../..
node apps/shell/extensions/akari-annotations/evidence/generation-retry-final/scripts/l1-generation-retry-final.mjs --port=22224
```

`Emulation.setDeviceMetricsOverride` でビューポートを 1600×1100（deviceScaleFactor: 1）に固定する。

Node の組み込み WebSocket / fetch を使う（追加依存なし）。既存の同梱 ffmpeg で静止画を作る。
必要なら `FFMPEG` と `AKARI_L1_ELECTRON` に各実行ファイルの絶対パスを指定する。
`AKARI_HOME`、`THEIA_CONFIG_DIR`、`--user-data-dir`、プロジェクトはすべて専用の一時ディレクトリ。
終了時に起動した Electron を停止し、一時ファイルを削除する。
`AKARI_GENERATE_CLI` は同梱の fake-generate.mjs に固定し、有償 API へは送信しない。

実操作は `Input.dispatchMouseEvent` で行う。失敗クリップの「もう一度」をクリックし、生成タブ・費用承認・承認前起動 0 件・承認後起動 1 件を確認する。
続けて下書き ON/OFF の解像度・select disabled・見積・保存済み next を確認する。
狭い失敗クリップにボタンがないこと、title に再試行の説明があることも確認する。
既存 `evidence/inspector-generation/` のスクリプトとステップは変更しない。

出力:

- `01-failed-timeline.png`
- `02-generation-approval.png`
- `03-failed-after-retry.png`
- `04-draft-on.png`
- `05-draft-off.png`
- `results.json`: 各ステップ、起動記録、解像度・見積、ボタン・札・時刻の矩形と非交差、計算後の背景・枠線・pointer-events。
- `electron.log`（パスを匿名化）。失敗時は `99-failure.png`。

スクリーンショットはラッパーでも目視する。計測 JSON だけで見た目の合格とはしない。

本番画質の CLI 対応は `test/generation-retry-final.test.mjs` で既存 RPC → 既存 CLI → 偽通信 → 同一 item の差し替えまで検証する。
元静止画の next は保持し、現在の mp4 meta の既存 next 欄へ送信下書きを保存するため、CLI の変更は不要。
下書き前の解像度は開いているインスペクター内で保持する。再起動後はカタログ順の既定に戻り、最安値が既定なら高い画質を選ぶまで送信できない。
