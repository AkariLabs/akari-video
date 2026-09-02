import { spawnSync } from "node:child_process";

import { resolveLauncherAssets } from "./repo-assets.mjs";

export async function runWordBookCommand(args, options = {}) {
  const logError = options.logError ?? ((line) => console.error(line));
  const assets = options.assets ?? resolveLauncherAssets();
  const spawn = options.spawn ?? spawnSync;
  if (!assets.wordBookScript) {
    logError("akari word-book の実行スクリプトが見つかりません。完全な AKARI Video を再導入してください:");
    logError("  npm install -g akari-video");
    return { exitCode: 1 };
  }
  const result = spawn(process.execPath, [assets.wordBookScript, ...args], { stdio: "inherit" });
  return { exitCode: typeof result?.status === "number" ? result.status : 1 };
}
