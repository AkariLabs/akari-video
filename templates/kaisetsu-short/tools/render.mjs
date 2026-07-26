#!/usr/bin/env node
// render.mjs — timeline.json + composition/index.html -> mp4（決定論的レンダラー）
//
// render-v3.mjs の汎用化版。プロジェクト dir を引数に取り、JPEG フレーム連番 +
// FRAMES_PER_PAGE 毎のページ再生成 + mux 分離という決定論契約（タスク契約 §設計指示6）
// を維持する。フレーム資産は既定で保持する（外部 kill 対策）。
//
// 使い方: node tools/render.mjs <projectDir> [--timeline <path>] [--out <path>]
//         [--composition <path>] [--keep-frames] [--spotframes t1,t2,...]
import { pathToFileURL } from "node:url";
import { mkdir, rm, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPuppeteer, findChromeExecutable, launchBrowser } from "./lib/chrome.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_COMPOSITION = path.join(__dirname, "..", "composition", "index.html");
const FRAMES_PER_PAGE = 200; // render-v3.mjs の実測値を踏襲（Chromium 側 screenshot パイプラインの劣化対策）

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
  });
}

async function openFreshPage(browser, compositionPath, timeline) {
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("[page error]", err.message));
  page.on("console", (msg) => { if (msg.type() === "error") console.error("[page console]", msg.text()); });
  await page.setViewport({ width: timeline.width, height: timeline.height, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((data) => { window.__TIMELINE_DATA__ = data; }, timeline);
  await page.goto(pathToFileURL(compositionPath).href, { waitUntil: "networkidle0" });
  await page.evaluate(() => window.__akariReady);
  return page;
}

async function captureFrames({ puppeteer, chromePath, compositionPath, timeline, framesDir }) {
  await mkdir(framesDir, { recursive: true });
  const existing = await readdir(framesDir).catch(() => []);
  if (existing.length) {
    console.log(`[render] frames dir already has ${existing.length} files - wiping for a clean run`);
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(framesDir, { recursive: true });
  }

  const { fps, total } = timeline;
  const frameCount = Math.ceil(total * fps);
  console.log(`[render] capturing ${frameCount} frames at ${fps}fps (${timeline.width}x${timeline.height}), JPEG q90, page reload every ${FRAMES_PER_PAGE} frames`);

  const browser = await launchBrowser(puppeteer, chromePath);
  const startedAt = Date.now();
  try {
    let page = await openFreshPage(browser, compositionPath, timeline);
    let framesSincePageOpen = 0;
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (framesSincePageOpen >= FRAMES_PER_PAGE) {
        await page.close();
        page = await openFreshPage(browser, compositionPath, timeline);
        framesSincePageOpen = 0;
      }
      const t = frame / fps;
      await page.evaluate((sec) => window.akariSetTime(sec), t);
      const filename = path.join(framesDir, `${String(frame).padStart(5, "0")}.jpg`);
      await page.screenshot({ path: filename, type: "jpeg", quality: 90 });
      framesSincePageOpen += 1;
      if (frame % 150 === 0 || frame === frameCount - 1) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        const fpsAvg = (frame / ((Date.now() - startedAt) / 1000)).toFixed(2);
        console.log(`[render] frame ${frame + 1}/${frameCount} (t=${t.toFixed(2)}s) elapsed=${elapsed}s avg_fps=${fpsAvg}`);
      }
    }
    await page.close();
  } finally {
    await browser.close();
  }
  return frameCount;
}

async function muxVideo({ fps, total, beats, framesDir, outMp4 }) {
  await mkdir(path.dirname(outMp4), { recursive: true });
  const audioInputs = beats.map((b) => b.audio); // 絶対パス（generate-timeline が解決済み）
  const delaysMs = beats.map((b) => Math.round(b.start * 1000));

  const args = ["-y", "-r", String(fps), "-i", path.join(framesDir, "%05d.jpg")];
  for (const wav of audioInputs) args.push("-i", wav);

  const filterParts = [];
  const mixLabels = [];
  delaysMs.forEach((delay, idx) => {
    const inLabel = `${idx + 1}:a`;
    const outLabel = `a${idx}`;
    filterParts.push(`[${inLabel}]adelay=${delay}[${outLabel}]`);
    mixLabels.push(`[${outLabel}]`);
  });
  filterParts.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:normalize=0:dropout_transition=0[aout]`);

  args.push(
    "-filter_complex", filterParts.join(";"),
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-c:a", "aac", "-b:a", "192k",
    "-t", String(total),
    "-movflags", "+faststart",
    outMp4,
  );
  console.log("[render] running ffmpeg mux:", ["ffmpeg", ...args].join(" "));
  await run("ffmpeg", args);
}

async function extractSpotframes(times, outMp4, outDir) {
  await mkdir(outDir, { recursive: true });
  for (const t of times) {
    const outPath = path.join(outDir, `spot-t${String(t).padStart(3, "0")}.png`);
    await run("ffmpeg", ["-y", "-ss", String(t), "-i", outMp4, "-frames:v", "1", "-update", "1", outPath]);
  }
}

function parseArgs(argv) {
  const out = { projectDir: null, timeline: null, outMp4: null, composition: DEFAULT_COMPOSITION, keepFrames: true, spotframes: null, spotframesDir: null };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--timeline") out.timeline = argv[++i];
    else if (a === "--out") out.outMp4 = argv[++i];
    else if (a === "--composition") out.composition = argv[++i];
    else if (a === "--keep-frames") out.keepFrames = true;
    else if (a === "--no-keep-frames") out.keepFrames = false;
    else if (a === "--spotframes") out.spotframes = argv[++i].split(",").map(Number);
    else if (a === "--spotframes-dir") out.spotframesDir = argv[++i];
    else positional.push(a);
  }
  out.projectDir = positional[0];
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.projectDir) {
    console.error("使い方: node tools/render.mjs <projectDir> [--timeline <path>] [--out <path>] [--spotframes t1,t2,...]");
    process.exit(1);
  }
  const projectDir = path.resolve(opts.projectDir);
  const timelinePath = path.resolve(opts.timeline || path.join(projectDir, "timeline.json"));
  const outMp4 = path.resolve(opts.outMp4 || path.join(projectDir, "out", "final.mp4"));
  const framesDir = path.join(path.dirname(outMp4), "frames");

  const timeline = JSON.parse(await readFile(timelinePath, "utf8"));
  const puppeteer = await loadPuppeteer();
  const chromePath = await findChromeExecutable(puppeteer);
  console.log("[render] using Chrome at", chromePath);

  await captureFrames({ puppeteer, chromePath, compositionPath: path.resolve(opts.composition), timeline, framesDir });
  await muxVideo({ fps: timeline.fps, total: timeline.total, beats: timeline.beats, framesDir, outMp4 });

  const probe = await new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height,codec_type", "-of", "json", outMp4]);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error("ffprobe failed"))));
  });
  console.log("[render] ffprobe result:\n", probe);

  if (opts.spotframes && opts.spotframes.length) {
    await extractSpotframes(opts.spotframes, outMp4, opts.spotframesDir || path.join(path.dirname(outMp4), "spotframes"));
  }

  if (!opts.keepFrames) {
    await rm(framesDir, { recursive: true, force: true });
    console.log("[render] done. frames dir removed. output:", outMp4);
  } else {
    console.log("[render] done. frames dir kept at", framesDir, "output:", outMp4);
  }
}

main().catch((err) => {
  console.error("[render] FAILED:", err);
  process.exit(1);
});
