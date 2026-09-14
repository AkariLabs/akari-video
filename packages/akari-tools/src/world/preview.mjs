import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveFfmpeg } from "../../../media-bin/src/index.mjs";
import { renderOverlaySheet } from "../../../render-cut/src/rasterize.mjs";
import { findChrome } from "../../bin/avatar-vrm/find-chrome.mjs";
import { createCamera } from "./camera.mjs";
import { readCheckedWorldMap } from "./build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, "../../../render-cut/src/render-cut.mjs"));
const FPS = 30;

export function previewTimes(map) {
  const values = [];
  for (const stop of map.cameraStops) values.push(stop.at, (stop.at + stop.leave) / 2, stop.leave);
  for (const edge of map.edges) {
    values.push((edge.t0 + edge.t1) / 2);
    if (edge.type !== "move") values.push(edge.switchTime - 1 / FPS, edge.switchTime + 1 / FPS);
  }
  return [...new Set(values.map(roundTime))].sort((a, b) => a - b);
}

export async function previewWorld(projectRoot, options = {}) {
  projectRoot = path.resolve(projectRoot);
  const { map, file: mapPath } = await readCheckedWorldMap(projectRoot);
  const edit = JSON.parse(await readFile(path.join(projectRoot, "edit.json"), "utf8"));
  const htmlPath = path.join(projectRoot, "overlays", "world.html");
  const html = await readFile(htmlPath, "utf8");
  const outputDir = path.join(projectRoot, ".akari", "reports", "world-preview");
  await mkdir(outputDir, { recursive: true });
  const baseTimes = previewTimes(map);
  const measureTimes = options.measure ? map.edges.filter((edge) => edge.type !== "move").flatMap((edge) => frameRange(edge.t0, edge.t1)) : [];
  const times = [...new Set([...baseTimes, ...measureTimes].map(roundTime))].sort((a, b) => a - b);
  const capture = options.capture ?? captureFrames;
  const files = await capture({ projectRoot, edit, html, htmlPath, times, outputDir, width: edit.output?.width ?? 1920, height: edit.output?.height ?? 1080, chromePath: options.chromePath });
  const cameraAt = createCamera(map);
  const frames = baseTimes.map((time) => {
    const camera = cameraAt(time);
    return { time, world: camera.world, ...(camera.edge ? { edge: camera.edge } : {}), camera, png: path.relative(projectRoot, files.get(roundTime(time))).split(path.sep).join("/") };
  });
  const proofPath = path.join(outputDir, "camera-proof.json");
  await writeFile(proofPath, `${JSON.stringify({ frames }, null, 2)}\n`, "utf8");
  const measurements = [];
  if (options.measure) {
    const measureFrame = options.measureFrame ?? ((file) => measurePng(file, options));
    for (const edge of map.edges.filter((candidate) => candidate.type !== "move")) {
      const samples = [];
      for (const time of frameRange(edge.t0, edge.t1)) samples.push({ time, ...(await measureFrame(files.get(roundTime(time)))) });
      const longest = longestCoveredRun(samples);
      measurements.push({ id: edge.id, cover: roundTime(longest / FPS), samples });
    }
    await writeMeasuredCovers(mapPath, measurements);
  }
  return { frames, files, proofPath, measurements };
}

