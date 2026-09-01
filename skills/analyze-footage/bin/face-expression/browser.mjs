import { existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export const BROWSER_ARGS = Object.freeze([
  "--no-sandbox",
  "--disable-gpu",
  // MediaPipe は CPU delegate でも画像 upload に WebGL texture を使う。headless Chrome では
  // --disable-gpu 単独だと context が null になるため、avatar-vrm と同じ SwiftShader 経路を使う。
  "--enable-unsafe-swiftshader",
  "--use-angle=swiftshader",
  "--disable-dev-shm-usage",
  "--no-first-run",
  "--no-default-browser-check",
]);

// avatar-vrm/find-chrome.mjs と同じ探索順を、この独立生成器内へ閉じて踏襲する。
// avatar-vrm 自体への結線・変更を避けつつ Chrome for Testing の決定済み流儀を共有する。
function cachedCandidates() {
  const root = join(homedir(), ".cache", "puppeteer", "chrome");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .flatMap((version) => [
      join(root, version, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      join(root, version, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      join(root, version, "chrome-linux64", "chrome"),
      join(root, version, "chrome-win64", "chrome.exe"),
    ]);
}

function systemCandidates() {
  if (platform() === "darwin") return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  if (platform() === "win32") return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
}

export function findChrome(env = process.env) {
  const overridden = env.AKARI_CHROME_BIN?.trim() || env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (overridden) return existsSync(overridden) ? overridden : null;
  return [...cachedCandidates(), ...systemCandidates()].find((candidate) => existsSync(candidate)) ?? null;
}

export async function launchBrowser(env = process.env) {
  const executablePath = findChrome(env);
  if (!executablePath) throw new Error("この機能には Chrome が必要です（`AKARI_CHROME_BIN` で指定）");
  const { default: puppeteer } = await import("puppeteer-core");
  return puppeteer.launch({
    executablePath,
    headless: true,
    protocolTimeout: 600_000,
    args: BROWSER_ARGS,
  });
}
