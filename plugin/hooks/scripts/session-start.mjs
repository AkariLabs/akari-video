#!/usr/bin/env node
// Generated status-core is the only workflow-state resolver used by this hook. The hook remains
// fail-safe for Claude SessionStart, but a missing/broken core is reported explicitly and never
// replaced with a second stage table.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

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
  if (!existsSync(resolve(cwd, ".akari"))) return;

  let additionalContext;
  try {
    const core = await import(STATUS_CORE_URL);
    const status = core.resolveProjectStatus(cwd, { mode: "fast" });
    additionalContext = [
      "AKARI Video プロジェクトの続きから。",
      core.formatStatusSummary(status),
      "Canonical status JSON:",
      core.serializeStatus(status).trimEnd(),
    ].join("\n");
  } catch (error) {
    additionalContext = `AKARI Video: 状態取得不能。canonical status-core を読み込めませんでした (${messageOf(error)})。旧ロジックへのフォールバックはしません。`;
  }
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
