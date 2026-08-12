// 性能予算（契約 §4-7・T3 指示 6）: 「extrude 8 文字で 30fps 以上」の実測（プレビュー）+
// 8 文字 extrude シーンの書き出し所要（export）の両方を record する。
// プレビュー fps は 3d-text-flat/perf-fps.mjs と同じ流儀（overlay-runtime.js の tick() を
// rAF ループで駆動し、実際に描かれたフレーム数を壁時計で数える）。書き出し所要は
// captureWithPuppeteer の壁時計を直接計測する。
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { captureWithPuppeteer, renderOverlaySheet } from "../../src/rasterize.mjs";
import {
  editFor,
  FONT_RELATIVE_PATH,
  launchBrowser,
  loadPuppeteerModule,
  makeProjectRoot,
  overlayFor,
  previewPageHtml,
  resolveChromePath,
  stageRuntimeScripts,
  startStaticServer,
} from "./support/fixtures.mjs";

const ARTIFACTS_DIR = join(new URL(".", import.meta.url).pathname, "artifacts");
await mkdir(ARTIFACTS_DIR, { recursive: true });

// 契約 §4-7 のとおり「extrude 8 文字」
const TEXT_8_CHARS = "アカリビデオ動画";
console.error("char count:", [...TEXT_8_CHARS].length);

function sceneFor() {
  return {
    texts: [{
      id: "perf",
      text: TEXT_8_CHARS,
      font: FONT_RELATIVE_PATH,
      mode: "extrude",
      size: 0.6,
      color: "#ffd166",
      material: { metalness: 0.7, roughness: 0.3 },
      extrude: { depth: 0.24, bevelSize: 0.022, bevelThickness: 0.03 },
      layout: { type: "line", spacing: 0.72 },
      anim: { preset: "carousel", speed: 0.6, seed: 11 },
    }],
    camera: { position: [0, 0.2, 6.0], fov: 45, lookAt: [0, 0, 0] },
  };
}

function loadAverageNote() {
  const result = spawnSync("uptime", [], { encoding: "utf8" });
  return result.stdout?.trim() ?? "uptime unavailable";
}

// --- (a) プレビュー fps ---
const edit = editFor({ width: 1280, height: 720, fps: 30 });
const PREVIEW_DURATION = 20; // overlay 側の可視区間。実測は rAF ループで別途 wall-clock 駆動する
const previewProjectRoot = await makeProjectRoot("perf-fps-preview");
await mkdir(join(previewProjectRoot, "work"), { recursive: true });
await stageRuntimeScripts(previewProjectRoot);
const previewOverlay = overlayFor("perf", sceneFor(), { start: 0, duration: PREVIEW_DURATION });
await writeFile(
  join(previewProjectRoot, "preview.html"),
  previewPageHtml({ overlay: previewOverlay, edit }),
  "utf8",
);

const server = await startStaticServer(previewProjectRoot);
const { browser } = await launchBrowser();
let measurement;
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("PAGEERROR:", String(e)));
  await page.setViewport({ width: edit.output.width, height: edit.output.height, deviceScaleFactor: 1 });
  await page.goto(`${server.url}/preview.html`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.evaluate(() => window.__akariPreviewReady);
  await page.evaluate(() => window.akari.runtime.tick(0, true));
  await page.evaluate(async () => {
    const container = document.querySelector("#overlay-stage > div");
    for (let i = 0; i < 3000; i += 1) {
      const status = window.akari.threeRuntime.inspect(container).status;
      if (status === "ready") return;
      if (status === "error") throw new Error("perf scene failed to load");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("perf scene did not become ready in time");
  });

  measurement = await page.evaluate(() => new Promise((resolve) => {
    const durationMs = 3000;
    let frames = 0;
    const start = performance.now();
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      resolve({ frames, elapsedMs: performance.now() - start });
    }
    function step(now) {
      if (done) return;
      const elapsedSeconds = (now - start) / 1000;
      window.akari.runtime.tick(elapsedSeconds, true);
      frames += 1;
      requestAnimationFrame(step);
    }
    setTimeout(finish, durationMs);
    requestAnimationFrame(step);
  }));

  const info = await page.evaluate(() => {
    const container = document.querySelector("#overlay-stage > div");
    return window.akari.threeRuntime.inspect(container);
  });
  measurement.rendererInfo = info;

  const roundTripStarted = performance.now();
  const ROUND_TRIP_SAMPLES = 20;
  for (let i = 0; i < ROUND_TRIP_SAMPLES; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate((n) => n + 1, i);
  }
  measurement.roundTripMsPerCall = (performance.now() - roundTripStarted) / ROUND_TRIP_SAMPLES;
} finally {
  await browser.close();
  await server.close();
}
await rm(previewProjectRoot, { recursive: true, force: true });

