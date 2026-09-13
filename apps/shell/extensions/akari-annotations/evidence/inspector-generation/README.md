# インスペクター生成パネル L1 証跡

3 枚の静止画クリップを持つ隔離プロジェクトで、カタログ駆動の生成欄、費用承認、偽 CLI による
生成中チップを CDP から検証する。実 API への送信は行わない。

撮影内容:

- `01-model-h3.png`: H3 の欄、常時音声、as_of 付き見積
- `02-model-kling.png`: Kling standard の negative prompt、上限なし参照画像、見積不可
- `03-model-veo.png`: Veo FLF の最後のフレームと尺の正規化
- `04-cost-approval-dialog.png`: 金額・as_of・model id を含む費用承認
- `05-timeline-chip-generating.png`: 費用承認後、偽 CLI 実行中のタイムラインチップ

再現コマンド（先に `apps/shell` の production build を作る）:

```sh
cd apps/shell
npm run build
node extensions/akari-annotations/evidence/inspector-generation/scripts/l1-inspector-generation.mjs
```

ffmpeg を差し替える場合は `FFMPEG=/path/to/ffmpeg` を指定する。実行結果は `results.json`、隔離した
AKARI_HOME / THEIA_CONFIG_DIR / user-data は `runs/l1/` に保存される。スクリプトは Electron を
detached にせず起動し、終了時は自分が起動した PID だけを停止して生存数を記録する。
