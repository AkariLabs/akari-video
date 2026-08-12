// パリティ（契約 §4-4）: プレビュー（overlay-runtime.js の mount → tick、apps/shell を介さず
// 直接ブート）と書き出し（rasterize.mjs の captureWithPuppeteer）の同時刻フレームを並べた
// コンタクトシートを証跡として残す。3d.md「パリティ」節が言う「同じ three-runtime.js を
// 同じ断片 DOM 構造へ注入する」の直接の実測。
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { captureWithPuppeteer, renderOverlaySheet } from "../../src/rasterize.mjs";
import {
  compositeOverBackground,
  editFor,
  launchBrowser,
  makeProjectRoot,
  overlayFor,
  previewPageHtml,
  readRgba,
  resolveChromePath,
  runChecked,
  stageRuntimeScripts,
  startStaticServer,
} from "./support/fixtures.mjs";
import { cylinderScene } from "./support/scenes.mjs";

const ARTIFACTS_DIR = join(new URL(".", import.meta.url).pathname, "artifacts");
await mkdir(ARTIFACTS_DIR, { recursive: true });

const edit = editFor({ width: 480, height: 270, fps: 10 });
const DURATION = 2.4;
const PARITY_TIME_SECONDS = 1.2;

const projectRoot = await makeProjectRoot("parity");
const workDir = join(projectRoot, "work");
await mkdir(workDir, { recursive: true });
const scene = cylinderScene();
const overlay = overlayFor("ring", scene, { start: 0, duration: DURATION });

// --- export 経路 ---
const sheetPath = join(workDir, "export-sheet.html");
await writeFile(
  sheetPath,
  renderOverlaySheet({ overlays: [overlay], edit, projectRoot, duration: DURATION }),
  "utf8",
);
const chromePath = await resolveChromePath();
const framesDirectory = join(workDir, "frames");
const { loadPuppeteerModule } = await import("./support/fixtures.mjs");
const puppeteerModule = await loadPuppeteerModule();
await captureWithPuppeteer({
  sheetPath,
  chromePath,
  framesDirectory,
  overlayMovPath: join(workDir, "overlay.mov"),
  width: edit.output.width,
  height: edit.output.height,
  fps: edit.output.fps,
  duration: DURATION,
  ffmpegCommand: "ffmpeg",
  puppeteerModule,
});
const frameIndex = Math.round(PARITY_TIME_SECONDS * edit.output.fps);
const frameFiles = (await readdir(framesDirectory)).filter((f) => f.endsWith(".png")).sort();
const exportFramePath = join(ARTIFACTS_DIR, "parity-export.png");
await copyFile(join(framesDirectory, frameFiles[frameIndex]), exportFramePath);

// --- preview 経路（overlay-runtime.js の mount → tick を直接ブート） ---
// projectRoot 直下に置く — texts[].font の相対パス（"fonts/..."）が
// projectRoot/fonts/ を指すため、preview.html もこの階層に置く必要がある。
// file:// だと troika の XHR フォントロードが Chrome のファイル間 XHR 制限で失敗するため、
// 実ホスト（preview 専用 localhost asset URL）と同じくローカル HTTP 経由にする
await stageRuntimeScripts(projectRoot);
const previewPath = join(projectRoot, "preview.html");
await writeFile(previewPath, previewPageHtml({ overlay, edit }), "utf8");
const server = await startStaticServer(projectRoot);

const { browser } = await launchBrowser();
let previewFramePath;
try {
  const page = await browser.newPage();
  page.on("console", (m) => console.error("PAGE:", m.type(), m.text()));
  page.on("pageerror", (e) => console.error("PAGEERROR:", String(e)));
  await page.setViewport({ width: edit.output.width, height: edit.output.height, deviceScaleFactor: 1 });
  await page.goto(`${server.url}/preview.html`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.evaluate(() => window.__akariPreviewReady);
  // tick() が overlay を可視化して初めて threeRuntime.render() → createInstance() が走る
  // （mount() 自体はロードを始めない）。まず対象時刻で 1 回 tick してロードを起動し、
  // ready になるまで軽くポーリングしてから、同じ時刻でもう一度 tick して確実に描かせる
  await page.evaluate((t) => window.akari.runtime.tick(t, false), PARITY_TIME_SECONDS);
  await page.evaluate(async () => {
    const container = document.querySelector("#overlay-stage > div");
    for (let i = 0; i < 3000; i += 1) {
      const status = window.akari.threeRuntime.inspect(container).status;
      if (status === "ready") return;
      if (status === "error") throw new Error("preview scene failed to load");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("preview scene did not become ready in time");
  });
  await page.evaluate((t) => window.akari.runtime.tick(t, false), PARITY_TIME_SECONDS);
  // renderer.render() は WebGL バックバッファへ描くだけで、コンポジタが実際に画面へ反映する
  // (page.screenshot() が拾える状態になる) までにはペイントサイクルが要る。rasterize.mjs の
  // waitForPresentedFrameWithAnimationFrames と同じ流儀（rAF を 2 回挟んで提示を待つ）で、
  // tick() 直後に screenshot すると偶に前フレーム（空）を拾う実測不具合を避ける
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  previewFramePath = join(ARTIFACTS_DIR, "parity-preview.png");
  await page.screenshot({ path: previewFramePath, omitBackground: true });
} finally {
  await browser.close();
  await server.close();
}

// --- コンタクトシート（横並び） ---
const contactSheetPath = join(ARTIFACTS_DIR, "parity-contact-sheet.png");
const exportViewable = join(ARTIFACTS_DIR, "parity-export-viewable.png");
const previewViewable = join(ARTIFACTS_DIR, "parity-preview-viewable.png");
compositeOverBackground(exportFramePath, exportViewable);
compositeOverBackground(previewFramePath, previewViewable);
runChecked("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-i", exportViewable,
  "-i", previewViewable,
  "-filter_complex",
  "[0:v]pad=iw+8:ih+8:4:4:color=0x666666[left];"
  + "[1:v]pad=iw+8:ih+8:4:4:color=0x666666[right];"
  + "[left][right]hstack=inputs=2",
  "-frames:v", "1",
  contactSheetPath,
]);

// --- 画素差分（omitBackground:true の透過 PNG 同士、目視の裏取り） ---
const exportRgba = readRgba(exportFramePath);
const previewRgba = readRgba(previewFramePath);
let sumAbsDiff = 0;
let maxAbsDiff = 0;
for (let i = 0; i < exportRgba.length; i += 1) {
  const diff = Math.abs(exportRgba[i] - previewRgba[i]);
  sumAbsDiff += diff;
  if (diff > maxAbsDiff) maxAbsDiff = diff;
}

await rm(projectRoot, { recursive: true, force: true });

const result = {
  generated_at_note: "generated by evidence/3d-text-flat/parity.mjs",
  time_seconds: PARITY_TIME_SECONDS,
  exportFramePath,
  previewFramePath,
  contactSheetPath,
  pixelDiff: {
    bytes: exportRgba.length,
    meanAbsDiff: Number((sumAbsDiff / exportRgba.length).toFixed(6)),
    maxAbsDiff,
  },
};
await writeFile(join(ARTIFACTS_DIR, "parity-result.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));
