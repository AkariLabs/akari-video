# 疎通確認（通知の到達 + ボタン承認）

両方が取れるまで「構成済み」と言わない（ハードルール 6）。

## 1. report-helper を起動する

承認レポートを配信しているヘルパーが必要（ブリッジはこの API 経由でのみ `decisions.json` を更新する）。

```
node packages/decision-cards/report-helper.mjs <report.html のパス> --port <port>
```

標準出力の `HELPER: http://localhost:<port>/` を控える。

## 2. ブリッジを起動して通知を送る

```
node packages/chat-bridge/src/telegram.mjs \
  --helper http://127.0.0.1:<port> \
  --report-url <setup-remote が用意した tailnet 限定 URL> \
  --title "<プロジェクト名> — 承認をお願いします" \
  --summary "<1〜2 行の要約>" \
  --photo <キーフレーム画像のパス>
```

- `--photo` は繰り返し可（最大 6 枚）。**レポートの画像だけを送る**。撮影素材の原本は送らない
- `--report-url` は省略可。省略するとリンクボタンが出ないだけで通知は成立する
- 応答を待たずに通知だけ出したいときは `--notify-only`

## 3. 実機で確認する（この 2 点が疎通確認）

1. **通知の到達**: スマホの Telegram に、要約・画像・ボタンが届く
2. **ボタン承認**: 「おまかせで確定」をタップ → チャットに「確定しました」が返り、
   **Mac 側の `<report.html>.decisions.json` の `completedAt` が非 null になる**

`completedAt` を目視で確認するまで完了としない。すでに確定済みのレポートに対しては
「すでに確定済みです」が返る（report-helper が 409 を返すため。二重確定は起きない）。

## 4. よくある詰まり

| 症状 | 原因と対処 |
|---|---|
| 通知が届かない | chat ID が違う。bot に 1 通送ってから `find-chat-id.mjs` を再実行して照合する |
| ボタンを押しても無反応 | ブリッジが終了している（`--max-wait` 到達 / 既に確定処理を終えて終了）。再起動する |
| 「確定に失敗しました」 | report-helper が落ちているか `--helper` のポートが違う。`curl <helper>/api/state` で確認する |
| リンクを押しても開かない | スマホの Tailscale がオフ、または Mac がスリープ（setup-remote 側の問題） |

## 5. 完了レポート

- 通知の到達 / ボタンでの `completedAt` 更新の 2 点の結果を提示する
- **トークンと chat ID の値は書かない**（ハードルール 1）。記録してよいのは「設定済み」という事実だけ
- 記録の永続化はユーザーが望んだ場合のみ、作業場の `akari.md` への追記を提案する
