// harness/render-fragment.mjs の Windows 版の写し（1 ブラウザで複数の seek を撮る）。
// 入れ子（.akari-overlay-container[data-akari-active] > .scene-content > 断片）とモーション語彙は
// 本番の書き出しシート（packages/render-cut/src/rasterize.mjs）と同じ。
// 使い方: node render-multi.mjs <fragment.html> <outDir> <prefix> --seeks 0.1,0.45 [--size 1280x720]
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "<WORKTREE>";
const require = createRequire(`${REPO}/packages/render-cut/`);
const puppeteer = require("puppeteer-core");
const CHROME = "<LOCALAPPDATA>/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe";

const [fragmentPath, outDir, prefix] = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const seeks = arg("--seeks", "0").split(",").map(Number);
const [width, height] = arg("--size", "1280x720").split("x").map(Number);
const vars = arg("--vars", "");
const fragment = readFileSync(fragmentPath, "utf8");
const motionVocabCss = readFileSync(`${REPO}/packages/overlay-runtime/src/motion-vocab.css`, "utf8");
const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
  #stage { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; }
  .akari-overlay-container { position: absolute; inset: 0;
    transform: translate(var(--x, 0px), var(--y, 0px)) scale(var(--scale, 1)) rotate(var(--rotate, 0deg));
    transform-origin: center; ${vars} }
  .akari-overlay-container > .scene-content { position: absolute; inset: 0; }
</style><style>${motionVocabCss}</style></head><body>
  <div id="stage"><div class="akari-overlay-container" data-akari-active><div class="scene-content">${fragment}</div></div></div>
</body></html>`;
mkdirSync(outDir, { recursive: true });
const harnessPath = resolve(outDir, `.${prefix}.harness.html`);
writeFileSync(harnessPath, page);
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "shell", pipe: true,
  args: ["--no-sandbox", "--allow-file-access-from-files", "--force-color-profile=srgb", "--disable-lcd-text",
    "--disable-gpu", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
try {
  const tab = await browser.newPage();
  await tab.setViewport({ width, height, deviceScaleFactor: 1 });
  await tab.goto(pathToFileURL(harnessPath).href, { waitUntil: "load" });
  await tab.evaluate(() => document.fonts.ready);
  const fontInfo = await tab.evaluate(() => [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`));
  for (const seek of seeks) {
    const n = await tab.evaluate((seconds) => {
      const animations = document.getAnimations();
      for (const a of animations) { a.pause(); a.currentTime = seconds * 1000; }
      return animations.length;
    }, seek);
    await new Promise((r) => setTimeout(r, 60));
    const buffer = await tab.screenshot({ omitBackground: true });
    const out = resolve(outDir, `${prefix}-${seek.toFixed(3)}.png`);
    writeFileSync(out, buffer);
    console.log(JSON.stringify({ out, seek, animations: n }));
  }
  console.log(JSON.stringify({ fonts: fontInfo }));
} finally {
  try { unlinkSync(harnessPath); } catch {}
  const p = browser.process();
  if (p) p.kill("SIGKILL"); else await browser.close();
}
