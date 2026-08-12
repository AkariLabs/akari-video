#!/usr/bin/env node
// setup-chat-approval の決定論 doctor。読み取り専用・無償・ネットワークを使わない。
// トークンの値は絶対に出力しない（有無と長さの妥当性だけを見る）。
// 契約: docs/contract-2026-08-12-chat-approval-v0.md

import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

import {
  CHAT_ENV_KEY,
  TOKEN_ENV_KEY,
  parseCredentials,
} from "../../../packages/chat-bridge/src/telegram-core.mjs";

const PROVIDER_ID = "telegram-approval";

function credentialsPath() {
  return (
    process.env.AKARI_CREDENTIALS_FILE ??
    path.join(homedir(), ".config", "akari-video", "credentials.env")
  );
}

async function inspectCredentials() {
  const filePath = credentialsPath();
  const result = {
    path: filePath,
    exists: false,
    mode: null,
    modeIsSafe: null,
    tokenPresent: false,
    tokenLooksWellFormed: null,
    chatIdPresent: false,
  };

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return result;
  }

  if (!fileStat.isFile()) return result;

  result.exists = true;
  result.mode = (fileStat.mode & 0o777).toString(8).padStart(3, "0");
  result.modeIsSafe = result.mode === "600";

  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return result;
  }

  const { token, chatId } = parseCredentials(text);
  result.tokenPresent = token !== null;
  // 形だけ検査する（<数字>:<英数記号>）。値そのものは出力しない。
  result.tokenLooksWellFormed = token === null ? null : /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token);
  result.chatIdPresent = chatId !== null;

  return result;
}

async function inspectRegistry(projectRoot) {
  const filePath = path.join(projectRoot, ".akari", "connections.json");
  const result = { path: filePath, exists: false, providerRegistered: false, kind: null };

  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return result;
  }

  result.exists = true;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return result;
  }

  const provider = (parsed?.providers ?? []).find((entry) => entry?.id === PROVIDER_ID);
  if (provider !== undefined) {
    result.providerRegistered = true;
    result.kind = provider.kind ?? null;
  }

  return result;
}

function decideState(credentials, registry) {
  if (!credentials.exists) return "no-credentials";
  if (!credentials.tokenPresent) return "no-token";
  if (credentials.tokenLooksWellFormed === false) return "token-malformed";
  if (!credentials.chatIdPresent) return "no-chat-id";
  if (!registry.providerRegistered) return "not-registered";
  return "ready";
}

async function main() {
  const projectRoot = path.resolve(process.argv[2] ?? process.cwd());
  const credentials = await inspectCredentials();
  const registry = await inspectRegistry(projectRoot);

  const report = {
    schema: "akari.setup-chat-approval.doctor/v0",
    checkedAt: new Date().toISOString(),
    projectRoot,
    state: decideState(credentials, registry),
    credentials,
    registry,
    keys: { token: TOKEN_ENV_KEY, chatId: CHAT_ENV_KEY },
  };

  console.log(JSON.stringify(report, null, 2));

  if (credentials.exists && credentials.modeIsSafe === false) {
    console.error(
      `警告: ${credentials.path} の権限が 600 ではありません（現在 ${credentials.mode}）。chmod 600 してください。`,
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
