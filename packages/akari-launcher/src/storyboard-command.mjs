import { spawnSync } from "node:child_process";

import { resolveLauncherAssets } from "./repo-assets.mjs";

const USAGE = "使い方: akari storyboard <projectDir> [--no-capture] [--captures <dir>] [--out <dir>]";

export async function runStoryboardCommand(args, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  if (args.includes("--help")) {
    log(USAGE);
    return { exitCode: 0 };
  }

  const logError = options.logError ?? ((line) => console.error(line));
  const assets = options.assets ?? resolveLauncherAssets();
  const spawn = options.spawn ?? spawnSync;
  if (!assets.storyboardScript) {
    logError("akari storyboard の実行スクリプトが見つかりません。完全な AKARI Video を再導入してください:");
    logError("  npm install -g akari-video");
    return { exitCode: 2 };
  }
  const result = spawn(process.execPath, [assets.storyboardScript, ...args], { stdio: "inherit" });
  return { exitCode: typeof result?.status === "number" ? result.status : 1 };
}
