import { cliText } from "./i18n.mjs";
import { spawnSync } from "node:child_process";

import { resolveLauncherAssets } from "./repo-assets.mjs";

export async function runToolsCommand(args, options = {}) {
  const logError = options.logError ?? ((line) => console.error(line));
  const assets = options.assets ?? resolveLauncherAssets();
  const spawn = options.spawn ?? spawnSync;
  if (!assets.toolsScript) {
    logError(cliText('cli.tools.scriptMissing.error'));
    logError("  npm install -g akari-video");
    return { exitCode: 1 };
  }
  const result = spawn(process.execPath, [assets.toolsScript, ...args], { stdio: "inherit" });
  return { exitCode: typeof result?.status === "number" ? result.status : 1 };
}
