// 断片を 1 回のブラウザ起動で複数時刻に seek して PNG を撮る（render-fragment.mjs と同じ入れ子・語彙・活性ゲート）
// node render-seq.mjs <fragment.html> <outdir> <t1,t2,...|from:to:step> [--size 1280x720]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const WT = "<WORKTREE>";
const require = createRequire(`${WT}/packages/render-cut/`);
const puppeteer = require("puppeteer-core");
const [fragmentPath, outDir, spec] = process.argv.slice(2);
const sizeArg = process.argv.includes("--size") ? process.argv[process.argv.indexOf("--size") + 1] : "1280x720";
const [width, height] = sizeArg.split("x").map(Number);
let times;
if (spec.includes(":")) { const [a, b, st] = spec.split(":").map(Number); times = []; for (let i = 0; a + i * st <= b + 1e-9; i++) times.push(+(a + i * st).toFixed(4)); }
else times = spec.split(",").map(Number);
mkdirSync(outDir, { recursive: true });
const fragment = readFileSync(fragmentPath, "utf8");
const vocab = readFileSync(`${WT}/packages/overlay-runtime/src/motion-vocab.css`, "utf8");
const page = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
#stage{position:relative;width:${width}px;height:${height}px;overflow:hidden}
.akari-overlay-container{position:absolute;inset:0;transform:translate(var(--x,0px),var(--y,0px)) scale(var(--scale,1)) rotate(var(--rotate,0deg));transform-origin:center}
.akari-overlay-container>.scene-content{position:absolute;inset:0}
</style><style>${vocab}</style></head><body><div id="stage"><div class="akari-overlay-container" data-akari-active><div class="scene-content">${fragment}</div></div></div></body></html>`;
const harness = resolve(outDir, "harness.html");
writeFileSync(harness, page);
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, userDataDir: "C:/t/credit-text/edge-profile", pipe: true,
  args: ["--no-sandbox", "--allow-file-access-from-files", "--force-color-profile=srgb", "--disable-lcd-text", "--disable-gpu"] });
try {
  const tab = await browser.newPage();
  await tab.setViewport({ width, height, deviceScaleFactor: 1 });
  await tab.goto(pathToFileURL(harness).href, { waitUntil: "load" });
  await tab.evaluate(() => document.fonts.ready);
  const fontsOk = await tab.evaluate(() => [...document.fonts].map((f) => `${f.family}/${f.weight}:${f.status}`));
  console.log(JSON.stringify({ fonts: fontsOk }));
  for (const t of times) {
    const n = await tab.evaluate((s) => { const a = document.getAnimations(); for (const x of a) { x.pause(); x.currentTime = s * 1000; } return a.length; }, t);
    await new Promise((r) => setTimeout(r, 40));
    const buf = await tab.screenshot({ omitBackground: true });
    const name = `t${t.toFixed(4)}.png`;
    writeFileSync(resolve(outDir, name), buf);
    console.log(JSON.stringify({ t, animations: n, out: name }));
  }
} finally { const p = browser.process(); if (p) p.kill("SIGKILL"); else await browser.close(); }
