// find-chrome — 買った人の環境で Chrome を見つける。
//
// 開発者向けツールと違い、これは素材を買った人が npx で叩く。ダウンロードを走らせず、
// 既に入っている Chrome 系ブラウザを使うのが最短。見つからないときは黙って落ちず、
// 何をすればよいかを日本語で案内する。

import { existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const CANDIDATES = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    join(homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/snap/bin/chromium",
  ],
};

/** puppeteer が過去に落とした Chrome for Testing のキャッシュを走査する。 */
function fromPuppeteerCache() {
  const root = join(homedir(), ".cache", "puppeteer", "chrome");
  if (!existsSync(root)) return [];
  const relative = {
    darwin: ["chrome-mac-arm64", "chrome-mac-x64"].map((d) =>
      join(d, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
    ),
    win32: [join("chrome-win64", "chrome.exe"), join("chrome-win32", "chrome.exe")],
    linux: [join("chrome-linux64", "chrome")],
  }[platform()] ?? [];

  const found = [];
  for (const build of readdirSync(root)) {
    for (const suffix of relative) found.push(join(root, build, suffix));
  }
  // 新しいビルドを先に試す。
  return found.reverse();
}

export function findChrome(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.AKARI_CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    ...(CANDIDATES[platform()] ?? []),
    ...fromPuppeteerCache(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    [
      "Chrome が見つかりませんでした。次のいずれかで解決できます。",
      "",
      "  1. Google Chrome をインストールする（既定の場所に入れば自動で見つかります）",
      "     https://www.google.com/chrome/",
      "  2. 実行ファイルの場所を渡す:  --chrome \"/path/to/chrome\"",
      "  3. 環境変数で指定する:        AKARI_CHROME_PATH=/path/to/chrome",
      "",
      "Chromium / Microsoft Edge / Brave でも動きます。",
    ].join("\n"),
  );
}
