import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveLauncherAssets } from "./repo-assets.mjs";

export async function runCaptureCommand(argv, options = {}) {
  const logError = options.error ?? options.logError ?? ((line) => console.error(line));
  const assets = options.assets ?? resolveLauncherAssets();
  if (!assets.captureScript || !existsSync(assets.captureScript)) {
    logError("akari capture の実行スクリプトが見つかりません。AKARI Video を再インストールしてください。");
    return { exitCode: 1 };
  }

  const isHelp = argv.includes("--help") || argv.includes("-h");
  if (!isHelp) {
    const browser = await resolveBrowserDiagnostics(assets, options);
    if (!await browser.findChromePath()) {
      logError(await browser.describeChromeNotFound());
      return { exitCode: 1 };
    }
  }

  const spawn = options.spawn ?? spawnSync;
  const result = spawn(process.execPath, [assets.captureScript, ...argv], {
    stdio: "inherit",
    cwd: options.cwd ?? process.cwd(),
  });
  return { exitCode: typeof result.status === "number" ? result.status : 1 };
}

async function resolveBrowserDiagnostics(assets, options) {
  if (options.findChromePath && options.describeChromeNotFound) {
    return {
      findChromePath: options.findChromePath,
      describeChromeNotFound: options.describeChromeNotFound,
    };
  }
  const modulePath = join(assets.repoRoot, "packages", "render-cut", "src", "render-cut.mjs");
  const module = await import(pathToFileURL(modulePath).href);
  return {
    findChromePath: options.findChromePath ?? module.findChromePath,
    describeChromeNotFound: options.describeChromeNotFound ?? module.describeChromeNotFound,
  };
}
