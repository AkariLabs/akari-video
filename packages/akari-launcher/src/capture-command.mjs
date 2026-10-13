import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { CAPTURE_SCRIPT_RELATIVE, resolveLauncherAssets } from "./repo-assets.mjs";
import { cliText } from './i18n.mjs';

export async function runCaptureCommand(argv, options = {}) {
  const logError = options.error ?? options.logError ?? ((line) => console.error(line));
  const assets = options.assets ?? resolveLauncherAssets();
  if (!assets.captureScript || !existsSync(assets.captureScript)) {
    // 再インストールで直る欠けではない（同梱漏れは配布物側の問題）。欠けている同梱物と
    // 探索した置き場を名指しして、報告・切り分けに使える形で止める（issue #74）。
    const missing = assets.captureScript ?? CAPTURE_SCRIPT_RELATIVE;
    logError(cliText('cli.capture.error.scriptMissing', { missing, root: assets.repoRoot ?? cliText('cli.capture.label.unknown') }));
    return { exitCode: 1 };
  }

  const spawn = options.spawn ?? spawnSync;
  const result = spawn(process.execPath, [assets.captureScript, ...argv], {
    stdio: "inherit",
    cwd: options.cwd ?? process.cwd(),
  });
  return { exitCode: typeof result.status === "number" ? result.status : 1 };
}
