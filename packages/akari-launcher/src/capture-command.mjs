import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { CAPTURE_SCRIPT_RELATIVE, resolveLauncherAssets } from "./repo-assets.mjs";

export async function runCaptureCommand(argv, options = {}) {
  const logError = options.error ?? options.logError ?? ((line) => console.error(line));
  const assets = options.assets ?? resolveLauncherAssets();
  if (!assets.captureScript || !existsSync(assets.captureScript)) {
    // 再インストールで直る欠けではない（同梱漏れは配布物側の問題）。欠けている同梱物と
    // 探索した置き場を名指しして、報告・切り分けに使える形で止める（issue #74）。
    const missing = assets.captureScript ?? CAPTURE_SCRIPT_RELATIVE;
    logError(
      `akari capture の実行スクリプトが見つかりません: ${missing}`
      + `（探索先: ${assets.repoRoot ?? "不明"}）。`
      + "この AKARI Video 配布物に packages/akari-tools/bin/capture.mjs が同梱されていません。"
      + "バージョンと OS を添えて https://github.com/AkariLabs/akari-video/issues へ報告してください。",
    );
    return { exitCode: 1 };
  }

  const spawn = options.spawn ?? spawnSync;
  const result = spawn(process.execPath, [assets.captureScript, ...argv], {
    stdio: "inherit",
    cwd: options.cwd ?? process.cwd(),
  });
  return { exitCode: typeof result.status === "number" ? result.status : 1 };
}
