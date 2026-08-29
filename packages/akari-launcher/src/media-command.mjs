import { spawnSync } from "node:child_process";

import { resolveLauncherAssets } from "./repo-assets.mjs";

export async function runMediaCommand(args, options = {}) {
  const logError = options.logError ?? ((line) => console.error(line));
  const assets = options.assets ?? resolveLauncherAssets();
  const spawn = options.spawn ?? spawnSync;
  if (!assets.mediaScript) {
    logError("akari media の実行スクリプトが見つかりません。完全な AKARI Video を再導入してください:");
    logError("  npm install -g akari-video");
    return { exitCode: 1 };
  }
  const result = spawn(process.execPath, [assets.mediaScript, ...args], { stdio: "inherit" });
  return { exitCode: typeof result?.status === "number" ? result.status : 1 };
}

