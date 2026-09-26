# 設定 → このアプリについて の「アップデートを確認」（L1 実測）

`l1-settings-update-flow.mjs <before|after-available|after-latest|after-error> [--restart]` で開発版（`app.isPackaged === false`）の
Electron を CDP 9611・main inspector 9612 付きで起動し、設定ダイアログを `about` で開いて更新の行を読む。

- 更新フィードは `AKARI_UPDATER_TEST_FEED_URL`（generic provider）で `127.0.0.1:48911` のローカルサーバーへ向ける。
  新版 99.0.0 の zip は実行中の開発用 Electron.app 自身を固めたもの（アドホック署名の designated requirement を満たし、
  Squirrel.Mac の検証を通すため）。zip は 24MB/s に絞り、`latest-mac.yml` の応答は 2 秒遅らせる（押した直後の表示を観測するため）
- 起動時の自動確認は `update-preferences.json` の `autoCheck: false` で止め、確認はボタン押下だけにする
- `AKARI_HOME`・`THEIA_CONFIG_DIR`・`--user-data-dir` は一時ディレクトリ。main の `shell.openExternal` は「URL を積むだけのスタブ」
- スクリーンショットは設定ダイアログの矩形だけを切り出す

| シナリオ | 結果 |
|---|---|
| `before`（修正前） | 押した直後も、main がダウンロードを終えて `update-downloaded` を持った後も、行は「アップデートを確認できます / まだ確認していません」のまま（`before.json` `unchanged.same = true`・`before-0*.png`）。ホームの通知だけが「v99.0.0 の準備ができました」になっている |
| `after-available --restart` | 押した直後の描画で「確認しています…」+ ボタン無効 → 「v99.0.0 をダウンロードしています」（現在 v0.1.86 併記）→ 開き直さずに「v99.0.0 の準備ができました」+「再起動して更新」。ダウンロード済みの後の手動確認は updater.log の行数・フィードへの要求とも増えず、表示もそのまま。ダイアログを閉じた後に更新イベントを 4 種送っても例外 0。「再起動して更新」でアプリが終了（exit 0）し、ShipIt が入れ替えて再起動した（`after-available.json`・`after-available-0*.png`） |
| `after-latest` | フィード 0.0.1 → 「最新です（v0.1.86）」+ 最後に確かめた時刻を更新（`after-latest.json`・`after-latest-0*.png`） |
| `after-error` | 両フィードとも到達不能 → 「更新を確認できませんでした: 更新の配信先に接続できませんでした…」+「もう一度確かめる」+「ブラウザで入手」。ブラウザ誘導はリリースページ（`after-error.json`・`after-error-0*.png`） |

`before` はハーネスの初版（yml の応答遅延・スタブの入れ方の調整前）で撮った。修正前のコードでは押しても行が一切変わらないので、遅延の有無は結果に影響しない。
