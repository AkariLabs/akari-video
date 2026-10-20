# Issue token → identify chat ID → register connection

## 1. Run doctor

```
SETUP_CHAT_SKILL=".claude/skills/setup-chat-approval"
[ -d "$SETUP_CHAT_SKILL" ] || SETUP_CHAT_SKILL="skills/setup-chat-approval"
node "$SETUP_CHAT_SKILL/bin/doctor.mjs" [プロジェクトルート]
```

Read-only, free, and offline. **Token values are never printed** (only presence and format validity).
Branch on `state`:

| state | Meaning | Next action |
|---|---|---|
| `no-credentials` | No `credentials.env` | §2 → §3 |
| `no-token` | File exists, token not registered | §2 → §3 |
| `token-malformed` | Token does not match `<数字>:<英数記号>` (existing format placeholder: digits followed by alphanumeric/symbol characters) | Ask user to paste it again in §3 |
| `no-chat-id` | Token exists, notification destination not registered | §4 |
| `not-registered` | Credentials complete, registry entry missing | §5 |
| `ready` | Everything present | [smoke-test.md](smoke-test.md) |

## 2. Issue a token with BotFather (human action — hard rule 1)

The agent does not perform this action. Give these instructions and wait for completion:

1. Open `@BotFather` in Telegram.
2. Enter `/newbot` → display name → username (must end in `_bot`).
3. A token appears. Explicitly tell the user: **Do not paste this value into the conversation.**

## 3. Ask the user to register it in credentials.env (human action)

Explain only the location and KEY name. **The agent does not write it.**

```
~/.akari/credentials.env      # 権限は 600
AKARI_TELEGRAM_BOT_TOKEN=<BotFather が出した値>
```

If the file is absent, guide creation followed by `chmod 600`. After completion is reported, rerun doctor to verify.

## 4. Identify the chat ID

Required to fix the notification destination (hard rule 2).

1. Ask the user to open the created bot in Telegram and send `/start` or any brief message.
2. Run this (`getUpdates` only, free, read-only):
   ```
   node "$SETUP_CHAT_SKILL/bin/find-chat-id.mjs"
   ```
3. Ask the user to append the displayed ID themselves:
   ```
   AKARI_TELEGRAM_CHAT_ID=<表示された ID>
   ```
4. Rerun doctor and verify `chatIdPresent: true`.

If output says no message has arrived yet, send 1 message to the bot and rerun.

## 5. Register the connection

Following `setup-connections` hard rule 7 (do not use unregistered connections),
add 1 entry to `providers` in the project's `.akari/connections.json`.
**Do not include values** (`env` only references KEY names). Template:
[`packages/schemas/examples/connections-v0-notify-valid/connections.json`](https://github.com/AkariLabs/akari-video/blob/main/packages/schemas/examples/connections-v0-notify-valid/connections.json).

After registration, validate the structure against the schema:

The following validator runs only in the monorepo (not bundled with distributed projects).

```
node packages/schemas/bin/validate-connections.mjs <プロジェクト>/.akari/connections.json
```

When doctor reports `state: ready`, continue to [smoke-test.md](smoke-test.md).
