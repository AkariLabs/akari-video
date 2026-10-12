import { spawnSync } from "node:child_process";

import { resolveLauncherAssets } from "./repo-assets.mjs";
import { cliText } from './i18n.mjs';

const usage = () => cliText('cli.storyboard.help.usage');

export async function runStoryboardCommand(args, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  if (args.includes("--help")) {
    log(usage());
    return { exitCode: 0 };
  }

  const logError = options.logError ?? ((line) => console.error(line));
  const assets = options.assets ?? resolveLauncherAssets();
  const spawn = options.spawn ?? spawnSync;
  if (!assets.storyboardScript) {
    logError(cliText('cli.storyboard.error.scriptMissing'));
    logError("  npm install -g akari-video");
    return { exitCode: 2 };
  }
  const result = spawn(process.execPath, [assets.storyboardScript, ...args], { stdio: "inherit" });
  return { exitCode: typeof result?.status === "number" ? result.status : 1 };
}
