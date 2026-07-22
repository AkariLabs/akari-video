// browser — puppeteer セッション管理。headless Chromium で ATF レンダラー / FxRuntime を実行する
// （契約 §1.1: 「ヘッドレスブラウザ（puppeteer-core 系）で旧エンジンを実行」）。
import puppeteer from "puppeteer"
import { resolveExecutablePath } from "./find-chrome.mjs"

export async function launchBakeBrowser() {
  const executablePath = await resolveExecutablePath(puppeteer)
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      // WebGL2 を headless でも有効化する（FxRuntime は WebGL2 前提）。
      "--use-gl=angle",
      "--use-angle=metal",
      "--enable-webgl",
      "--enable-webgl2",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
    ],
  })
  return browser
}

export async function withBakePage(browser, size, fn) {
  const page = await browser.newPage()
  try {
    await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 1 })
    return await fn(page)
  } finally {
    await page.close()
  }
}