const previewFps = measurement.frames / (measurement.elapsedMs / 1000);

// --- (b) 書き出し所要 ---
const EXPORT_DURATION = 2.0;
const exportEdit = editFor({ width: 1280, height: 720, fps: 30 });
const exportProjectRoot = await makeProjectRoot("perf-fps-export");
const exportWorkDir = join(exportProjectRoot, "work");
await mkdir(exportWorkDir, { recursive: true });
const exportOverlay = overlayFor("perf", sceneFor(), { start: 0, duration: EXPORT_DURATION });
const exportSheetPath = join(exportWorkDir, "sheet.html");
await writeFile(
  exportSheetPath,
  renderOverlaySheet({ overlays: [exportOverlay], edit: exportEdit, projectRoot: exportProjectRoot, duration: EXPORT_DURATION }),
  "utf8",
);
const puppeteerModule = await loadPuppeteerModule();
const chromePath = await resolveChromePath();
const exportFramesDirectory = join(exportWorkDir, "frames");
const exportStarted = performance.now();
await captureWithPuppeteer({
  sheetPath: exportSheetPath,
  chromePath,
  framesDirectory: exportFramesDirectory,
  overlayMovPath: join(exportWorkDir, "overlay.mov"),
  width: exportEdit.output.width,
  height: exportEdit.output.height,
  fps: exportEdit.output.fps,
  duration: EXPORT_DURATION,
  ffmpegCommand: "ffmpeg",
  puppeteerModule,
});
const exportElapsedMs = performance.now() - exportStarted;
const exportFrameCount = (await readdir(exportFramesDirectory)).filter((f) => f.endsWith(".png")).length;
await rm(exportProjectRoot, { recursive: true, force: true });

const result = {
  generated_at_note: "generated by evidence/3d-text-extrude/perf-fps.mjs",
  scene: `texts[] extrude + carousel, ${[...TEXT_8_CHARS].length} chars`,
  loadAverageAtMeasurementTime: loadAverageNote(),
  preview: {
    output: edit.output,
    measuredFrames: measurement.frames,
    elapsedMs: Math.round(measurement.elapsedMs),
    fps: Number(previewFps.toFixed(2)),
    budgetFps: 30,
    meetsBudget: previewFps >= 30,
    rendererInfo: measurement.rendererInfo,
    cdpRoundTripMsPerCall: Number(measurement.roundTripMsPerCall.toFixed(2)),
  },
  export: {
    output: exportEdit.output,
    durationSeconds: EXPORT_DURATION,
    frameCount: exportFrameCount,
    elapsedMs: Math.round(exportElapsedMs),
    msPerFrame: Number((exportElapsedMs / exportFrameCount).toFixed(2)),
  },
  note: "M 系 Mac 実機・ヘッドレス Chrome（software WebGL, SwiftShader）での実測。GPU 実機の"
    + "プレビュー（実ブラウザ）とは描画バックエンドが異なるため、絶対値は下振れしうる。"
    + "preview.fps は seek/screenshot コストを含まない純粋な render() 呼び出しの fps を rAF ループで"
    + "実測している。export は captureWithPuppeteer 呼び出し全体（Chrome 起動〜フレームループ〜"
    + "エンコード）の壁時計。cdpRoundTripMsPerCall は実描画を含まない Node<->Chrome CDP 往復単体の"
    + "コストで、fps が低い原因が render() 自体の重さかセッション外の負荷による往復遅延かの"
    + "切り分けに使う",
};

await writeFile(join(ARTIFACTS_DIR, "perf-fps-result.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));
