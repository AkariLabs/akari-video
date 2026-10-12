# Connectivity check (notification delivery + button approval)

Do not say “configured” until both pass (hard rule 6).

## 1. Start report-helper

A helper serving the approval report is required (the bridge updates `decisions.json` only through this API).

```
node packages/decision-cards/report-helper.mjs <report.html のパス> --port <port>
```

Note stdout's `HELPER: http://localhost:<port>/`.

## 2. Start the bridge and send a notification

```
node packages/chat-bridge/src/telegram.mjs \
  --helper http://127.0.0.1:<port> \
  --report-url <setup-remote が用意した tailnet 限定 URL> \
  --title "<プロジェクト名> — 承認をお願いします" \
  --summary "<1〜2 行の要約>" \
  --photo <キーフレーム画像のパス>
```

- Repeat `--photo` for up to 6 images. **Send only report images.** Do not send original footage.
- `--report-url` is optional. Omitting it removes the link button but still sends a notification.
- Use `--notify-only` to notify without waiting for a response.

## 3. Check on a real device (these 2 items are the connectivity check)

1. **Notification delivery**: Summary, images, and buttons arrive in Telegram on the phone.
2. **Button approval**: Tap the auto-confirm button → chat returns a confirmation →
   **`completedAt` in the Mac's `<report.html>.decisions.json` becomes non-null**.

Do not mark complete until you visually check `completedAt`. For an already finalized report,
a message saying it is already finalized is returned (report-helper returns 409, preventing double finalization).

## 4. Common problems

| Symptom | Cause and fix |
|---|---|
| Notification does not arrive | Wrong chat ID. Send 1 message to the bot, then rerun `find-chat-id.mjs` and compare. |
| No response to button | Bridge has exited (`--max-wait` reached / finalization already finished). Restart it. |
| Finalization failure message | report-helper has stopped or `--helper` specifies the wrong port. Check with `curl <helper>/api/state`. |
| Link does not open | Phone Tailscale is off or Mac is asleep (setup-remote issue). |

## 5. Completion report

- Present the 2 results: notification delivery / button-driven `completedAt` update.
- **Do not write token or chat ID values** (hard rule 1). Only the fact that configuration is complete may be recorded.
- Propose appending persistent records to workspace `akari.md` only if the user wants this.
