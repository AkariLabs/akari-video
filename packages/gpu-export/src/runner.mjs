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

export async function resolveGpuLauncher(options = {}) {
  return resolveElectronLauncher({ ...options, runtimePathResolver: options.runtimePathResolver ?? gpuDesktopRuntimePath });
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