export async function captureFrames({ projectRoot, edit, html, htmlPath, times, outputDir, width, height, chromePath }) {
  const sheet = renderOverlaySheet({ overlays: [{ id: "world", start: 0, duration: editDurationSeconds(edit), html, htmlPath }], edit, projectRoot, duration: editDurationSeconds(edit) });
  const sheetPath = path.join(outputDir, "sheet.html");
  await writeFile(sheetPath, sheet, "utf8");
  let puppeteer;
  try {
    puppeteer = require("puppeteer-core");
  } catch (error) {
    throw new Error("`akari world preview` には puppeteer-core が必要です（配布版には同梱していません）。モノレポの checkout で実行するか、`akari world build` / `check` / `overview` を使ってください。", { cause: error });
  }
  const executablePath = chromePath ?? process.env.AKARI_CHROME_BIN?.trim() ?? findChrome();
  if (!executablePath || !existsSync(executablePath)) throw new Error("この機能には Chrome が必要です（`AKARI_CHROME_BIN` で指定）");
  const browser = await puppeteer.launch({ executablePath, headless: true, protocolTimeout: 600_000, args: ["--no-sandbox", "--disable-gpu", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--allow-file-access-from-files"] });
  const files = new Map();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(sheetPath).href, { waitUntil: "load", timeout: 180_000 });
    await page.evaluate(() => window.__akariReady);
    for (const time of times) {
      await page.evaluate((seconds) => window.__akariSeek(seconds), time);
      const file = path.join(outputDir, `${timeName(time)}.png`);
      await page.screenshot({ path: file, omitBackground: false, timeout: 600_000 });
      files.set(roundTime(time), file);
    }
  } finally {
    await browser.close();
  }
  return files;
}

export function measurePng(file, options = {}) {
  const ffmpeg = options.ffmpeg ?? resolveFfmpeg();
  const result = (options.spawn ?? spawnSync)(ffmpeg, ["-v", "error", "-i", file, "-vf", "signalstats,format=rgb24", "-frames:v", "1", "-f", "rawvideo", "-"], { encoding: null, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`ffmpeg signalstats に失敗しました: ${String(result.stderr ?? "")}`);
  const pixels = result.stdout;
  const count = pixels.length / 3;
  const sums = [0, 0, 0];
  const squares = [0, 0, 0];
  for (let index = 0; index < pixels.length; index += 3) for (let channel = 0; channel < 3; channel += 1) { const value = pixels[index + channel]; sums[channel] += value; squares[channel] += value * value; }
  const means = sums.map((sum) => sum / count);
  const stddev = Math.sqrt(squares.reduce((sum, square, channel) => sum + square / count - means[channel] ** 2, 0) / 3);
  const coverColor = means.map(Math.round);
  let matching = 0;
  for (let index = 0; index < pixels.length; index += 3) if ([0, 1, 2].every((channel) => Math.abs(pixels[index + channel] - coverColor[channel]) < 14)) matching += 1;
  const coverRate = matching / count;
  return { stddev, coverRate, coverColor, covered: stddev <= 2 && coverRate >= 0.995 };
}

export async function writeMeasuredCovers(file, measurements) {
  let text = await readFile(file, "utf8");
  for (const measurement of measurements) text = replaceEdgeCover(text, measurement.id, measurement.cover);
  await writeFile(file, text, "utf8");
}

export function replaceEdgeCover(text, edgeId, cover) {
  const marker = new RegExp(`"id"\\s*:\\s*"${escapeRegExp(edgeId)}"`, "g");
  const match = marker.exec(text);
  if (!match) throw new Error(`world-map.json に edge ${edgeId} がありません`);
  const end = objectEnd(text, text.lastIndexOf("{", match.index));
  const segment = text.slice(match.index, end);
  const coverMatch = /"transition"\s*:\s*\{[^{}]*?"cover"(\s*:\s*)(null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/s.exec(segment);
  if (!coverMatch) throw new Error(`edge ${edgeId} の transition.cover がありません`);
  const start = match.index + coverMatch.index + coverMatch[0].lastIndexOf(coverMatch[2]);
  return text.slice(0, start) + String(cover) + text.slice(start + coverMatch[2].length);
}

function objectEnd(text, start) { let depth = 0, string = false, escaped = false; for (let i = start; i < text.length; i += 1) { const c = text[i]; if (string) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') string = false; } else if (c === '"') string = true; else if (c === "{") depth += 1; else if (c === "}" && --depth === 0) return i + 1; } throw new Error("world-map.json の edge object が閉じていません"); }
function longestCoveredRun(samples) { let best = 0, current = 0; for (const sample of samples) { current = sample.covered ? current + 1 : 0; best = Math.max(best, current); } return best; }
function frameRange(start, end) { const first = Math.ceil((start - 1e-9) * FPS); const last = Math.floor((end + 1e-9) * FPS); return Array.from({ length: last - first + 1 }, (_, index) => roundTime((first + index) / FPS)); }
function editDurationSeconds(edit) { const fps = edit.output?.fps ?? FPS; let frames = 1; const visit = (item, offset = 0) => { frames = Math.max(frames, offset + (item.at ?? 0) + (item.duration ?? 0)); for (const child of item.items ?? []) visit(child, offset + (item.at ?? 0)); }; for (const track of edit.tracks ?? []) for (const item of track.items ?? []) visit(item); return frames / fps; }
const roundTime = (value) => Math.round(value * 1e6) / 1e6;
const timeName = (time) => `t-${time.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
