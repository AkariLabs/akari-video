import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FALLBACK_WARNING = "osr-export warning: Electron が見つからないため現行の書き出し経路（PNG 連番）へフォールバックします";
export const CHROMIUM_SWITCHES = Object.freeze([
  "--force-device-scale-factor=1",
  "--force-color-profile=srgb",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
]);
export const SOFT_CHROMIUM_SWITCHES = Object.freeze([
  "--disable-gpu",
  "--enable-unsafe-swiftshader",
  "--use-angle=swiftshader",
]);
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRequire = createRequire(import.meta.url);

export async function resolveElectronLauncher({
  env = process.env,
  platform = process.platform,
  homeDirectory = homedir(),
  probe = defaultProbe,
  resolveElectron = defaultResolveElectron,
} = {}) {
  for (const executable of desktopCandidates({ env, platform, homeDirectory })) {
    const explicit = executable === env.AKARI_OSR_ELECTRON;
    const runtime = desktopRuntimePath(executable, platform);
    if (executable && await probe(executable, { kind: "desktop" })
      && (explicit || await probe(runtime, { kind: "desktop-runtime" }))) {
      return { tier: 1, kind: "desktop", executable, reason: env.AKARI_OSR_ELECTRON ? "environment override" : "installed desktop app" };
    }
  }
  let executable = null;
  try { executable = resolveElectron(); } catch {}
  if (executable && await probeElectronDist(executable, probe, platform)) {
    return { tier: 2, kind: "npm-electron", executable, reason: "package optionalDependency" };
  }
  return { tier: 3, kind: "legacy", executable: null, reason: platform === "linux" ? "Linux uses the compatibility path in v0" : "Electron unavailable", warning: FALLBACK_WARNING };
}

export async function launchElectronExport(launcher, options, { spawnImpl = spawn } = {}) {
  if (launcher.tier === 3) return { fellBackToLegacy: true, launcher };
  const args = buildElectronArguments(launcher, options);
  await spawnAndWait(launcher.executable, args, { spawnImpl, onStdout: options.onStdout, onStderr: options.onStderr });
  return { fellBackToLegacy: false, launcher };
}

export function buildElectronArguments(launcher, options) {
  const chromiumSwitches = [
    ...CHROMIUM_SWITCHES,
    ...(options.soft ? SOFT_CHROMIUM_SWITCHES : []),
  ];
  const common = [
    "--render", options.projectRoot, "--out", options.out,
    "--fps", String(options.fps), "--width", String(options.width), "--height", String(options.height),
    "--quality", options.quality ?? "high", "--encoder", options.encoder ?? "auto",
    "--verify", options.verify ?? "stamp",
    "--duration", String(options.duration), "--frames", String(options.frames),
    "--queue-depth", String(options.queueDepth ?? 3),
    ...(options.dumpFrames?.length > 0 ? ["--dump-frames", options.dumpFrames.join(",")] : []),
    ...(options.soft ? ["--soft"] : []),
  ];
  const args = launcher.tier === 2
    ? [join(PACKAGE_ROOT, "src", "electron-main.mjs"), ...chromiumSwitches, ...common]
    : [...chromiumSwitches, ...common];
  return args;
}

export function desktopCandidates({ env, platform, homeDirectory }) {
  const candidates = [env.AKARI_OSR_ELECTRON];
  if (platform === "darwin") {
    candidates.push("/Applications/AKARI Video.app/Contents/MacOS/AKARI Video", join(homeDirectory, "Applications", "AKARI Video.app", "Contents", "MacOS", "AKARI Video"));
  } else if (platform === "win32") {
    candidates.push(env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "AKARI Video", "AKARI Video.exe"));
  } else {
    candidates.push("/opt/AKARI Video/akari-video", join(homeDirectory, ".local", "bin", "akari-video"));
  }
  return candidates.filter(Boolean);
}

export function desktopRuntimePath(executable, platform) {
  if (platform === "darwin") {
    return resolve(dirname(executable), "../Resources/packages/osr-export/src/electron-main.mjs");
  }
  return resolve(dirname(executable), "resources/packages/osr-export/src/electron-main.mjs");
}

async function probeElectronDist(executable, probe, platform) {
  const dist = platform === "darwin"
    ? resolve(executable, "../../../../")
    : dirname(executable);
  const required = ["LICENSE", "LICENSES.chromium.html", "version"];
  if (platform === "darwin") required.push("Electron.app");
  else required.push(platform === "win32" ? "electron.exe" : "electron");
  for (const entry of required) {
    if (!(await probe(join(dist, entry), { kind: "dist-entry" }))) return false;
  }
  return probe(executable, { kind: "npm-electron" });
}

function defaultResolveElectron() {
  return packageRequire("electron");
}

async function defaultProbe(path) {
  return existsSync(path);
}

function spawnAndWait(command, args, { spawnImpl, onStdout, onStderr }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnImpl(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (chunk) => { onStdout?.(chunk.toString()); });
    child.stderr?.on("data", (chunk) => { onStderr?.(chunk.toString()); });
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`OSR Electron exited ${code} (${signal ?? "no signal"})`));
    });
  });
}
