import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import puppeteer from "puppeteer-core";

import { launchBrowser } from "../../src/browser-launch.mjs";
import { findChromePath } from "../../src/render-cut.mjs";
import { splitFrameRanges } from "../../src/rasterize.mjs";
import { FIXTURE, generateFixture } from "./generate-fixture.mjs";

const PROBE_DURATION_SECONDS = 4;
const CAPTURE_ARGS = [
  "--no-sandbox",
  "--disable-gpu",
  "--enable-unsafe-swiftshader",
  "--use-angle=swiftshader",
  "--disable-dev-shm-usage",
  "--no-first-run",
  "--no-default-browser-check",
];
const MODES = [
  { mode: "one-browser-1-page", browsers: 1, pagesPerBrowser: 1 },
  { mode: "one-browser-4-pages", browsers: 1, pagesPerBrowser: 4 },
  { mode: "four-browsers", browsers: 4, pagesPerBrowser: 1 },
];

export async function probePageMode({ resultPath } = {}) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-capture-page-mode-"));
  try {
    const fixture = await generateFixture(join(root, "fixture"));
    const chromePath = await findChromePath();
    if (!chromePath) throw new Error("Chrome executable was not found");
    const singleProcess = process.env.AKARI_CAPTURE_SINGLE_PROCESS === "1";
    const modes = [];
    for (const mode of MODES) {
      modes.push({
        mode: mode.mode,
        browsers: mode.browsers,
        pages_per_browser: mode.pagesPerBrowser,
        frame_loop_ms: await runMode({
          ...mode,
          root,
          fixture,
          chromePath,
          singleProcess,
        }),
      });
    }
    const baseline = modes[0].frame_loop_ms;
    for (const mode of modes.slice(1)) {
      mode.speedup_vs_one_page = round(baseline / mode.frame_loop_ms);
    }
    const pageMode = modes.find((mode) => mode.mode === "one-browser-4-pages");
    const browserMode = modes.find((mode) => mode.mode === "four-browsers");
    const result = {
      schema: "akari-render-cut-capture-page-mode-probe-v2",
      duration_seconds: PROBE_DURATION_SECONDS,
      frame_count: PROBE_DURATION_SECONDS * FIXTURE.fps,
      output: { width: FIXTURE.width, height: FIXTURE.height, fps: FIXTURE.fps },
      single_process_browser: singleProcess,
      runs: [{
        label: "probe",
        uptime: spawnSync("uptime", [], { encoding: "utf8" }).stdout?.trim() ?? null,
        modes,
      }],
      one_browser_four_pages_meets_two_times_speedup: pageMode.frame_loop_ms <= baseline / 2,
      four_browsers_meets_three_times_speedup: browserMode.frame_loop_ms <= baseline / 3,
      conclusion: "Compare production multi-process results before selecting a concurrency model; "
        + "a single-process fallback cannot test renderer-process distribution.",
    };
    if (resultPath) {
      await writeFile(resolve(resultPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    }
    return result;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runMode({ browsers, pagesPerBrowser, root, fixture, chromePath, singleProcess }) {
  const sessions = Array.from({ length: browsers }, () => null);
  try {
    await Promise.all(sessions.map(async (_session, index) => {
      sessions[index] = singleProcess
        ? await launchPipeBrowser({ puppeteer, chromePath, root, index })
        : await launchBrowser({
            puppeteer,
            chromePath,
            profileParent: root,
            profilePrefix: `page-mode-profile-${index + 1}-`,
            failureMarkerPath: join(root, `.browser-launch-failed-${index + 1}`),
            timeoutMs: 60_000,
            args: CAPTURE_ARGS,
          });
    }));
    const pageCount = browsers * pagesPerBrowser;
    const pages = await Promise.all(Array.from({ length: pageCount }, async (_, index) => {
      const sessionIndex = browsers === 1 ? 0 : index;
      const page = await sessions[sessionIndex].browser.newPage();
      await page.setViewport({
        width: FIXTURE.width,
        height: FIXTURE.height,
        deviceScaleFactor: 1,
      });
      await page.goto(pathToFileURL(fixture.sheetPath).href, { waitUntil: "networkidle0" });
      await page.evaluate(() => window.__akariReady);
      return page;
    }));
    const frameCount = PROBE_DURATION_SECONDS * FIXTURE.fps;
    const ranges = splitFrameRanges(frameCount, pageCount);
    const started = performance.now();
    await Promise.all(ranges.map(async ([start, end], index) => {
      await warmActiveOverlays(pages[index], start, FIXTURE.fps);
      for (let frame = start; frame < end; frame += 1) {
        await pages[index].evaluate(
          (seconds) => window.__akariSeek(seconds),
          frame / FIXTURE.fps,
        );
        await pages[index].screenshot({ omitBackground: true });
      }
    }));
    return round(performance.now() - started);
  } finally {
    await Promise.all(sessions.map((session) => session?.close({ force: false })));
  }
}

async function warmActiveOverlays(page, startFrame, fps) {
  if (startFrame === 0) return;
  const startSeconds = startFrame / fps;
  const times = await page.evaluate((boundary, frameRate) => {
    const values = new Set();
    for (const container of document.querySelectorAll('.akari-overlay-container')) {
      const start = Number(container.dataset.start);
      const duration = Number(container.dataset.duration);
      if (!(start < boundary && boundary < start + duration)) continue;
      values.add(start);
      const secondFrame = start + 1 / frameRate;
      if (secondFrame < boundary && secondFrame < start + duration) values.add(secondFrame);
    }
    return [...values].sort((left, right) => left - right);
  }, startSeconds, fps);
  for (const seconds of times) {
    await page.evaluate((value) => window.__akariSeek(value), seconds);
    await page.screenshot({ omitBackground: true });
  }
}

async function launchPipeBrowser({ puppeteer: module, chromePath, root, index }) {
  const profileParent = join(root, "pipe-profiles");
  await mkdir(profileParent, { recursive: true });
  const userDataDir = await mkdtemp(join(profileParent, `page-mode-profile-${index + 1}-`));
  try {
    const browser = await module.launch({
      executablePath: chromePath,
      headless: true,
      pipe: true,
      timeout: 60_000,
      userDataDir,
      args: [...CAPTURE_ARGS, "--single-process", "--no-zygote"],
    });
    let closed = false;
    return {
      browser,
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
  } catch (error) {
    await rm(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

function round(value) {
  return Number(value.toFixed(4));
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
  const result = await probePageMode({
    resultPath: resultFlag === -1 ? undefined : process.argv[resultFlag + 1],
  });
  console.log(JSON.stringify(result, null, 2));
}
