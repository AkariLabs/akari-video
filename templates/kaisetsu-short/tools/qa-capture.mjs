#!/usr/bin/env node
// qa-capture.mjs — QA スクリーンショット取得（T2 正本・qa/CHECKLIST.md と対応）
//
// qa-capture-v3.mjs の汎用化版。代表時刻は既定で timeline.json から自動選定する
// （各ビートの序盤/中盤/終盤 + シーン境界）。--safezone でセーフゾーンガイドを重畳する。
//
// 使い方: node tools/qa-capture.mjs <projectDir> [--timeline <path>] [--out <dir>]
//         [--safezone] [--times t1,t2,...]
import { pathToFileURL } from "node:url";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPuppeteer, findChromeExecutable, launchBrowser } from "./lib/chrome.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_COMPOSITION = path.join(__dirname, "..", "composition", "index.html");

// 代表時刻の自動選定: 各ビートについて「序盤（見切れ・段階表示の破綻が起きやすい）」
// 「中盤（口可視性・余白の定常確認）」「終盤（次ビートへの遷移直前・crossfade 中間状態）」
// の3点＋ビート開始直後の揺れ最大振幅近傍を拾う。
function autoSelectTimes(timeline) {
  const times = new Set();
  timeline.beats.forEach((b) => {
    const dur = b.end - b.start;
    times.add(round2(b.start + Math.min(0.3, dur * 0.1)));
    times.add(round2(b.start + dur * 0.5));
    times.add(round2(b.end - Math.min(0.3, dur * 0.1)));
    // 揺れ周期(3.7s/4.8s)の最大振幅近傍もサンプル（見切れ QA 用）
    times.add(round2(b.start + 1.2));
  });
  return Array.from(times).filter((t) => t >= 0 && t < timeline.total).sort((a, b) => a - b);
}
function round2(x) { return Math.round(x * 100) / 100; }

function parseArgs(argv) {
  const out = { projectDir: null, timeline: null, outDir: null, safezone: false, times: null, composition: DEFAULT_COMPOSITION };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--timeline") out.timeline = argv[++i];
    else if (a === "--out") out.outDir = argv[++i];
    else if (a === "--safezone") out.safezone = true;
    else if (a === "--times") out.times = argv[++i].split(",").map(Number);
    else if (a === "--composition") out.composition = argv[++i];
    else positional.push(a);
  }
  out.projectDir = positional[0];
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.projectDir) {
    console.error("使い方: node tools/qa-capture.mjs <projectDir> [--safezone] [--times t1,t2,...]");
    process.exit(1);
  }
  const projectDir = path.resolve(opts.projectDir);
  const timelinePath = path.resolve(opts.timeline || path.join(projectDir, "timeline.json"));
  const outDir = path.resolve(opts.outDir || path.join(projectDir, "out", "qa"));
  await mkdir(outDir, { recursive: true });

  const timeline = JSON.parse(await readFile(timelinePath, "utf8"));
  const times = opts.times || autoSelectTimes(timeline);

  const puppeteer = await loadPuppeteer();
  const chromePath = await findChromeExecutable(puppeteer);
  console.log("[qa-capture] using Chrome at", chromePath, opts.safezone ? "(safe-zone guide ON)" : "", `times=${times.length}`);

  const browser = await launchBrowser(puppeteer, chromePath);
  try {
    const page = await browser.newPage();
    page.on("pageerror", (err) => console.error("[page error]", err.message));
    page.on("console", (msg) => { if (msg.type() === "error") console.error("[page console]", msg.text()); });
    await page.setViewport({ width: timeline.width, height: timeline.height, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument((data) => { window.__TIMELINE_DATA__ = data; }, timeline);
    await page.goto(pathToFileURL(path.resolve(opts.composition)).href, { waitUntil: "networkidle0" });
    await page.evaluate(() => window.__akariReady);
    if (opts.safezone) await page.evaluate(() => window.akariSetSafeZoneGuide(true));

    for (const t of times) {
      const info = await page.evaluate((sec) => window.akariSetTime(sec), t);
      const suffix = opts.safezone ? "-sz" : "";
      const fname = `t${String(t).padStart(6, "0").replace(".", "_")}-${info.scene}${suffix}.png`;
      const outPath = path.join(outDir, fname);
      await page.screenshot({ path: outPath });
      console.log(`[qa-capture] t=${t}s scene=${info.scene} -> ${fname}`);
    }
  } finally {
    await browser.close();
  }
  console.log("[qa-capture] done. screenshots in", outDir);
}

main().catch((err) => {
  console.error("[qa-capture] FAILED:", err);
  process.exit(1);
});
