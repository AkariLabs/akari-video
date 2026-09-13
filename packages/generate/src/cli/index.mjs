import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { GENERATE_USAGE } from "./usage.mjs";

const SUBCOMMANDS = new Set(["still", "video", "resume"]);

export async function runGenerateCommand(argv, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const logError = options.logError ?? ((line) => console.error(line));
  const [subcommand, ...rest] = argv;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    log(GENERATE_USAGE);
    return { exitCode: 0 };
  }
  if (!SUBCOMMANDS.has(subcommand)) {
    logError(`不明な generate サブコマンドです: ${subcommand}`);
    logError(GENERATE_USAGE);
    return { exitCode: 2 };
  }
  const moduleUrl = new URL(`./${subcommand}.mjs`, import.meta.url);
  if (!existsSync(moduleUrl)) {
    logError(`akari generate ${subcommand} は未同梱です。`);
    return { exitCode: 2 };
  }
  const module = await import(moduleUrl.href);
  const runner = subcommand === "still"
    ? module.runStillCommand
    : subcommand === "video" ? module.runVideoCommand : module.runResumeCommand;
  if (typeof runner !== "function") throw new Error(`akari generate ${subcommand} の実行関数がありません`);
  return runner(rest, options);
}

async function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (await isMainModule()) {
  const result = await runGenerateCommand(process.argv.slice(2));
  process.exitCode = result.exitCode ?? 0;
}
