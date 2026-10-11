# 設定とつなぐの L1 再現

ビルド済みの `apps/shell` を Electron で起動し、CDP 9441 で六つの柱、パートナーの状態、接続カード、偽の鍵の保存と末尾表示、サービスの有効スイッチと既定オフの自動切替、コマンドと左の列の導線、既存の設定項目を確認します。各柱と鍵の保存前後、左の列から開いた画面を撮影します。

```sh
node apps/shell/extensions/akari-surfaces/evidence/akari-settings-connect/run-l1.mjs [出力ディレクトリ]
```

`AKARI_L1_ELECTRON` で Electron 実行ファイルを指定できます。`AKARI_L1_OUT` でも出力先を指定できます。スクリーンショットと `measurements.json` は既定で一時ディレクトリへ書きます。全チェックが真のときだけ exit 0 です。
