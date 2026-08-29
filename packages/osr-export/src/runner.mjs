import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
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
// Electron 子プロセスへ渡さない環境変数（refs #27）。ELECTRON_RUN_AS_NODE は shell 配布の akari shim・アプリ内書き出し・
// パートナー CLI サーバーが「同梱 Electron を node として使う」ために親側で 1 を立てるが、そのまま継承すると
// 子の AKARI Video / npm Electron も Node モードで起動する（tier 1 は Chromium スイッチを bad option で拒否して exit 9、
// tier 2 は electron-main.mjs が素の Node で走り app が undefined）。名前の比較は Windows の大文字小文字非区別に合わせる。
export const ELECTRON_CHILD_ENV_BLOCKLIST = Object.freeze(["ELECTRON_RUN_AS_NODE"]);
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRequire = createRequire(import.meta.url);

export async function resolveElectronLauncher({
  env = process.env,
  platform = process.platform,
  homeDirectory = homedir(),
  probe = defaultProbe,
  resolveElectron = defaultResolveElectron,
  runtimePathResolver = desktopRuntimePath,
  // false のとき tier 1（インストール済みデスクトップアプリ）を候補から外す。
  // gpu-export が使う: shell の --render は OSR ランタイムしか読まないため、GPU 用 main を tier 1 に渡せない（v0.1.25 で判明）。
  allowDesktop = true,
  // false のとき「インストール済みデスクトップアプリ」（/Applications 等の既定候補）だけを候補から外す。
  // env.AKARI_OSR_ELECTRON の明示指定は尊重する。resolveOsrLauncher（製品入口）が使う:
  // インストール済みアプリの --render は Theia の起動処理と競合して落ちる（v0.1.26 実ビルドで実証・osr 契約 §11.5）。
  allowInstalledDesktop = true,
} = {}) {
  let skippedInstalledDesktop = false;
  for (const executable of allowDesktop ? desktopCandidates({ env, platform, homeDirectory }) : []) {
    const explicit = executable === env.AKARI_OSR_ELECTRON;
    if (!allowInstalledDesktop && !explicit) { skippedInstalledDesktop = true; continue; }
    const runtime = runtimePathResolver(executable, platform);
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
  const reason = platform === "linux" ? "Linux uses the compatibility path in v0" : "Electron unavailable";
  if (skippedInstalledDesktop) {
    return {
      tier: 3, kind: "legacy", executable: null, skippedInstalledDesktop: true,
      reason: `${reason}; the installed desktop app is skipped because its --render entry crashes (osr contract §11.5)`,
      warning: `${FALLBACK_WARNING}（インストール済みデスクトップアプリ経由は修正中のため候補から外しています）`,
    };
  }
  return { tier: 3, kind: "legacy", executable: null, reason, warning: FALLBACK_WARNING };
}

export function electronChildEnvironment(env = process.env) {
  const blocked = new Set(ELECTRON_CHILD_ENV_BLOCKLIST.map((name) => name.toUpperCase()));
  const child = {};
  for (const [name, value] of Object.entries(env)) {
    if (!blocked.has(name.toUpperCase())) child[name] = value;
  }
  return child;
}

export async function launchElectronExport(launcher, options, {
  spawnImpl = spawn,
  argumentBuilder = buildElectronArguments,
  env = process.env,
} = {}) {
  if (launcher.tier === 3) return { fellBackToLegacy: true, launcher };
  const args = argumentBuilder(launcher, options);
  let progressLines = 0;
  let pendingStdout = "";
  const onStdout = (text) => {
    pendingStdout += text;
    const lines = pendingStdout.split(/\r?\n/);
    pendingStdout = lines.pop() ?? "";
    progressLines += lines.filter((line) => line.startsWith("PROGRESS frame=")).length;
    options.onStdout?.(text);
  };
  await spawnAndWait(launcher.executable, args, { spawnImpl, env, onStdout, onStderr: options.onStderr });
  if (pendingStdout.startsWith("PROGRESS frame=")) progressLines += 1;
  const output = await stat(options.out).catch(() => null);
  if (!output || output.size === 0) {
    throw new Error(`osr-export error: OSR Electron は exit 0 で終了しましたが出力がありません（PROGRESS 行 ${progressLines}）。起動中の AKARI Video デスクトップアプリの単一インスタンスロックに弾かれた可能性があります（--user-data-dir の伝播を確認）: ${options.out}`);
  }
  return { fellBackToLegacy: false, launcher };
}

export function buildElectronArguments(launcher, options) {
  const userDataDir = options.userDataDir ?? join(dirname(options.out), "electron-user-data");
  const chromiumSwitches = [
    CHROMIUM_SWITCHES[0],
    `--user-data-dir=${userDataDir}`,
    ...CHROMIUM_SWITCHES.slice(1),
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
    ...(options.extraArgs ?? []),
  ];
  const tierOneMain = launcher.tier === 1 && options.mainScript
    ? ["--akari-main", packageRelativeMain(options.mainScript)]
    : [];
  const args = launcher.tier === 2
    ? [options.mainScript ?? join(PACKAGE_ROOT, "src", "electron-main.mjs"), ...chromiumSwitches, ...common]
    : [...chromiumSwitches, ...tierOneMain, ...common];
  return args;
}

function packageRelativeMain(mainScript) {
  const portable = mainScript.replaceAll("\\", "/");
  const match = portable.match(/(?:^|\/)(packages\/.*)$/);
  if (!match) {
    throw new Error(`OSR launcher: mainScript must live under packages/ (got ${mainScript})`);
  }
  return match[1];
}

export function desktopCandidates({ env, platform, homeDirectory }) {
  const candidates = [env.AKARI_OSR_ELECTRON];
  if (platform === "darwin") {
    candidates.push("/Applications/AKARI Video.app/Contents/MacOS/AKARI Video", join(homeDirectory, "Applications", "AKARI Video.app", "Contents", "MacOS", "AKARI Video"));
  } else if (platform === "win32") {
    // electron-builder NSIS per-user 既定 = sanitize-filename(`apps/shell/package.json` の `name`)。
    candidates.push(
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "@akari-videoshell", "AKARI Video.exe"),
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "AKARI Video", "AKARI Video.exe"),
    );
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

function spawnAndWait(command, args, { spawnImpl, env, onStdout, onStderr }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnImpl(command, args, { env: electronChildEnvironment(env), stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (chunk) => { onStdout?.(chunk.toString()); });
    child.stderr?.on("data", (chunk) => { onStderr?.(chunk.toString()); });
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`OSR Electron exited ${code} (${signal ?? "no signal"})`));
    });
  });
}
