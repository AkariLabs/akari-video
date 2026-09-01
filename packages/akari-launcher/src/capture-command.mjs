import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { resolveLauncherAssets } from "./repo-assets.mjs";

export async function runCaptureCommand(argv, options = {}) {
  const logError = options.error ?? options.logError ?? ((line) => console.error(line));
  const assets = options.assets ?? resolveLauncherAssets();
  if (!assets.captureScript || !existsSync(assets.captureScript)) {
    logError("akari capture の実行スクリプトが見つかりません。AKARI Video を再インストールしてください。");
    return { exitCode: 1 };
  }

  const spawn = options.spawn ?? spawnSync;
  const result = spawn(process.execPath, [assets.captureScript, ...argv], {
    stdio: "inherit",
    cwd: options.cwd ?? process.cwd(),
  });
  return { exitCode: typeof result.status === "number" ? result.status : 1 };
}
