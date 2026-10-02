#!/usr/bin/env node
import path from "node:path";
import { isMainModule } from "../src/common/main-module.mjs";
import { settleDecisionLog } from "../src/decision-log/settle.mjs";

const usage = [
  "使い方: akari decision-log <subcommand> <project-dir> [options]", "",
  "  settle              予測行に結果行を追記",
  "  --actor <name>      決定者（既定 machine:render-cut）",
  "  --dry-run           書き込まず結果 JSON を表示",
  "  --json", "  --help",
].join("\n");

export async function runDecisionLogCli(argv, options = {}) {
  const stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = options.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    stdout(usage);
    return 0;
  }
  try {
    const [command, directory, ...rest] = argv;
    if (command !== "settle") throw new Error(`不明な subcommand です: ${command}`);
    if (!directory || directory.startsWith("-")) throw new Error("project-dir が必要です");
    const parsed = {};
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === "--dry-run") parsed.dryRun = true;
      else if (arg === "--json") continue;
      else if (arg === "--actor") {
        const value = rest[++index];
        if (!value?.trim() || value.startsWith("--")) throw new Error("--actor の値が必要です");
        parsed.actor = value;
      } else throw new Error(`不明なオプションです: ${arg}`);
    }
    const projectRoot = path.resolve(options.cwd ?? process.cwd(), directory);
    const result = await settleDecisionLog({ projectRoot, ...parsed });
    stdout(JSON.stringify({ ...result, results: result.results ?? [], path: path.join(projectRoot, "decision-log.md") }));
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isMainModule(import.meta.url)) process.exitCode = await runDecisionLogCli(process.argv.slice(2));
