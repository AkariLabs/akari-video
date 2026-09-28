// L1 probe (#111): load the OSR overlay sheet of a project in real Chromium (Electron offscreen, like
// osr-export) and step __akariSeek over every frame. Records live 3D scenes, <video> seeks per frame,
// wall time and memory. Usage:
//   electron.exe sheet-probe.mjs --wt <worktree> --project <dir> --out <json> [--frames N]
import { app, BrowserWindow } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { appendFileSync } from "node:fs";
const plog = (...parts) => appendFileSync(process.env.PROBE_LOG ?? "probe.log", parts.map(String).join(" ") + "\n");
plog("[probe] start", process.argv.join(" "));

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
const worktree = args.wt;
const projectRoot = args.project;
const outPath = args.out;

app.commandLine.appendSwitch("force-color-profile", "srgb");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");

const { renderOverlaySheet } = await import(pathToFileURL(join(worktree, "packages/render-cut/src/rasterize.mjs")).href);
const edit = JSON.parse(readFileSync(join(projectRoot, "edit.json"), "utf8"));
const fps = edit.output.fps;
const overlays = edit.tracks.flatMap((track) => track.items).map((item) => ({
  id: item.id,
  start: item.at / fps,
  duration: item.duration / fps,
  htmlPath: item.source.path,
  html: readFileSync(join(projectRoot, item.source.path), "utf8"),
}));
const duration = Math.max(...overlays.map((overlay) => overlay.start + overlay.duration));
const frames = Number(args.frames ?? Math.round(duration * fps));
const sheetPath = outPath.replace(/\.json$/u, ".sheet.html");
writeFileSync(sheetPath, renderOverlaySheet({ overlays, edit, projectRoot, duration }));
const preloadPath = outPath.replace(/\.json$/u, ".preload.cjs");
writeFileSync(preloadPath, `
const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
window.__probe = { seeks: 0, seekedVideos: new Set() };
Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
  configurable: true,
  get() { return descriptor.get.call(this); },
  set(value) { window.__probe.seeks += 1; window.__probe.seekedVideos.add(this); descriptor.set.call(this, value); },
});
`);

