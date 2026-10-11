# akari-connect — L1 の再現手順

`run-l1.mjs` は build 済みの Electron shell を隔離ホームで起動し、CDP ポート 9455 で設定 › つなぐを検査します。fal に保存する鍵は偽物です。

```sh
cd apps/shell && npm run build && cd ../..
AKARI_CONNECT_L1_OUT="$(mktemp -d)" node apps/shell/extensions/akari-connect/evidence/akari-connect/run-l1.mjs
```

確認すること:

- 群は「AKARI の道具」「素材を作る」の 2 つ。AKARI Sounds、行き来する、渡す、Higgsfield、Runway、Suno は表示されない
- 素材サービス全 5 カードに `ai-makers.json` の画像ロゴがある
- 鍵を入れる前のレールには、状態が「使える」カードだけが並ぶ。素材を作る群までスクロールした `02b-material-services.png` も保存する
- 状態は「使える」「鍵が必要」、Blender が無い 3D レシピだけ「Blender が必要」
- 偽の鍵を fal に保存すると「使える」になり、左の列にも fal のアイコンが並ぶ
- 鍵は `credentials.env` に入り、`connectors.json` に値を残さない
- `akari.chat.prefill` が登録済みなら未登録時の通知確認を skipped として記録する。チャットへの依頼は実行せずに呼び出しだけ検査する
- 再読み込み後は CDP の応答を再試行し、必要なら再接続して鍵の永続化を確認する
- スクリーンショットと `l1-ui.json` を保存する

出力先は `AKARI_CONNECT_L1_OUT` で指定します。省略時はこの evidence ディレクトリに保存しますが、記録物は gitignore で除外します。出力をコミットしないでください。
Electron 実行体を別の場所に置いた場合は `AKARI_CONNECT_L1_ELECTRON` で指定できます。
