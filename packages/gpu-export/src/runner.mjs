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

// デスクトップ tier（tier 1 = インストール済み AKARI Video）も候補にする。shell の electron-entry.js が --render を
// Theia より前に捕捉し、buildElectronArguments が tier 1 に --akari-main <packages/gpu-export/src/electron-main.mjs> を
// 渡すので GPU ランタイムがそのまま走る（2026-08-29 osr-headless-entry 合流・v0.1.28〜）。v0.1.26〜v0.1.27 の間は
// 未配線のため allowDesktop 既定 false で fail-closed にしていた。allowDesktop: false は今も明示指定で使える。
export async function resolveGpuLauncher(options = {}) {
  return resolveElectronLauncher({ ...options, runtimePathResolver: options.runtimePathResolver ?? gpuDesktopRuntimePath });
}

export function buildGpuElectronArguments(launcher, options) {
  const encoding = resolveGpuEncoding({ quality: options.quality ?? "high", bitrate: options.bitrate, width: options.width, height: options.height });
  const extraArgs = [
    "--bitrate", String(encoding.bitrate),
    ...(options.editPath ? ["--edit", options.editPath] : []),
    ...(options.trapReadback ? ["--trap-readback"] : []),
    ...(options.verifyFrames ? ["--verify-frames"] : []),
    ...(options.dumpFrames?.length > 0 ? ["--dump-frames", options.dumpFrames.join(",")] : []),
    ...(options.captureFrames?.length > 0 ? ["--capture-frames", options.captureFrames.join(",")] : []),
    ...(options.captureOutputDirectory ? ["--capture-output-dir", options.captureOutputDirectory] : []),
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
