// 決定論（同一入力 2 回書き出し → 全フレーム SHA-256 一致）+
// シーク安全（ランダム順 render(t) と昇順 render(t) の同時刻スクリーンショット一致）を
// 1 本のスクリプトで実測する。契約 §4-2 / §4-3、様式は
// packages/render-cut/evidence/rasterize-seek-fix/l2-determinism.mjs を参考にした。
//
// シーン: cylinder レイアウト + carousel プリセットの「アカリビデオ」筒テロップ
// （このシーンは golden.mjs の「裏面鏡文字」証跡にも使う）。
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { captureWithPuppeteer, renderOverlaySheet } from "../../src/rasterize.mjs";
import {
  compositeOverBackground,
  editFor,
  loadPuppeteerModule,
  makeProjectRoot,
  overlayFor,
  resolveChromePath,
  sha256File,
} from "./lib/fixtures.mjs";
import { cylinderScene } from "./lib/scenes.mjs";

const ARTIFACTS_DIR = join(new URL(".", import.meta.url).pathname, "artifacts");

const edit = editFor({ width: 480, height: 270, fps: 10 });
const DURATION = 2.4; // 24 frames @ 10fps
const FRAME_COUNT = Math.round(DURATION * edit.output.fps);

async function runDeterminism() {
  const results = [];
  for (const run of [1, 2]) {
    const projectRoot = await makeProjectRoot(`determinism-${run}`);
    const workDir = join(projectRoot, "work");
    await mkdir(workDir, { recursive: true });
    const overlay = overlayFor("ring", cylinderScene(), { start: 0, duration: DURATION });
    const sheetPath = join(workDir, "sheet.html");
    await writeFile(
      sheetPath,
      renderOverlaySheet({ overlays: [overlay], edit, projectRoot, duration: DURATION }),
      "utf8",
    );
    const puppeteerModule = await loadPuppeteerModule();
    const chromePath = await resolveChromePath();
    const framesDirectory = join(workDir, "frames");
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
    const frameFiles = (await readdir(framesDirectory)).filter((f) => f.endsWith(".png")).sort();
    const hashes = [];
    for (const file of frameFiles) hashes.push(await sha256File(join(framesDirectory, file)));
    if (run === 1) {
      await mkdir(ARTIFACTS_DIR, { recursive: true });
      const midFramePath = join(framesDirectory, frameFiles[Math.floor(frameFiles.length / 2)]);
      await copyFile(midFramePath, join(ARTIFACTS_DIR, "determinism-run1-mid-frame.png"));
      compositeOverBackground(
        midFramePath,
        join(ARTIFACTS_DIR, "determinism-run1-mid-frame-viewable.png"),
      );
    }
    results.push({ run, frameCount: frameFiles.length, hashes });
    await rm(projectRoot, { recursive: true, force: true });
  }
  const [first, second] = results;
  const allMatch = first.frameCount === second.frameCount
    && first.hashes.every((hash, index) => hash === second.hashes[index]);
  return {
    frameCount: first.frameCount,
    run1Hashes: first.hashes,
    run2Hashes: second.hashes,
    allFramesMatch: allMatch,
  };
}

async function runSeekSafety() {
  const projectRoot = await makeProjectRoot("seek-safety");
  const workDir = join(projectRoot, "work");
  await mkdir(workDir, { recursive: true });
  const overlay = overlayFor("ring", cylinderScene(), { start: 0, duration: DURATION });
  const sheetPath = join(workDir, "sheet.html");
  await writeFile(
    sheetPath,
    renderOverlaySheet({ overlays: [overlay], edit, projectRoot, duration: DURATION }),
    "utf8",
  );

  const puppeteerModule = await loadPuppeteerModule();
  const puppeteer = puppeteerModule.default ?? puppeteerModule;
  const chromePath = await resolveChromePath();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
      "--disable-dev-shm-usage",
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: edit.output.width, height: edit.output.height, deviceScaleFactor: 1 });
    // 埋め込みフォント（base64 数 MB）+ three バンドルの解析があるため既定 30000ms より余裕を持たせる
    await page.goto(pathToFileURL(sheetPath).href, { waitUntil: "networkidle0", timeout: 60000 });
    await page.evaluate(() => window.__akariReady);

    const times = Array.from({ length: FRAME_COUNT }, (_, index) => index / edit.output.fps);
    // 手作業で決めた固定シャッフル順（Math.random は使わない — 決定論の検証自体は
    // 「毎回同じ乱数」に依存させない。同じ time 集合を訪れる順序だけを変える）
    const shuffledOrder = [12, 3, 20, 7, 0, 17, 9, 23, 5, 14, 2, 19, 11, 6, 22, 1, 16, 8, 21, 4, 13, 10, 18, 15]
      .filter((index) => index < times.length);

    async function captureAt(second) {
      await page.evaluate((s) => window.__akariSeek(s), second);
      const base64 = await page.screenshot({ encoding: "base64", omitBackground: true });
      return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
    }

    const ascendingHashes = [];
    for (const t of times) ascendingHashes.push(await captureAt(t));

    const shuffledHashesByTimeIndex = new Array(times.length);
    for (const timeIndex of shuffledOrder) {
      shuffledHashesByTimeIndex[timeIndex] = await captureAt(times[timeIndex]);
    }

    const perTimeMatch = times.map((t, index) => ({
      t: Number(t.toFixed(4)),
      ascending: ascendingHashes[index],
      shuffled: shuffledHashesByTimeIndex[index],
      match: ascendingHashes[index] === shuffledHashesByTimeIndex[index],
    }));
    return {
      timeCount: times.length,
      shuffledOrder,
      allTimesMatch: perTimeMatch.every((entry) => entry.match),
      perTimeMatch,
    };
  } finally {
    await browser.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
}

const determinism = await runDeterminism();
const seekSafety = await runSeekSafety();

const result = {
  generated_at_note: "generated by evidence/3d-text-flat/determinism-seek.mjs",
  scene: "cylinder carousel (texts[] flat, id=ring, アカリビデオ)",
  output: edit.output,
  duration_seconds: DURATION,
  determinism,
  seekSafety,
};

await mkdir(ARTIFACTS_DIR, { recursive: true });
await writeFile(
  join(ARTIFACTS_DIR, "determinism-seek-result.json"),
  JSON.stringify(result, null, 2),
  "utf8",
);
console.log(JSON.stringify({
  frameCount: determinism.frameCount,
  allFramesMatch: determinism.allFramesMatch,
  timeCount: seekSafety.timeCount,
  allTimesMatch: seekSafety.allTimesMatch,
}, null, 2));
