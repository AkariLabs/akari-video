# Webview resolve timing observer

隔離起動したアプリの CDP ポートへ、生の Chrome DevTools Protocol で接続する計測スクリプトです。アプリや拡張を起動する処理は含みません。Node 22 以降で実行してください。

```sh
node apps/shell/extensions/akari-theme/evidence/codex-view-lazy-resolve/observe.mjs --port 9490 --out .tmp-lane/codex-view-events.jsonl --seconds 90
```

`--port` は `AKARI_CDP_PORT`、`--out` は `AKARI_CDP_OUT`、`--seconds` は `AKARI_CDP_SECONDS` でも指定できます。出力は JSON Lines で、各行に壁時計の ISO 時刻と観測開始からの経過ミリ秒を含みます。計測結果はこのディレクトリに保存せず、隔離作業用の出力先を指定してください。

スクリプトは `plugin-webview` の各 `WebviewWidget` を見つけ、`setHTML` 時の可視状態と iframe の有無、可視状態の遷移、webview からの `ready` メッセージ、通知文言を記録します。アプリ起動前から observer を待機させると、最初の HTML 設定も捕捉できます。HTML 本文や接続情報は出力しません。
