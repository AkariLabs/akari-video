import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { captureWithPuppeteer, renderOverlaySheet } from "../../src/rasterize.mjs";
import { resolveCaptureWorkers } from "../../src/render-cut.mjs";
import {
  editFor,
  loadPuppeteerModule,
  makeProjectRoot,
  overlayFor,
  resolveChromePath,
} from "../3d-text-extrude/support/fixtures.mjs";
import { carouselScene } from "../3d-text-extrude/support/scenes.mjs";
import { compareCaptureOutputs } from "./compare-sha256.mjs";

const WORKERS = [1, 2, 4];
const DURATION_SECONDS = 2;

export async function runThreeDimensionalBenchmark({ resultPath } = {}) {
  const projectRoot = await makeProjectRoot("capture-workers");
  const workRoot = await mkdtemp(join(tmpdir(), "render-cut-capture-workers-3d-"));
  try {
    const edit = editFor({ width: 1280, height: 720, fps: 30 });
    const overlay = overlayFor("carousel", carouselScene(), {
      start: 0,
      duration: DURATION_SECONDS,
    });
    const sheetPath = join(projectRoot, "overlay-sheet.html");
    await writeFile(
      sheetPath,
      renderOverlaySheet({
        overlays: [overlay],
        edit,
        projectRoot,
        duration: DURATION_SECONDS,
      }),
      "utf8",
    );
    const puppeteerModule = await loadPuppeteerModule();
    const chromePath = await resolveChromePath();
    const ffmpegCommand = process.env.FFMPEG_PATH
      ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg");
    const singleProcess = process.env.AKARI_CAPTURE_SINGLE_PROCESS === "1";
    const runs = [];
    for (const workers of WORKERS) {
      const runDirectory = join(workRoot, `workers-${workers}`);
      const framesDirectory = join(runDirectory, "frames");
      await mkdir(framesDirectory, { recursive: true });
      let metrics = null;
      await captureWithPuppeteer({
        sheetPath,
        chromePath,
        framesDirectory,
        overlayMovPath: join(runDirectory, "overlay.mov"),
        width: edit.output.width,
        height: edit.output.height,
        fps: edit.output.fps,
        duration: DURATION_SECONDS,
        workers,
        ffmpegCommand,
        puppeteerModule,
        ...(singleProcess ? { browserLauncher: launchPipeBrowser } : {}),
        onMetrics: (value) => { metrics = value; },
      });
      runs.push({ workers, metrics });
    }
    const equivalence = await compareCaptureOutputs(
      join(workRoot, "workers-1"),
      join(workRoot, "workers-4"),
    );
    const result = {
      schema: "akari-render-cut-capture-workers-3d-benchmark-v1",
      fixture: {
        source: "3d-text-extrude carouselScene",
        width: edit.output.width,
        height: edit.output.height,
        fps: edit.output.fps,
        duration_seconds: DURATION_SECONDS,
      },
      automatic_resolution: resolveCaptureWorkers({
        hasThreeDimensionalOverlay: true,
        parallelism: 8,
      }),
      single_process_browser: singleProcess,
      runs,
      equivalence,
    };
    if (resultPath) {
      await writeFile(resolve(resultPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    }
    return result;
  } finally {
    await Promise.all([
      rm(projectRoot, { recursive: true, force: true }),
      rm(workRoot, { recursive: true, force: true }),
    ]);
  }
}

async function launchPipeBrowser(options) {
  await mkdir(options.profileParent, { recursive: true });
  const userDataDir = await mkdtemp(join(options.profileParent, options.profilePrefix));
  const browser = await options.puppeteer.launch({
    executablePath: options.chromePath,
    headless: true,
    pipe: true,
    timeout: options.timeoutMs,
    userDataDir,
    args: [...options.args, "--single-process", "--no-zygote"],
  });
  let closed = false;
  return {
    browser,
    userDataDir,
    async close({ force = false } = {}) {
      if (closed) return;
      closed = true;
      const child = browser.process?.();
      await browser.close().catch(() => {});
      if (force && child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

async function isMainModule() {
  if (!process.argv[1]) return false;
  const [entryPath, modulePath] = await Promise.all([
    realpath(process.argv[1]).catch(() => null),
    realpath(fileURLToPath(import.meta.url)).catch(() => null),
  ]);
  return entryPath !== null && entryPath === modulePath;
}

if (await isMainModule()) {
  const resultFlag = process.argv.indexOf("--result");
  const result = await runThreeDimensionalBenchmark({
    resultPath: resultFlag === -1 ? undefined : process.argv[resultFlag + 1],
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.equivalence.png_all_match || !result.equivalence.overlay_mov.matches) {
    process.exitCode = 1;
  }
}
