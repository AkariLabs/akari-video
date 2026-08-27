import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { availableParallelism, homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findChromePath } from "../../src/render-cut.mjs";
import { captureWithPuppeteer, overlayFrameCount } from "../../src/rasterize.mjs";
import { compareCaptureOutputs } from "./compare-sha256.mjs";
import { FIXTURE, generateFixture } from "./generate-fixture.mjs";

const WORKER_COUNTS = [1, 2, 4];

export async function runBenchmark({
  workDirectory,
  resultPath,
  keep = false,
  durationSeconds = FIXTURE.durationSeconds,
} = {}) {
  const ownsWorkDirectory = workDirectory === undefined;
  const workRoot = workDirectory
    ? resolve(workDirectory)
    : await mkdtemp(join(tmpdir(), "render-cut-capture-workers-"));
  await mkdir(workRoot, { recursive: true });
  const fixture = await generateFixture(join(workRoot, "fixture"));
  const chromePath = await findChromePath();
  if (!chromePath) throw new Error("Chrome executable was not found");
  const ffmpegCommand = process.env.FFMPEG_PATH
    ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg");
  const singleProcess = process.env.AKARI_CAPTURE_SINGLE_PROCESS === "1";
  const runs = [];
  try {
    for (const workers of WORKER_COUNTS) {
      const runDirectory = join(workRoot, `workers-${workers}`);
      const framesDirectory = join(runDirectory, "frames");
      await mkdir(framesDirectory, { recursive: true });
      let metrics = null;
      const singleProcessPeakBytes = [];
      const memory = startChromeRssSampler(framesDirectory);
      let memoryResult;
      try {
        await captureWithPuppeteer({
          sheetPath: fixture.sheetPath,
          chromePath,
          framesDirectory,
          overlayMovPath: join(runDirectory, "overlay.mov"),
          width: FIXTURE.width,
          height: FIXTURE.height,
          fps: FIXTURE.fps,
          duration: durationSeconds,
          workers,
          ffmpegCommand,
          ...(singleProcess
            ? { browserLauncher: createSingleProcessBrowserLauncher(singleProcessPeakBytes) }
            : {}),
          onMetrics: (value) => { metrics = value; },
        });
      } finally {
        memoryResult = memory.stop();
      }
      if (singleProcessPeakBytes.length > 0) {
        memoryResult.peakBytes = Math.max(
          memoryResult.peakBytes,
          singleProcessPeakBytes.reduce((total, bytes) => total + bytes, 0),
        );
      }
      const frameCount = overlayFrameCount(durationSeconds, FIXTURE.fps);
      runs.push({
        workers,
        frame_count: frameCount,
        frame_loop_ms: metrics.frame_loop_ms,
        total_ms: metrics.total_ms,
        real_time_ratio: round(metrics.total_ms / (durationSeconds * 1000)),
        frame_loop_ms_per_frame: round(metrics.frame_loop_ms / frameCount),
        peak_chrome_rss_bytes: memoryResult.peakBytes || null,
        rss_samples: memoryResult.samples,
        metrics,
      });
    }
    const equivalence = await compareCaptureOutputs(
      join(workRoot, "workers-1"),
      join(workRoot, "workers-4"),
    );
    const workersOne = runs.find((run) => run.workers === 1);
    const workersFour = runs.find((run) => run.workers === 4);
    const result = {
      schema: "akari-render-cut-capture-workers-benchmark-v1",
      fixture: FIXTURE,
      measured_duration_seconds: durationSeconds,
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        available_parallelism: availableParallelism(),
        chrome_path: redactHome(chromePath),
        ffmpeg_command: ffmpegCommand,
        single_process_browser: singleProcess,
        uptime: spawnSync("uptime", [], { encoding: "utf8" }).stdout?.trim() ?? null,
      },
      method: "one-browser-per-worker",
      runs,
      equivalence,
      acceptance: {
        png_all_match: equivalence.png_all_match,
        overlay_mov_matches: equivalence.overlay_mov.matches,
        workers_4_frame_loop_at_most_one_third: workersFour.frame_loop_ms
          <= workersOne.frame_loop_ms / 3,
        workers_4_to_1_frame_loop_ratio: round(
          workersFour.frame_loop_ms / workersOne.frame_loop_ms,
        ),
      },
    };
    if (resultPath) {
      await writeFile(resolve(resultPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    }
    return result;
  } finally {
    if (ownsWorkDirectory && !keep) {
      await rm(workRoot, { recursive: true, force: true });
    }
  }
}

function createSingleProcessBrowserLauncher(resourcePeaks) {
  return (options) => launchSingleProcessBrowser(options, resourcePeaks);
}

async function launchSingleProcessBrowser(options, resourcePeaks) {
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
      const resourceUsage = child?.resourceUsage?.();
      if (Number.isFinite(resourceUsage?.maxRSS)) {
        resourcePeaks.push(resourceUsage.maxRSS * 1024);
      }
      if (force && child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

function startChromeRssSampler(profileParent) {
  let peakBytes = 0;
  let samples = 0;
  const sample = () => {
    const bytes = chromeTreeRssBytes(profileParent);
    if (bytes > 0) samples += 1;
    peakBytes = Math.max(peakBytes, bytes);
  };
  sample();
  const timer = setInterval(sample, 250);
  return {
    stop() {
      clearInterval(timer);
      sample();
      return { peakBytes, samples };
    },
  };
}

function chromeTreeRssBytes(marker) {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,rss=,command="], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) return 0;
  const processes = result.stdout.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u);
    return match ? [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssKiB: Number(match[3]),
      command: match[4],
    }] : [];
  });
  const selected = new Set(
    processes.filter((process) => process.command.includes(marker)).map((process) => process.pid),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (!selected.has(process.pid) && selected.has(process.ppid)) {
        selected.add(process.pid);
        changed = true;
      }
    }
  }
  return processes
    .filter((process) => selected.has(process.pid))
    .reduce((total, process) => total + process.rssKiB * 1024, 0);
}

function round(value) {
  return Number(value.toFixed(4));
}

function redactHome(path) {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`)
    ? `~${path.slice(home.length)}`
    : path;
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
  const args = process.argv.slice(2);
  const valueAfter = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const result = await runBenchmark({
    workDirectory: valueAfter("--work"),
    resultPath: valueAfter("--result"),
    keep: args.includes("--keep"),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!Object.values(result.acceptance).every((value) => value === true || typeof value === "number")) {
    process.exitCode = 1;
  }
}
