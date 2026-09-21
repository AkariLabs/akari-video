# インスペクター生成パネル L1

既存の PNG / results.json は旧 UI の記録。更新スクリプトは次の 4 枚を撮影する。

- `01-h3-first-to-last.png`: H3 の最初・最後に別々のサムネ、種類「最初→最後」
- `02-prompt-only.png`: 両枠が空、種類「プロンプトだけ」、外すボタンなし
- `03-cost-approval-dialog.png`: 金額・as_of・モデルを含む費用承認 1 回
- `04-failed-retry.png`: 失敗後の「同じ入力でもう一度」

先に shell のビルドを用意し、リポジトリルートで実行する（依存の install は不要）。

```sh
node apps/shell/extensions/akari-annotations/evidence/inspector-generation/scripts/l1-inspector-generation.mjs
```

`FFMPEG=/path/to/ffmpeg`、`--port=22213` で実行環境を指定できる。
AKARI_HOME / THEIA_CONFIG_DIR / --user-data-dir は os.tmpdir() の専用一時ディレクトリ。
Electron は apps/shell/node_modules を優先し、無ければリポジトリ root の node_modules を使う。
終了時に自分が起動した Electron の PID・一時設定・fixture/ を片付ける。
素材は `fixture/project/` に毎回作り直す。実ユーザー設定・ライブラリを使わない。

同ディレクトリの `scripts/fake-generate.mjs` はネットワークを使わず、素材 meta の `next` と
起動引数を `fixture/project/fake-invocation.json` に記録して failed の生成物 meta を書く。
`--inputs` があれば失敗する。L1 はその引数と next の内容を `results.json` に記録する。

送信前と再試行の撮影直前にボタンを中央へスクロールし、矩形がインスペクターの可視範囲に
完全に収まることを assert する。results.json の step 3 / 5 にボタン矩形・可視範囲・判定を残す。
fixture/ を削除した後も、偽 CLI の引数と next は step 4 の記録に残る。
