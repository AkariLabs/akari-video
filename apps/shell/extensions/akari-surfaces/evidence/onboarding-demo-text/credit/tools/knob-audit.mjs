import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const WT = "C:/Users/kyach/akari-wt/onboarding-demo-rich";
const require = createRequire(`${WT}/packages/render-cut/`);
const puppeteer = require("puppeteer-core");
const fragment = readFileSync(process.argv[2], "utf8");
const vocab = readFileSync(`${WT}/packages/overlay-runtime/src/motion-vocab.css`, "utf8");
const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}#stage{position:relative;width:1280px;height:720px;overflow:hidden}.akari-overlay-container{position:absolute;inset:0}.akari-overlay-container>.scene-content{position:absolute;inset:0}</style><style>${vocab}</style></head><body><div id="stage"><div class="akari-overlay-container" data-akari-active><div class="scene-content">${fragment}</div></div></div></body></html>`;
writeFileSync("C:/t/credit-text/knobs.html", page);
const knobs = [
  ["--credit-right", "200px", 1.95], ["--credit-top", "200px", 1.95], ["--credit-row-gap", "40px", 1.95], ["--credit-gap", "40px", 1.95],
  ["--credit-label-size", "20px", 1.95], ["--credit-name-size", "40px", 1.95], ["--credit-hero-size", "60px", 1.95], ["--credit-spark-size", "40px", 1.95],
  ["--credit-rule-top", "280px", 1.95], ["--credit-rule-width", "120px", 1.95], ["--credit-plate-top", "440px", 1.95], ["--credit-plate-size", "24px", 1.95],
  ["--credit-tagline-size", "16px", 1.95], ["--credit-tagline-gap", "30px", 1.95], ["--credit-halo", "2px", 1.95], ["--credit-halo-small", "1px", 1.95],
  ["--credit-halo-color", "#00FF00", 1.95], ["--credit-shadow-color", "rgba(255,0,0,.5)", 1.95], ["--demo-ink", "#0000FF", 1.95], ["--demo-ink-sub", "#FF00FF", 1.95],
  ["--demo-accent", "#2563EB", 1.95], ["--demo-spark", "#00FFFF", 1.95], ["--credit-font", "serif", 1.95],
  ["--credit-row1-delay", "0.5s", 0.1], ["--credit-row2-delay", "0.6s", 0.3], ["--credit-spark-delay", "0.9s", 0.5], ["--credit-rule-delay", "1.2s", 0.8],
  ["--credit-plate-delay", "1.3s", 0.9], ["--credit-glint-delay", "0.5s", 0.7],
];
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, userDataDir: "C:/t/credit-text/edge-profile", pipe: true, args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb", "--disable-lcd-text"] });
const shot = async (tab, name, value, t) => {
  await tab.evaluate((n, v) => { const c = document.querySelector(".akari-overlay-container"); c.removeAttribute("style"); if (n) c.style.setProperty(n, v); }, name, value);
  await tab.evaluate((s) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = s * 1000; } }, t);
  await new Promise((r) => setTimeout(r, 30));
  return (await tab.screenshot({ omitBackground: true })).toString("base64");
};
try {
  const tab = await browser.newPage();
  await tab.setViewport({ width: 1280, height: 720 });
  await tab.goto(pathToFileURL("C:/t/credit-text/knobs.html").href, { waitUntil: "load" });
  await tab.evaluate(() => document.fonts.ready);
  const base = {};
  const result = [];
  for (const [n, v, t] of knobs) {
    base[t] ??= await shot(tab, null, null, t);
    const s = await shot(tab, n, v, t);
    result.push({ knob: n, value: v, seek: t, reacts: s !== base[t] });
  }
  console.log(JSON.stringify(result.filter((r) => !r.reacts)));
  console.log(`reacting ${result.filter((r) => r.reacts).length}/${result.length}`);
  writeFileSync("C:/t/credit-text/knob-audit.json", JSON.stringify(result, null, 1));
} finally { const p = browser.process(); if (p) p.kill("SIGKILL"); }