plog("[probe] sheet written");
app.whenReady().then(main).catch((error) => { plog("[probe] fatal", error.stack); app.exit(2); });
async function main() {
const window = new BrowserWindow({
  show: false, width: edit.output.width, height: edit.output.height, useContentSize: true,
  webPreferences: { offscreen: true, backgroundThrottling: false, preload: preloadPath, contextIsolation: false, nodeIntegration: false, sandbox: false },
});
window.webContents.setFrameRate(60);
window.webContents.startPainting();
const consoleErrors = [];
window.webContents.on("console-message", (event) => {
  const level = event.level ?? event.params?.level;
  const message = event.message ?? event.params?.message;
  plog("[page]", String(message).slice(0, 300));
  if (level === "error" || level === 3 || level === "warning" || level === 2) consoleErrors.push(String(message).slice(0, 200));
});
function memory() {
  const metrics = app.getAppMetrics();
  const byType = {};
  for (const metric of metrics) byType[metric.type] = (byType[metric.type] ?? 0) + (metric.memory?.privateBytes ?? metric.memory?.workingSetSize ?? 0);
  return byType; // KB
}
const started = performance.now();
plog("[probe] loading", sheetPath);
await window.loadFile(sheetPath);
plog("[probe] loaded", Math.round(performance.now() - started));
const readyTimer = setInterval(async () => {
  try {
    const state = await window.webContents.executeJavaScript(`JSON.stringify({ videos: Array.from(document.querySelectorAll('video'), v => [v.readyState, v.seeking, v.currentTime]), three: Array.from(document.querySelectorAll('.akari-overlay-container > .scene-content'), c => window.akari?.threeRuntime?.inspect(c).status) })`);
    plog("[probe] waiting ready", Math.round(performance.now() - started), state);
  } catch (error) { plog("[probe] state error", error.message); }
}, 5000);
await window.webContents.executeJavaScript("window.__akariReady");
clearInterval(readyTimer);
plog("[probe] ready", Math.round(performance.now() - started));
const readyMs = performance.now() - started;
const readyState = await window.webContents.executeJavaScript(`(() => {
  const containers = Array.from(document.querySelectorAll('.akari-overlay-container > .scene-content'));
  return {
    live: containers.filter((c) => window.akari.threeRuntime.inspect(c).status !== 'disposed').map((c) => c.parentElement.dataset.overlayId),
    videos: document.querySelectorAll('video').length,
    heap: performance.memory?.usedJSHeapSize ?? null,
  };
})()`);
const memoryAtReady = memory();
const perFrame = [];
let peakMemory = { ...memoryAtReady };
let peakHeap = readyState.heap ?? 0;
const loopStarted = performance.now();
for (let frame = 0; frame < frames; frame += 1) {
  const row = await window.webContents.executeJavaScript(`(async () => {
    window.__probe.seeks = 0; window.__probe.seekedVideos = new Set();
    const t0 = performance.now();
    const result = await window.__akariSeek(${frame} / ${fps});
    const ms = performance.now() - t0;
    const containers = Array.from(document.querySelectorAll('.akari-overlay-container > .scene-content'));
    return {
      ms,
      live: containers.filter((c) => window.akari.threeRuntime.inspect(c).status !== 'disposed').length,
      videos: document.querySelectorAll('video').length,
      seeks: window.__probe.seeks,
      seekedVideos: window.__probe.seekedVideos.size,
      warnings: result?.warnings?.length ?? 0,
      heap: performance.memory?.usedJSHeapSize ?? null,
    };
  })()`);
  perFrame.push({ frame, ...row });
  if (frame % 60 === 0) plog("[probe] frame", frame, JSON.stringify(row));
  if (row.heap) peakHeap = Math.max(peakHeap, row.heap);
  if (frame % 15 === 0) {
    const current = memory();
    for (const [type, value] of Object.entries(current)) peakMemory[type] = Math.max(peakMemory[type] ?? 0, value);
  }
}
const loopMs = performance.now() - loopStarted;
const stats = await window.webContents.executeJavaScript("window.__akariThreeWindowStats ?? null");
const sum = (key) => perFrame.reduce((total, row) => total + row[key], 0);
const summary = {
  worktreeTag: args.tag ?? null,
  frames,
  fps,
  readyMs: Math.round(readyMs),
  readyLive: readyState.live,
  readyVideos: readyState.videos,
  loopMs: Math.round(loopMs),
  msPerFrameMean: +(loopMs / frames).toFixed(2),
  liveMax: Math.max(...perFrame.map((row) => row.live)),
  videosInDomMax: Math.max(...perFrame.map((row) => row.videos)),
  seeksTotal: sum("seeks"),
  seekedVideosPerFrameMax: Math.max(...perFrame.map((row) => row.seekedVideos)),
  seekedVideosPerFrameMean: +(sum("seekedVideos") / frames).toFixed(2),
  warningsTotal: sum("warnings"),
  peakHeapMB: +(peakHeap / 1048576).toFixed(1),
  memoryAtReadyMB: Object.fromEntries(Object.entries(memoryAtReady).map(([k, v]) => [k, +(v / 1024).toFixed(1)])),
  peakMemoryMB: Object.fromEntries(Object.entries(peakMemory).map(([k, v]) => [k, +(v / 1024).toFixed(1)])),
  threeWindowStats: stats,
  consoleErrors: consoleErrors.slice(0, 10),
  timeline: perFrame.filter((row, index) => index === 0 || row.live !== perFrame[index - 1].live || row.videos !== perFrame[index - 1].videos)
    .map((row) => ({ frame: row.frame, seconds: +(row.frame / fps).toFixed(3), live: row.live, videos: row.videos, seekedVideos: row.seekedVideos })),
};
writeFileSync(outPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
window.destroy();
app.quit();
}
