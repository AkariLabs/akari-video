#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_STALE_AFTER_SECONDS = 900;
const MIME_BY_EXTENSION = new Map([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

export function renderStoryboardPrint({ edit, captions, frames = [], sidecars = {}, generatedAt, title }) {
  const fps = editFps(edit);
  const items = visualMediaItems(edit);
  const totalFrames = items.reduce((maximum, item) => Math.max(maximum, item.at + item.duration), 0);
  const totalSeconds = totalFrames / fps;
  const generated = generatedAt instanceof Date ? generatedAt.toISOString() : String(generatedAt ?? "");
  const reportTitle = String(title || "絵コンテ（印刷）");
  const frameByItem = new Map(frames.map((frame) => [frame.itemId, frame]));
  const captionList = normalizeCaptions(captions);

  const bars = items.map((item, index) => {
    const width = totalFrames > 0 ? item.duration / totalFrames * 100 : 0;
    return `<div class="duration-segment segment-${(index % 5) + 1}" data-item-id="${escapeHtml(item.id)}" data-duration-frames="${item.duration}" style="width:${formatNumber(width)}%"><strong>${escapeHtml(itemName(item, index))}</strong><span>${formatSeconds(item.duration / fps)} 秒</span></div>`;
  }).join("");

  const cards = items.map((item, index) => {
    const start = item.at / fps;
    const end = (item.at + item.duration) / fps;
    const frame = frameByItem.get(item.id);
    const image = frameDataUri(frame);
    const overlapping = captionList.filter((caption) => caption.start < end && caption.end > start).slice(0, 2);
    const captionRows = overlapping.length
      ? overlapping.map((caption) => `<li>${escapeHtml(caption.text)}</li>`).join("")
      : `<li class="caption-empty">字幕なし</li>`;
    return `<article class="storyboard-card" data-storyboard-item="${escapeHtml(item.id)}">
      <div class="frame">${image ? `<img src="${image}" alt="${escapeHtml(itemName(item, index))} の代表フレーム" />` : `<div class="frame-placeholder" aria-label="画像なし">NO CAPTURE</div>`}</div>
      <div class="card-heading"><span class="card-number">#${index + 1}</span><h2>${escapeHtml(itemName(item, index))}</h2>${renderBadge(sidecars[item.id])}</div>
      <p class="time-range"><time>${formatTime(start)}</time>〜<time>${formatTime(end)}</time></p>
      <ul class="captions">${captionRows}</ul>
    </article>`;
  }).join("\n");

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" />
  <title>${escapeHtml(reportTitle)} — AKARI Video</title>
  <style>${styles()}</style>
</head>
<body>
  <header><p class="eyebrow">AKARI VIDEO / L1 THROUGH MAP</p><h1>${escapeHtml(reportTitle)}</h1>
    <dl><div><dt>合計尺</dt><dd>${formatTime(totalSeconds)}</dd></div><div><dt>コマ数</dt><dd>${items.length}</dd></div><div><dt>生成日時</dt><dd><time datetime="${escapeHtml(generated)}">${escapeHtml(generated)}</time></dd></div></dl>
  </header>
  <main>
    <section class="duration-map" aria-labelledby="duration-heading"><h2 id="duration-heading">尺バー</h2><div class="duration-bar">${bars}</div></section>
    <section class="storyboard-grid" aria-label="絵コンテ">${cards}</section>
  </main>
</body>
</html>\n`;
}

function editFps(edit) {
  const fps = Number(edit?.fps ?? edit?.output?.fps);
  if (!(fps > 0)) throw new TypeError("edit.json の fps は正の数である必要があります");
  return fps;
}

function visualMediaItems(edit) {
  const tracks = Array.isArray(edit?.tracks) ? edit.tracks : [];
  return tracks
    .filter((track) => track?.lane === "visual" || track?.kind === "visual" || track?.type === "visual" || track?.kind === "video" || track?.type === "video")
    .flatMap((track) => Array.isArray(track.items) ? track.items : [])
    .filter((item) => (item?.source?.kind === undefined || item.source.kind === "media") && typeof item?.source?.src === "string" && Number.isFinite(item.at) && Number.isFinite(item.duration) && item.duration >= 0)
    .sort((left, right) => left.at - right.at || compareText(String(left.id), String(right.id)));
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeCaptions(captions) {
  const records = Array.isArray(captions) ? captions : Array.isArray(captions?.captions) ? captions.captions : [];
  return records.filter((caption) => Number.isFinite(caption?.start) && Number.isFinite(caption?.end) && typeof caption?.text === "string");
}

function itemName(item, index) {
  return item.name || item.id || `item-${index + 1}`;
}

function frameDataUri(frame) {
  if (typeof frame?.dataUri === "string" && frame.dataUri.startsWith("data:")) return frame.dataUri;
  if (!frame?.pngPath) return null;
  try {
    const mime = MIME_BY_EXTENSION.get(path.extname(frame.pngPath).toLowerCase()) || "image/png";
    return `data:${mime};base64,${fs.readFileSync(frame.pngPath).toString("base64")}`;
  } catch {
    return null;
  }
}

function renderBadge(sidecar) {
  if (!sidecar || sidecar.state === "none" || sidecar.state === "orphan") return "";
  if (sidecar.state === "planned") return `<span class="badge badge-planned">planned</span>`;
  if (sidecar.state === "generating" || sidecar.state === "stale") return `<span class="badge badge-generating">生成中</span>`;
  if (sidecar.state === "failed") return `<span class="badge badge-failed">失敗</span>`;
  if (sidecar.state === "done" && sidecar.kind === "still") return `<span class="badge badge-still">静止画</span>`;
  if (sidecar.state === "done" && sidecar.kind === "video") return `<span class="badge badge-video">生成</span>`;
  return "";
}

function formatNumber(value) {
  return Number(value.toFixed(6)).toString();
}

function formatSeconds(value) {
  return Number(value.toFixed(2)).toString();
}

function formatTime(seconds) {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const minutes = Math.floor(tenths / 600);
  const remainder = tenths % 600;
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(remainder / 10)).padStart(2, "0")}.${remainder % 10}`;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function styles() {
  return `:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18202a;background:#edf1f5}*{box-sizing:border-box}body{margin:0}header,main{max-width:1400px;margin:auto}header{padding:28px 32px 22px;background:#18202a;color:#fff}h1{margin:4px 0 18px;font-size:28px}.eyebrow{margin:0;color:#89b9ff;font-size:11px;font-weight:800;letter-spacing:.18em}dl{display:flex;gap:36px;margin:0}dl div{display:flex;gap:8px}dt{color:#aeb8c5}dd{margin:0;font-weight:800}main{padding:24px 32px 40px}.duration-map{margin-bottom:24px}.duration-map h2{font-size:15px}.duration-bar{display:flex;width:100%;min-height:58px;overflow:hidden;border-radius:8px;background:#d8dee6}.duration-segment{min-width:0;padding:10px 9px;border-right:2px solid #fff;color:#fff}.duration-segment strong,.duration-segment span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.duration-segment strong{font-size:12px}.duration-segment span{margin-top:4px;font-size:10px}.segment-1{background:#315ca8}.segment-2{background:#5075b6}.segment-3{background:#386f78}.segment-4{background:#6757a5}.segment-5{background:#8a5c43}.storyboard-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.storyboard-card{overflow:hidden;border:1px solid #ccd3dc;border-radius:10px;background:#fff;box-shadow:0 2px 8px #15233414}.frame{aspect-ratio:16/9;background:#d6d9dd}.frame img{display:block;width:100%;height:100%;object-fit:cover}.frame-placeholder{display:grid;width:100%;height:100%;place-items:center;color:#747b83;font-size:12px;font-weight:800;letter-spacing:.12em}.card-heading{display:flex;align-items:center;gap:8px;padding:12px 14px 0}.card-number{color:#56708c;font-size:12px;font-weight:800}.card-heading h2{min-width:0;margin:0;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.badge{margin-left:auto;padding:3px 7px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap}.badge-planned{border:1px dashed #687789;color:#536170;background:#fff}.badge-still{color:#fff;background:#2376c9}.badge-generating{color:#5c4700;background:#ffd765}.badge-video{color:#fff;background:#5668a9}.badge-failed{color:#fff;background:#d24c31}.time-range{margin:6px 14px;color:#536170;font-size:12px;font-variant-numeric:tabular-nums}.captions{min-height:48px;margin:7px 14px 14px;padding-left:18px;font-size:12px;line-height:1.45}.caption-empty{color:#9299a1}@media print{@page{size:A4 landscape;margin:9mm}:root{background:#fff}header{padding:12px 16px;color:#111;background:#fff;border-bottom:2px solid #111}header .eyebrow{color:#444}main{padding:12px 16px}.storyboard-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.storyboard-card{break-inside:avoid;box-shadow:none}.duration-map{break-inside:avoid;margin-bottom:12px}.frame{aspect-ratio:16/9}h1{font-size:20px;margin-bottom:8px}dl{gap:20px;font-size:11px}}`;
}

function parseArguments(argv) {
  const options = { projectDir: null, captures: null, noCapture: false, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--no-capture") options.noCapture = true;
    else if (argument === "--captures" || argument === "--out") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} には値が必要です`);
      if (argument === "--captures") options.captures = value;
      else options.out = value;
      index += 1;
    } else if (argument.startsWith("--")) throw new Error(`未知の引数です: ${argument}`);
    else if (!options.projectDir) options.projectDir = argument;
    else throw new Error(`余分な引数です: ${argument}`);
  }
  if (!options.projectDir) throw new Error("projectDir が必要です");
  if (options.noCapture && options.captures) throw new Error("--captures と --no-capture は併用できません");
  return options;
}

function resolveGenerationState(meta, now) {
  if (!meta || typeof meta !== "object") return "none";
  if (meta.status === "failed") return "failed";
  if (meta.status === "generating") {
    const startedMs = Date.parse(String(meta.job?.started_at ?? ""));
    const declared = meta.job?.stale_after_s;
    const staleAfter = Number.isFinite(declared) && declared >= 0 ? declared : DEFAULT_STALE_AFTER_SECONDS;
    if (Number.isFinite(startedMs) && now.getTime() - startedMs > staleAfter * 1000) return "stale";
  }
  return ["planned", "generating", "done", "failed"].includes(meta.status) ? meta.status : "none";
}

export function readSidecars(projectRoot, edit, items, now) {
  const sourceById = new Map((Array.isArray(edit.sources) ? edit.sources : []).map((source) => [source.id, source]));
  const result = {};
  for (const item of items) {
    const source = sourceById.get(item.source.src);
    if (!source?.path) continue;
    const sidecarPath = path.resolve(projectRoot, `${source.path}.meta.json`);
    try {
      const meta = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
      result[item.id] = { state: resolveGenerationState(meta, now), kind: meta.kind };
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn(`WARN: 生成サイドカーを読めません: ${path.relative(projectRoot, sidecarPath)}`);
    }
  }
  return result;
}

function ancestorDirectories(startDirectory) {
  const directories = [];
  let current = path.resolve(startDirectory);
  for (let depth = 0; depth < 10; depth += 1) {
    directories.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories;
}

function resolveCaptureCommand() {
  const ownDirectory = path.dirname(fileURLToPath(import.meta.url));
  const launcherRelative = path.join("packages", "akari-launcher", "bin", "akari.mjs");
  for (const ancestor of ancestorDirectories(ownDirectory)) {
    const candidate = path.join(ancestor, launcherRelative);
    if (fs.existsSync(candidate)) return { entry: candidate, prefix: ["capture"] };
  }
  const directRelative = path.join("packages", "akari-tools", "bin", "capture.mjs");
  for (const ancestor of ancestorDirectories(ownDirectory)) {
    const candidate = path.join(ancestor, directRelative);
    if (fs.existsSync(candidate)) return { entry: candidate, prefix: [] };
  }
  return null;
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [command.entry, ...command.prefix, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `capture exit ${code}`)));
  });
}

function parseFrameRecords(source) {
  const records = [];
  for (const line of source.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record.kind === "frame" && Number.isFinite(record.time_s) && typeof record.path === "string") records.push(record);
    } catch {
      // capture の補助ログは無視する。
    }
  }
  return records;
}

function framesFromCaptureDirectory(directory, projectRoot) {
  const manifestPath = path.join(directory, "capture.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return (Array.isArray(manifest.images) ? manifest.images : []).filter((record) => record.kind === "frame").map((record) => ({ ...record, path: path.isAbsolute(record.path) ? record.path : path.resolve(projectRoot, record.path) }));
  } catch {
    return fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => name.endsWith(".png")).sort().map((name) => ({ path: path.join(directory, name) })) : [];
  }
}

function matchFrames(items, times, records, baseDirectory) {
  return items.map((item, index) => {
    const target = times[index];
    const exact = records.find((record) => Number.isFinite(record.time_s) && Math.abs(record.time_s - target) < 0.000001);
    const record = exact || records[index];
    if (!record?.path) return { itemId: item.id, time_s: target };
    const pngPath = path.isAbsolute(record.path) ? record.path : path.resolve(baseDirectory, record.path);
    return { itemId: item.id, time_s: target, pngPath };
  });
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function main(argv) {
  const parsed = parseArguments(argv);
  const projectRoot = path.resolve(parsed.projectDir);
  const outputDirectory = path.resolve(parsed.out || path.join(projectRoot, ".akari", "reports", "storyboard"));
  const editPath = path.join(projectRoot, "edit.json");
  const captionsPath = path.join(projectRoot, "captions.json");
  const editBytes = fs.readFileSync(editPath);
  let captionsBytes = null;
  try {
    captionsBytes = fs.readFileSync(captionsPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const edit = JSON.parse(editBytes.toString("utf8"));
  const captions = captionsBytes === null ? [] : JSON.parse(captionsBytes.toString("utf8"));
  const fps = editFps(edit);
  const items = visualMediaItems(edit);
  const times = items.map((item) => Math.round((item.at / fps + 0.25) * fps) / fps);
  const generatedAt = new Date();
  const sidecars = readSidecars(projectRoot, edit, items, generatedAt);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const framesDirectory = parsed.captures ? path.resolve(parsed.captures) : path.join(outputDirectory, "frames");
  if (!parsed.captures) fs.mkdirSync(framesDirectory, { recursive: true });
  let records = [];
  if (parsed.captures) {
    records = framesFromCaptureDirectory(framesDirectory, projectRoot);
  } else if (!parsed.noCapture) {
    const command = resolveCaptureCommand();
    if (!command) console.warn("WARN: capture CLI が見つからないためプレースホルダーを使います");
    else {
      try {
        const stdout = await runCapture(command, ["-p", projectRoot, "-t", ...times.map(formatNumber), "--full", "--out", framesDirectory]);
        records = parseFrameRecords(stdout).map((record) => ({ ...record, path: path.isAbsolute(record.path) ? record.path : path.resolve(projectRoot, record.path) }));
      } catch (error) {
        console.warn(`WARN: capture に失敗したためプレースホルダーを使います: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const frames = matchFrames(items, times, records, framesDirectory);
  const html = renderStoryboardPrint({ edit, captions, frames, sidecars, generatedAt, title: path.basename(projectRoot) });
  fs.writeFileSync(path.join(outputDirectory, "index.html"), html, "utf8");
  const relativeCapturePaths = frames.map((frame) => frame.pngPath ? path.relative(projectRoot, frame.pngPath).split(path.sep).join("/") : null);
  const manifest = { edit_sha256: sha256(editBytes), captions_sha256: captionsBytes === null ? null : sha256(captionsBytes), times_s: times, generated_at: generatedAt.toISOString(), frames: relativeCapturePaths };
  fs.writeFileSync(path.join(outputDirectory, "storyboard.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`OK: ${path.relative(projectRoot, path.join(outputDirectory, "index.html"))}`);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`NG: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
