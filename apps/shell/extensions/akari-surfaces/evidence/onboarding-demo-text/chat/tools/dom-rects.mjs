// 断片の base（最終の静止状態）での各要素の箱を取る
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const WT = "<WORKTREE>";
const require = createRequire(`${WT}/packages/render-cut/`);
const puppeteer = require("puppeteer-core");
const CHROME = `${process.env.LOCALAPPDATA}/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe`;
const [fragmentPath, outJson] = process.argv.slice(2);
const fragment = readFileSync(fragmentPath, "utf8");
const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}#stage{position:relative;width:1280px;height:720px;overflow:hidden}.akari-overlay-container{position:absolute;inset:0}.akari-overlay-container>.scene-content{position:absolute;inset:0}</style></head><body><div id="stage"><div class="akari-overlay-container"><div class="scene-content">${fragment}</div></div></div></body></html>`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell", pipe: true, args: ["--no-sandbox", "--disable-gpu"] });
try {
  const tab = await browser.newPage();
  await tab.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const h = `${outJson}.harness.html`;
  writeFileSync(h, page);
  await tab.goto(pathToFileURL(h).href, { waitUntil: "load" });
  await tab.evaluate(() => document.fonts.ready);
  const rects = await tab.evaluate(() => {
    const pick = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
    const fontsOk = [...document.fonts].map(f => `${f.family} ${f.weight} ${f.status}`);
    const sizes = {};
    for (const sel of [".demo-chat__head span", ".demo-chat__bubble--you", ".demo-chat__reply span"]) sizes[sel] = getComputedStyle(document.querySelector(sel)).fontSize;
    return { card: pick(".demo-chat__card"), head: pick(".demo-chat__head"), headText: pick(".demo-chat__head span"), you: pick(".demo-chat__bubble--you"), ai: pick(".demo-chat__ai"), avatar: pick(".demo-chat__avatar"), typing: pick(".demo-chat__typing .demo-chat__bubble"), reply: pick(".demo-chat__reply"), replyText: pick(".demo-chat__reply span"), check: pick(".demo-chat__check"), fontsOk, sizes };
  });
  unlinkSync(h);
  writeFileSync(outJson, JSON.stringify(rects, null, 1));
  console.log(JSON.stringify(rects));
} finally { browser.process()?.kill("SIGKILL"); }
