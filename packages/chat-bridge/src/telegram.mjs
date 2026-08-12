#!/usr/bin/env node
// 承認ゲートの通知 + ボタン承認ブリッジ（Telegram / v0）。
// 契約: docs/contract-2026-08-12-chat-approval-v0.md
//
// 設計上の要点:
//   - decisions.json を直接書かない。report-helper の HTTP API 経由でのみ更新する
//   - ポートを listen しない。送受信とも outbound（long polling）のみ
//   - 受け付けるのは登録済み chat ID からの、閉じた集合の callback_data だけ

import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  ACTIONS,
  CHAT_ENV_KEY,
  TOKEN_ENV_KEY,
  buildKeyboard,
  parseCredentials,
  redactToken,
  selectActions,
} from "./telegram-core.mjs";

const MAX_PHOTOS = 6;
const POLL_TIMEOUT_SECONDS = 25;

function usage() {
  return `使い方:
  node packages/chat-bridge/src/telegram.mjs --helper <URL> [オプション]

必須:
  --helper <URL>        report-helper のベース URL（例 http://127.0.0.1:8791）

オプション:
  --report-url <URL>    チャットの「レポートを開く」ボタンが指す URL（tailnet 限定 URL）
  --title <文字列>       見出し（既定: 承認をお願いします）
  --summary <文字列>     本文の要約
  --photo <パス>         添える画像（繰り返し可・最大 ${MAX_PHOTOS} 枚）
  --max-wait <秒>        承認を待つ上限（既定 3600）
  --notify-only         通知だけ送って終了する（応答を待たない）

認証情報は ~/.config/akari-video/credentials.env（600）から読む。
  ${TOKEN_ENV_KEY}=...   BotFather が発行したトークン
  ${CHAT_ENV_KEY}=...    通知先の chat ID（この ID 以外からの応答は破棄する）`;
}

