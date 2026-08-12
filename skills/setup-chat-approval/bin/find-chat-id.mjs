#!/usr/bin/env node
// bot に届いたメッセージから chat ID を見つけるだけの補助スクリプト。
// 読み取り専用（getUpdates のみ・無償）。credentials.env へは書き戻さない（人間が書く）。
// トークンは出力に出さない。

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

import { parseCredentials, redactToken } from "../../../packages/chat-bridge/src/telegram-core.mjs";

async function main() {
  const filePath =
    process.env.AKARI_CREDENTIALS_FILE ??
    path.join(homedir(), ".config", "akari-video", "credentials.env");

  const { token } = parseCredentials(await readFile(filePath, "utf8"));
  if (token === null) {
    console.error(`AKARI_TELEGRAM_BOT_TOKEN が ${filePath} にありません。`);
    process.exit(1);
  }

  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { method: "POST" });
  } catch (error) {
    console.error(`Telegram API に到達できません: ${redactToken(error.message, token)}`);
    process.exit(1);
  }

  const body = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* 非 JSON */ }

  if (!response.ok || parsed?.ok !== true) {
    console.error(
      `Telegram API がエラーを返しました: ${redactToken(parsed?.description ?? body.slice(0, 200), token)}`,
    );
    process.exit(1);
  }

  const found = new Map();
  for (const update of parsed.result ?? []) {
    const chat = update?.message?.chat ?? update?.callback_query?.message?.chat;
    if (chat?.id === undefined || chat?.id === null) continue;
    found.set(String(chat.id), chat.type ?? "unknown");
  }

  if (found.size === 0) {
    console.log(
      "まだメッセージが届いていません。Telegram で bot を開いて /start か任意の一言を送ってから、もう一度実行してください。\n" +
        "（bot が過去のメッセージを保持する期間は限られます）",
    );
    return;
  }

  console.log("見つかった chat ID:");
  for (const [id, type] of found) console.log(`  ${id}  (${type})`);
  console.log(
    "\nこの値を credentials.env に AKARI_TELEGRAM_CHAT_ID=<ID> として自分で追記してください（代理書き込みはしません）。",
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
