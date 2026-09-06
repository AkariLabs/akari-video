import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { resolveLauncherAssets } from "./repo-assets.mjs";

export async function runCaptionsCommand(argv, options = {}) {
  const logError = options.error ?? options.logError ?? ((line) => console.error(line));
  const assets = options.assets ?? resolveLauncherAssets();
  if (!assets.captionsScript || !existsSync(assets.captionsScript)) {
    logError("akari captions の実行スクリプトが見つかりません。AKARI Video を再インストールしてください。");
    return { exitCode: 1 };
  }

  const spawn = options.spawn ?? spawnSync;
  const result = spawn(process.execPath, [assets.captionsScript, ...argv], {
    stdio: "inherit",
    cwd: options.cwd ?? process.cwd(),
  });
  return { exitCode: typeof result.status === "number" ? result.status : 1 };
}
