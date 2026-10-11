import { spawnSync } from "node:child_process";

import { resolveLauncherAssets } from "./repo-assets.mjs";
import { cliText } from './i18n.mjs';

export async function runGenerateCommand(args, options = {}) {
  const logError = options.logError ?? ((line) => console.error(line));
  const assets = options.assets ?? resolveLauncherAssets();
  const spawn = options.spawn ?? spawnSync;
  if (!assets.generateScript) {
    logError(cliText('cli.generate.error.scriptMissing'));
    logError("  npm install -g akari-video");
    return { exitCode: 1 };
  }
  const result = spawn(process.execPath, [assets.generateScript, ...args], { stdio: "inherit" });
  return { exitCode: typeof result?.status === "number" ? result.status : 1 };
}