function parseArguments(argv) {
  const options = {
    helper: null,
    reportUrl: null,
    title: "承認をお願いします",
    summary: null,
    photos: [],
    maxWaitSeconds: 3600,
    notifyOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${flag} に値がありません`);
      index += 1;
      return value;
    };

    switch (flag) {
      case "--helper": options.helper = next(); break;
      case "--report-url": options.reportUrl = next(); break;
      case "--title": options.title = next(); break;
      case "--summary": options.summary = next(); break;
      case "--photo": options.photos.push(next()); break;
      case "--max-wait": options.maxWaitSeconds = Number(next()); break;
      case "--notify-only": options.notifyOnly = true; break;
      case "--help": case "-h": console.log(usage()); process.exit(0); break;
      default: throw new Error(`不明な引数: ${flag}`);
    }
  }

  if (options.helper === null) throw new Error("--helper は必須です");
  if (!Number.isFinite(options.maxWaitSeconds) || options.maxWaitSeconds <= 0) {
    throw new Error("--max-wait は正の秒数で指定してください");
  }
  if (options.photos.length > MAX_PHOTOS) {
    throw new Error(`--photo は最大 ${MAX_PHOTOS} 枚までです`);
  }

  options.helper = options.helper.replace(/\/+$/, "");
  return options;
}

async function loadCredentials() {
  const path =
    process.env.AKARI_CREDENTIALS_FILE ??
    join(homedir(), ".config", "akari-video", "credentials.env");

  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    throw new Error(
      `credentials.env がありません: ${path}\n` +
        `作成して 600 にし、${TOKEN_ENV_KEY} と ${CHAT_ENV_KEY} を 1 行ずつ登録してください。`,
    );
  }

  const mode = (fileStat.mode & 0o777).toString(8).padStart(3, "0");
  if (mode !== "600") {
    console.warn(`警告: credentials.env の権限が 600 ではありません（現在 ${mode}）。chmod 600 ${path}`);
  }

  const { token, chatId } = parseCredentials(await readFile(path, "utf8"));
  if (token === null) throw new Error(`${TOKEN_ENV_KEY} が credentials.env にありません: ${path}`);
  if (chatId === null) throw new Error(`${CHAT_ENV_KEY} が credentials.env にありません: ${path}`);
  return { token, chatId };
}

function apiUrl(token, method) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function callApi(token, method, payload, { isForm = false } = {}) {
  let response;
  try {
    response = await fetch(apiUrl(token, method), {
      method: "POST",
      ...(isForm ? { body: payload } : {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    });
  } catch (error) {
    throw new Error(`Telegram API 呼び出しに失敗（${method}）: ${redactToken(error.message, token)}`);
  }

  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* 非 JSON はそのまま扱う */ }

  if (!response.ok || parsed?.ok !== true) {
    const detail = parsed?.description ?? text.slice(0, 300);
    throw new Error(`Telegram API がエラーを返しました（${method}）: ${redactToken(detail, token)}`);
  }

  return parsed.result;
}

async function sendPhotos(token, chatId, photos) {
  for (const photoPath of photos) {
    let bytes;
    try {
      bytes = await readFile(photoPath);
    } catch {
      console.warn(`警告: 画像を読めませんでした（送信をスキップ）: ${photoPath}`);
      continue;
    }

    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("photo", new Blob([bytes]), basename(photoPath));
    await callApi(token, "sendPhoto", form, { isForm: true });
  }
}

function composeText(options) {
  const lines = [`🎬 ${options.title}`];
  if (options.summary !== null && options.summary !== "") lines.push("", options.summary);
  return lines.join("\n");
}

async function commitViaHelper(helper) {
  const response = await fetch(`${helper}/api/commit`, { method: "POST" });
  const body = await response.text();

  if (response.status === 409) return { ok: false, reason: "already-committed" };
  if (!response.ok) return { ok: false, reason: `helper-${response.status}: ${body.slice(0, 200)}` };
  return { ok: true };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { token, chatId } = await loadCredentials();

  await sendPhotos(token, chatId, options.photos);

  const sent = await callApi(token, "sendMessage", {
    chat_id: chatId,
    text: composeText(options),
    disable_web_page_preview: true,
    reply_markup: buildKeyboard(options.reportUrl),
  });

  console.log(`通知を送信しました（message_id: ${sent?.message_id ?? "?"}）`);
  if (options.notifyOnly) return;

  const seen = new Set();
  const deadline = Date.now() + options.maxWaitSeconds * 1000;
  let offset;

  while (Date.now() < deadline) {
    let updates;
    try {
      updates = await callApi(token, "getUpdates", {
        ...(offset === undefined ? {} : { offset }),
        timeout: POLL_TIMEOUT_SECONDS,
        allowed_updates: ["callback_query"],
      });
    } catch (error) {
      console.warn(`警告: ${error.message}（10 秒後に再試行）`);
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      continue;
    }

    const { actions, rejected, nextOffset } = selectActions(updates, {
      allowedChatId: chatId,
      seen,
    });

    // 破棄したものも含めて offset を進める（詰まり防止 — telegram-core.mjs 参照）
    if (nextOffset !== null) offset = nextOffset;
    for (const entry of rejected) {
      if (entry.updateId !== null) seen.add(entry.updateId);
      if (entry.reason === "chat-not-allowed") {
        console.warn("警告: 登録外の chat からの応答を破棄しました");
      }
    }

    for (const action of actions) {
      seen.add(action.updateId);

      if (action.action === ACTIONS.LATER) {
        await callApi(token, "answerCallbackQuery", {
          callback_query_id: action.callbackQueryId,
          text: "あとで確認します",
        });
        console.log("「あとで」を受け取りました。承認待ちを終了します。");
        return;
      }

      const result = await commitViaHelper(options.helper);
      await callApi(token, "answerCallbackQuery", {
        callback_query_id: action.callbackQueryId,
        text: result.ok
          ? "確定しました"
          : result.reason === "already-committed"
            ? "すでに確定済みです"
            : "確定に失敗しました",
      });

      await callApi(token, "sendMessage", {
        chat_id: chatId,
        text: result.ok
          ? "✅ 確定しました。処理を続行します。"
          : result.reason === "already-committed"
            ? "ℹ️ すでに確定済みでした。"
            : `⚠️ 確定に失敗しました: ${result.reason}`,
        disable_web_page_preview: true,
      });

      console.log(result.ok ? "確定しました。" : `確定できませんでした: ${result.reason}`);
      return;
    }
  }

  console.log("承認を待つ上限に達しました。ブリッジを終了します。");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
