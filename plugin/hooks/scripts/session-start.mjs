#!/usr/bin/env node
// Generated status-core is the only workflow-state resolver used by this hook. The hook remains
// fail-safe for Claude SessionStart, but a missing/broken core is reported explicitly and never
// replaced with a second stage table.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const STATUS_CORE_URL = new URL("../../runtime/status-core/status.mjs", import.meta.url);

async function main() {
  if (process.argv[2] === "--status-json") {
    try {
      const core = await import(STATUS_CORE_URL);
      const argumentsList = process.argv.slice(3);
      const full = argumentsList.includes("--full");
      const paths = argumentsList.filter((value) => value !== "--full");
      if (paths.length > 1 || paths.some((value) => value.startsWith("-"))) {
        throw new Error("plugin status accepts one project path and optional --full");
      }
      const projectRoot = resolve(paths[0] ?? process.cwd());
      const status = full
        ? await core.resolveFullProjectStatus(projectRoot)
        : core.resolveProjectStatus(projectRoot, { mode: "fast" });
      process.stdout.write(core.serializeStatus(status));
    } catch (error) {
      process.stderr.write(`AKARI status unsupported: canonical plugin status-core is unavailable (${messageOf(error)})\n`);
      process.exitCode = 1;
    }
    return;
  }

  const hookInput = await readHookInput();
  const cwd = typeof hookInput.cwd === "string" && hookInput.cwd
    ? resolve(hookInput.cwd)
    : resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  // 拡張キットの marketplace はユーザーが一度だけ有効化する。台帳と Claude Code の
  // 設定は読み取りだけに留め、未有効時もセッションを止めず 1 行だけ案内する。
  let kitNudge = "";
  try {
    const akariHome = process.env.AKARI_HOME || join(homedir(), ".akari");
    const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    const ledger = JSON.parse(readFileSync(join(akariHome, "kits", "installed.json"), "utf8"));
    const settingsPath = join(claudeConfigDir, "settings.json");
    const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
    if (Array.isArray(ledger?.kits) && ledger.kits.length > 0
      && !Object.hasOwn(settings?.enabledPlugins ?? {}, "akari-kits@akari-kits")) {
      kitNudge = "Claude Code で拡張キットを有効化してください: claude plugin marketplace add ~/.akari/kits → claude plugin install akari-kits@akari-kits（claude が PATH に無い場合は、Claude Code のプラグイン設定で ~/.akari/kits を marketplace として追加してください）";
    }
  } catch {
    // 台帳や設定が無い・壊れている場合は既存の SessionStart を優先して黙って続行する。
  }
  if (!existsSync(resolve(cwd, ".akari"))) {
    if (kitNudge) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: kitNudge } }));
    return;
  }

  let additionalContext;
  try {
    const core = await import(STATUS_CORE_URL);
    if (core.detectStatusScope(cwd) === "workspace") {
      const workspace = core.resolveWorkspaceStatus(cwd);
      if (!workspace) return; // fail-safe: root.json is unreadable/unknown schema — stay silent
      additionalContext = [
        "AKARI Video 作業場の続きから。",
        core.formatWorkspaceStatusSummary(workspace),
        "Canonical workspace status JSON:",
        core.serializeWorkspaceStatus(workspace).trimEnd(),
      ].join("\n");
    } else {
      const status = core.resolveProjectStatus(cwd, { mode: "fast" });
      additionalContext = [
        "AKARI Video プロジェクトの続きから。",
        core.formatStatusSummary(status),
        "Canonical status JSON:",
        core.serializeStatus(status).trimEnd(),
      ].join("\n");
    }
  } catch (error) {
    additionalContext = `AKARI Video: 状態取得不能。canonical status-core を読み込めませんでした (${messageOf(error)})。旧ロジックへのフォールバックはしません。`;
  }
  if (kitNudge) additionalContext = `${additionalContext}\n${kitNudge}`;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
    },
  }));
}

async function readHookInput() {
  const source = await readStdin();
  try {
    const value = JSON.parse(source || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function readStdin() {
  return new Promise((resolvePromise) => {
    if (process.stdin.isTTY) return resolvePromise("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolvePromise(data));
    process.stdin.on("error", () => resolvePromise(data));
  });
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `AKARI Video: 状態取得不能 (${messageOf(error)})。`,
    },
  }));
  process.exitCode = 0;
});
