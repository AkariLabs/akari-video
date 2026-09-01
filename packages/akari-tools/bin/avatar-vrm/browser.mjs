import puppeteer from "puppeteer-core";

import { findChrome } from "./find-chrome.mjs";

export async function launchAvatarVrmBrowser() {
  const executablePath = process.env.AKARI_CHROME_BIN?.trim() || process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || findChrome();
  if (!executablePath) throw new Error("この機能には Chrome が必要です（`AKARI_CHROME_BIN` で指定）");
  const isHeadlessShell = /(?:^|[/\\])chrome-headless-shell(?:\.exe)?$/.test(executablePath);
  return puppeteer.launch({
    executablePath,
    headless: isHeadlessShell ? "shell" : true,
    pipe: isHeadlessShell,
    protocolTimeout: 600_000,
    args: [
      "--no-sandbox",
      ...(isHeadlessShell ? ["--single-process", "--no-zygote"] : []),
      "--disable-gpu",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--allow-file-access-from-files",
    ],
  });
}
