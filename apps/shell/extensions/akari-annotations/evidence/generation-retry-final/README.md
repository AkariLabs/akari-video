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

Node の組み込み WebSocket / fetch を使う（追加依存なし）。既存の同梱 ffmpeg で静止画と下書きの MP4 を作る。
必要なら `FFMPEG` と `AKARI_L1_ELECTRON` に各実行ファイルの絶対パスを指定する。
`AKARI_HOME`、`THEIA_CONFIG_DIR`、`--user-data-dir`、プロジェクトはすべて専用の一時ディレクトリ。
終了時に起動した Electron を停止し、一時ファイルを削除する。
`AKARI_GENERATE_CLI` は同梱の fake-generate.mjs に固定し、有償 API へは送信しない。

実操作は `Input.dispatchMouseEvent` で行う。失敗クリップの「もう一度」をクリックし、生成タブ・費用承認・承認前起動 0 件・承認後起動 1 件を確認する。
続けて下書き ON/OFF の解像度・select disabled・見積・保存済み next を確認する。
狭い失敗クリップにボタンがないこと、title に再試行の説明があることも確認する。
札・「もう一度」・名前（a.png）・時刻の4要素の矩形を測り、総当たり6組のいずれかが交差したら失敗にする。
既存 `evidence/inspector-generation/` のスクリプトとステップは変更しない。

既存の step 1〜4 に、次の step 5〜7 を追加している。

5. `clip-final`（H3 / 480P / done の実 MP4）を実クリックで選択し、「本番の画質にする…」と注記を確認する。元の静止画 `final.png` は `placeholder` で辿れ、`next` に選択解像度 768P が残っている。
6. 「本番の画質にする…」を押し、解像度の初期値が 768P（下書きより高い単価）、見積が $0.30 になることを確認。「動画にする」から費用承認ダイアログがちょうど1つ出ることを確認し、まずキャンセル。対象 item の偽 CLI 起動は0件、ログ全体も増えないことを記録する。
7. 再び「動画にする」から費用承認。対象 item の起動がちょうど1件（`--item clip-final`）、MP4 meta の `next.output.resolution` が選択値になることを確認する。元静止画 meta **ファイル全体**の SHA-256 を操作前・キャンセル後・承認後で比較し、バイト列の一致も記録する。

偽 CLI は既存の再試行では failed を書き、本番画質の item では起動記録のみで成功終了する。
したがって追加 L1 は承認と MP4 meta への保存・CLI 起動までを検証し、生成後の差し替えは既存の単体・統合テストが検証する。
step 4 の既存比較は、fixture を広げた分の15秒の見積（768P $0.90 → 480P $0.75 → $0.90）になる。

出力:

- `01-failed-timeline.png`
- `02-generation-approval.png`
- `03-failed-after-retry.png`
- `04-draft-on.png`
- `05-draft-off.png`
- `06-final-quality-note.png`
- `07-final-quality-approval.png`
- `08-final-quality-after.png`
- `results.json`: 全7ステップ、起動記録、解像度・見積、ボタン・札・名前・時刻の矩形と6組の非交差、計算後の背景・枠線・pointer-events。本番画質の計測は `measurements.finalQuality` に承認ごとのダイアログ数、キャンセル後0件・承認後1件、MP4 の next、元静止画 meta の前後 SHA-256 を保存する。
- `electron.log`（パスを匿名化）。失敗時は `99-failure.png`。

スクリーンショットはラッパーでも目視する。計測 JSON だけで見た目の合格とはしない。

本番画質の CLI 対応は `test/generation-retry-final.test.mjs` で既存 RPC → 既存 CLI → 偽通信 → 同一 item の差し替えまで検証する。
元静止画の next は保持し、現在の mp4 meta の既存 next 欄へ送信下書きを保存するため、CLI の変更は不要。
下書き前の解像度は開いているインスペクター内で保持する。その記憶が無い場合は元静止画の next に残る選択値、無効ならカタログ順の既定へ戻る。最安値しか残っていない場合は、高い画質を選ぶまで送信できない。
