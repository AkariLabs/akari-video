import { spawnSync } from "node:child_process";

import { resolveLauncherAssets } from "./repo-assets.mjs";
import { cliText } from './i18n.mjs';

export async function runMediaCommand(args, options = {}) {
  const logError = options.logError ?? ((line) => console.error(line));
  const assets = options.assets ?? resolveLauncherAssets();
  const spawn = options.spawn ?? spawnSync;
  if (!assets.mediaScript) {
    logError(cliText('cli.media.error.scriptMissing'));
    logError("  npm install -g akari-video");
    return { exitCode: 1 };
  }
  const result = spawn(process.execPath, [assets.mediaScript, ...args], { stdio: "inherit" });
  return { exitCode: typeof result?.status === "number" ? result.status : 1 };
}

