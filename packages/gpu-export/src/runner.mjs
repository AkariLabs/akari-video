import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildElectronArguments,
  launchElectronExport,
  resolveElectronLauncher,
} from "../../osr-export/src/runner.mjs";
import { resolveGpuEncoding } from "./bitrate.mjs";

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const GPU_ELECTRON_MAIN = resolve(SOURCE_DIRECTORY, "electron-main.mjs");

export function gpuDesktopRuntimePath(executable, platform) {
  if (platform === "darwin") return resolve(dirname(executable), "../Resources/packages/gpu-export/src/electron-main.mjs");
  return resolve(dirname(executable), "resources/packages/gpu-export/src/electron-main.mjs");
}

export const GPU_DESKTOP_TIER_UNWIRED_REASON =
  "GPU export via the installed desktop app (launcher tier 1) is not wired yet: the shell's --render only runs the OSR runtime";

// デスクトップ tier（tier 1）は候補から外す（fail-closed）。
// buildElectronArguments は tier 2 にしか mainScript を渡さず、shell の akari-osr-export contribution は
// osr-export の electron-main しか読まない（--bitrate は無視）。そのまま tier 1 を使うと OSR で書き出した mp4 を
// gpu-run.json が engine=gpu と誤記する（v0.1.25 のパッケージ版で判明）。配線されるまで tier 2（npm Electron）か
// tier 3（不可・auto は OSR へ / --engine gpu 明示は拒否）に限定する。allowDesktop: true を明示した呼び手だけが従来どおり。
export async function resolveGpuLauncher(options = {}) {
  const launcher = await resolveElectronLauncher({
    ...options,
    allowDesktop: options.allowDesktop ?? false,
    runtimePathResolver: options.runtimePathResolver ?? gpuDesktopRuntimePath,
  });
  if (launcher.tier === 3 && (options.allowDesktop ?? false) === false) {
    return { ...launcher, reason: `${GPU_DESKTOP_TIER_UNWIRED_REASON}; ${launcher.reason}` };
  }
  return launcher;
}

export function buildGpuElectronArguments(launcher, options) {
  const encoding = resolveGpuEncoding({ quality: options.quality ?? "high", bitrate: options.bitrate });
  const extraArgs = [
    "--bitrate", String(encoding.bitrate),
    ...(options.trapReadback ? ["--trap-readback"] : []),
    ...(options.verifyFrames ? ["--verify-frames"] : []),
  ];
  return buildElectronArguments(launcher, {
    ...options,
    quality: encoding.quality,
    mainScript: GPU_ELECTRON_MAIN,
    extraArgs,
  });
}

export async function launchGpuExport(launcher, options, dependencies = {}) {
  if (launcher?.tier === 3) throw new Error(`GPU export unavailable: ${launcher.reason ?? "Electron unavailable"}`);
  return launchElectronExport(launcher, options, {
    ...dependencies,
    argumentBuilder: dependencies.argumentBuilder ?? buildGpuElectronArguments,
  });
}
