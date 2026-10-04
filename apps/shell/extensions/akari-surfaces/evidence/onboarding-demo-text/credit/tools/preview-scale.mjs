// プレビュー枠と同じく、1280×720 の舞台を CSS で 0.5 倍に縮めて 640×360 で撮る（縮小は DOM 側でかける）
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const WT = "<WORKTREE>";
const require = createRequire(`${WT}/packages/render-cut/`);
const puppeteer = require("puppeteer-core");
const [fragPath, bgPath, seek, out, scaleArg] = process.argv.slice(2);
const scale = Number(scaleArg || 0.5);
const fragment = readFileSync(fragPath, "utf8");
const vocab = readFileSync(`${WT}/packages/overlay-runtime/src/motion-vocab.css`, "utf8");
const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:#000}
#frame{position:relative;width:${1280*scale}px;height:${720*scale}px;overflow:hidden}
#stage{position:absolute;left:0;top:0;width:1280px;height:720px;transform:scale(${scale});transform-origin:0 0}
#bg{position:absolute;inset:0;width:100%;height:100%}
.akari-overlay-container{position:absolute;inset:0}.akari-overlay-container>.scene-content{position:absolute;inset:0}</style><style>${vocab}</style></head>
<body><div id="frame"><div id="stage"><img id="bg" src="${pathToFileURL(bgPath).href}"><div class="akari-overlay-container" data-akari-active><div class="scene-content">${fragment}</div></div></div></div></body></html>`;
const harness = `${out}.harness.html`;
writeFileSync(harness, page);
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, userDataDir: "C:/t/credit-text/edge-profile", pipe: true,
  args: ["--no-sandbox", "--allow-file-access-from-files", "--force-color-profile=srgb", "--disable-gpu"] });
try {
  const tab = await browser.newPage();
  await tab.setViewport({ width: Math.round(1280*scale), height: Math.round(720*scale), deviceScaleFactor: 1 });
  await tab.goto(pathToFileURL(harness).href, { waitUntil: "load" });
  await tab.evaluate(() => document.fonts.ready);
  await tab.evaluate((s) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = s * 1000; } }, Number(seek));
  await new Promise((r) => setTimeout(r, 60));
  writeFileSync(out, await tab.screenshot());
} finally { const p = browser.process(); if (p) p.kill("SIGKILL"); }
