# トークン発行 → chat ID 特定 → レジストリ登録

## 1. doctor を実行する

```
node skills/setup-chat-approval/bin/doctor.mjs [プロジェクトルート]
```

読み取り専用・無償・ネットワークを使わない。**トークンの値は出力されない**（有無と形の妥当性だけ）。
`state` で分岐する:

| state | 意味 | 次の一手 |
|---|---|---|
| `no-credentials` | `credentials.env` が無い | §2 → §3 |
| `no-token` | ファイルはあるがトークン未登録 | §2 → §3 |
| `token-malformed` | トークンの形が `<数字>:<英数記号>` になっていない | §3 で貼り直してもらう |
| `no-chat-id` | トークンはあるが通知先が未登録 | §4 |
| `not-registered` | 認証情報は揃っているがレジストリ未登録 | §5 |
| `ready` | 揃っている | [smoke-test.md](smoke-test.md) へ |

## 2. BotFather でトークンを発行する（人間手番 — ハードルール 1）

エージェントは代行しない。次を案内して、完了報告を待つ:

1. Telegram で `@BotFather` を開く
2. `/newbot` → 表示名 → ユーザー名（`_bot` で終わる必要がある）を入力
3. トークンが表示される。**この値を会話に貼らないでください**と明示的に伝える

## 3. credentials.env へ登録してもらう（人間手番）

置き場と KEY 名だけを案内する。**エージェントは書き込まない**。

```
~/.config/akari-video/credentials.env      # 権限は 600
AKARI_TELEGRAM_BOT_TOKEN=<BotFather が出した値>
```

ファイルが無ければ作成 → `chmod 600` まで案内する。完了報告を受けたら doctor を再実行して確認する。

## 4. chat ID を特定する

通知先を固定するために必要（ハードルール 2）。

1. ユーザーに、作った bot を Telegram で開いて `/start` か任意の一言を送ってもらう
2. 次を実行する（`getUpdates` のみ・無償・読み取り専用）:
   ```
   node skills/setup-chat-approval/bin/find-chat-id.mjs
   ```
3. 表示された ID を、ユーザー自身に追記してもらう:
   ```
   AKARI_TELEGRAM_CHAT_ID=<表示された ID>
   ```
4. doctor 再実行で `chatIdPresent: true` を確認する

「まだメッセージが届いていません」と出る場合は、bot へ 1 通送ってから再実行する。

## 5. 接続レジストリへ登録する

`manage-connections` のハードルール 7（レジストリに無い接続を使わない）に従い、
プロジェクトの `.akari/connections.json` の `providers` に 1 件追加する。
**値は入れない**（`env` は KEY 名の参照のみ）。雛形は
[`packages/schemas/examples/connections-v0-notify-valid/connections.json`](../../packages/schemas/examples/connections-v0-notify-valid/connections.json)。

登録後、スキーマ検証で形を確かめる:

```
node packages/schemas/bin/validate-connections.mjs <プロジェクト>/.akari/connections.json
```

doctor が `state: ready` になったら [smoke-test.md](smoke-test.md) へ。
