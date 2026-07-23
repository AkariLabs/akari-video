import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

import {
  captureWithPuppeteer,
  renderOverlaySheet,
} from "../../src/rasterize.mjs";

const chromePath = process.env.CHROME_PATH
  ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ffmpegCommand = process.env.FFMPEG_PATH ?? "ffmpeg";
const width = 640;
const height = 360;
const fps = 24;
const duration = 5;
const pageBenchmarkSamplesPerVariant = 200;
const trialOrder = ["legacy", "fixed", "fixed", "legacy", "legacy", "fixed"];
const priorFullProcessObservations = [
  {
    label: "Codex previous run",
    normalized_incremental_seek_regression_percent: 7.12,
    frame_loop_regression_percent: 5.97,
    capture_pipeline_total_regression_percent: -5.17,
  },
  {
    label: "wrapper round 2 independent run",
    normalized_incremental_seek_regression_percent: 40.87,
    frame_loop_regression_percent: 26.94,
    capture_pipeline_total_regression_percent: 7.09,
  },
];
const root = await mkdtemp(join(tmpdir(), "render-cut-seek-l2-"));
const singleProcessPuppeteer = {
  launch: (options) => puppeteer.launch({
    ...options,
    pipe: true,
    args: [...options.args, "--single-process", "--no-zygote"],
  }),
};

try {
  const fixturePath = join(root, "fixture.mp4");
  run(ffmpegCommand, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${width}x${height}:rate=${fps}:duration=${duration + 0.2}`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-g",
    "1",
    "-pix_fmt",
    "yuv420p",
    fixturePath,
  ]);

  const videoUrl = pathToFileURL(fixturePath).href;
  const overlay = {
    id: "video-fixture",
    start: 0,
    duration,
    html: `<video muted preload="auto" width="${width}" height="${height}" src="${videoUrl}"></video>`,
    transform: {},
    vars: {},
  };
  const edit = { output: { width, height, fps } };
  const fixedSheetPath = join(root, "fixed-sheet.html");
  await writeFile(
    fixedSheetPath,
    renderOverlaySheet({ overlays: [overlay], edit, projectRoot: root, duration }),
    "utf8",
  );
  const legacySheetPath = join(root, "legacy-sheet.html");
  await writeFile(
    legacySheetPath,
    renderLegacySheet({ videoUrl, width, height, fps, duration }),
    "utf8",
  );

  process.stderr.write("page-internal alternating seek benchmark started\n");
  const pageInternalBenchmark = await benchmarkPageInternal(fixedSheetPath);
  process.stderr.write("page-internal alternating seek benchmark finished\n");

  const runs = { legacy: [], fixed: [] };
  for (const variant of trialOrder) {
    const trial = runs[variant].length + 1;
    const sheetPath = variant === "fixed" ? fixedSheetPath : legacySheetPath;
    process.stderr.write(`capture ${variant}-${trial} started\n`);
    runs[variant].push(await capture(`${variant}-${trial}`, sheetPath));
    process.stderr.write(`capture ${variant}-${trial} finished\n`);
  }

  const referenceHashes = runs.fixed[0].hashes;
  const hashesMatch = runs.fixed.every((candidate) =>
    candidate.hashes.length === referenceHashes.length
      && candidate.hashes.every((hash, index) => hash === referenceHashes[index]));
  const warnings = runs.fixed.flatMap((candidate) => candidate.warnings);
  const legacyFrameLoopMedian = median(runs.legacy.map(({ metrics }) => metrics.frame_loop_ms));
  const fixedFrameLoopMedian = median(runs.fixed.map(({ metrics }) => metrics.frame_loop_ms));
  const frameLoopRegressionPercent = percentChange(
    legacyFrameLoopMedian,
    fixedFrameLoopMedian,
  );
  const legacySeekWaitMedian = median(runs.legacy.map(({ metrics }) => metrics.seek_wait_ms));
  const fixedSeekWaitMedian = median(runs.fixed.map(({ metrics }) => metrics.seek_wait_ms));
  const addedSeekWaitMilliseconds = fixedSeekWaitMedian - legacySeekWaitMedian;
  const normalizedIncrementalRegressionPercent =
    (addedSeekWaitMilliseconds / legacyFrameLoopMedian) * 100;
  const legacyTotalMedian = median(runs.legacy.map(({ metrics }) => metrics.total_ms));
  const fixedTotalMedian = median(runs.fixed.map(({ metrics }) => metrics.total_ms));
  const totalRegressionPercent = percentChange(legacyTotalMedian, fixedTotalMedian);
  const pageBenchmarkWarnings = pageInternalBenchmark.warnings;
  const crossRunFullProcessObservations = [
    ...priorFullProcessObservations,
    {
      label: "Codex final run",
      normalized_incremental_seek_regression_percent: round(
        normalizedIncrementalRegressionPercent,
      ),
      frame_loop_regression_percent: round(frameLoopRegressionPercent),
      capture_pipeline_total_regression_percent: round(totalRegressionPercent),
    },
  ];
  const acceptanceWithinTenPercent = crossRunFullProcessObservations.every(
    (observation) =>
      observation.frame_loop_regression_percent <= 10
      && observation.capture_pipeline_total_regression_percent <= 10,
  );
  const result = {
    generated_at: new Date().toISOString(),
    fixture: {
      generator: "ffmpeg testsrc2",
      codec: "libx264 all-intra",
      width,
      height,
      source_fps: fps,
      capture_fps: fps,
      duration_seconds: duration,
      frame_count: Math.ceil(duration * fps),
    },
    environment: {
      node: process.version,
      chrome_path: chromePath,
      ffmpeg: ffmpegCommand,
      browser_launch_note:
        "Puppeteer pipe transport with Chromium single-process mode is used because the task sandbox denies normal macOS Mach rendezvous and TCP DevTools binding.",
    },
    methodology: {
      primary_sample_count_per_variant: pageBenchmarkSamplesPerVariant,
      primary_warmup_count_per_variant: 20,
      trial_count_per_variant: 3,
      interleaved_trial_order: trialOrder,
      primary_metric:
        "Inside one already-running browser and one already-loaded page/video, fixed production __akariSeek and a legacy-equivalent immediate-return seek are alternated. Each duration is measured by performance.now() inside page.evaluate; browser launch and Node/browser IPC are outside the sample.",
      secondary_metric:
        "Observed captureWithPuppeteer stage and total wall times. Total includes Chrome launch, page setup, 120-frame loop, browser close, and qtrle encode. These are retained as noisy diagnostics.",
      rationale:
        "The page-internal alternation isolates the irreducible rVFC presentation wait. The full-process runs preserve representative pipeline evidence but cannot be a stable primary metric in this single-process sandbox.",
    },
    deterministic_result: {
      pass: hashesMatch,
      compared_fixed_runs: runs.fixed.length,
      frame_count: referenceHashes.length,
      fixed_run_sha256: runs.fixed.map(({ hashes }) => hashes),
      warnings,
    },
    performance: {
      primary_page_internal_alternating_seek: pageInternalBenchmark.summary,
      primary_page_internal_samples_ms: {
        legacy: pageInternalBenchmark.samples.legacy,
        fixed: pageInternalBenchmark.samples.fixed,
      },
      primary_page_internal_warnings: pageBenchmarkWarnings,
      trials: {
        legacy: runs.legacy.map(({ metrics }) => metrics),
        fixed: runs.fixed.map(({ metrics }) => metrics),
      },
      primary_normalized_incremental_seek_overhead: {
        legacy_frame_loop_median_ms: legacyFrameLoopMedian,
        legacy_seek_wait_median_ms: legacySeekWaitMedian,
        fixed_seek_wait_median_ms: fixedSeekWaitMedian,
        added_seek_wait_ms: roundMilliseconds(addedSeekWaitMilliseconds),
        added_seek_wait_per_frame_ms: roundMilliseconds(
          addedSeekWaitMilliseconds / Math.ceil(duration * fps),
        ),
        regression_percent: round(normalizedIncrementalRegressionPercent),
        within_ten_percent: normalizedIncrementalRegressionPercent <= 10,
      },
      observed_frame_loop_diagnostic: {
        legacy_median_ms: legacyFrameLoopMedian,
        fixed_median_ms: fixedFrameLoopMedian,
        regression_percent: round(frameLoopRegressionPercent),
        within_ten_percent: frameLoopRegressionPercent <= 10,
        note:
          "Direct wall time is reported honestly but is visibly host-load-sensitive; use the separately timed incremental seek overhead for the acceptance verdict.",
      },
      secondary_capture_pipeline_total: {
        legacy_median_ms: legacyTotalMedian,
        fixed_median_ms: fixedTotalMedian,
        regression_percent: round(totalRegressionPercent),
        within_ten_percent: totalRegressionPercent <= 10,
        scope:
          "The real Puppeteer fallback rasterization path through MOV encoding. rasterizeAndComposite adds the same alpha probe and FFmpeg compositing after this point for both variants.",
      },
      startup_noise: {
        legacy_browser_launch_ms: runs.legacy.map(({ metrics }) => metrics.browser_launch_ms),
        fixed_browser_launch_ms: runs.fixed.map(({ metrics }) => metrics.browser_launch_ms),
      },
      cross_run_full_process_observations: crossRunFullProcessObservations,
    },
    acceptance: {
      requirement: "render duration regression should remain approximately within 10 percent",
      verdict: "not_met",
      within_ten_percent: acceptanceWithinTenPercent,
      reason:
        "The low-noise primary benchmark proves an irreducible presentation wait and the representative full-process/frame-loop measurements are not repeatably within 10 percent across independent runs. Correctness is deterministic, but the performance threshold cannot be claimed.",
      tradeoff:
        "Removing the rVFC wait would recover legacy speed by returning before the target video frame is presented, reintroducing stale-frame nondeterminism.",
    },
    before_reproduction: {
      attempted: false,
      note:
        "The wrapper independently reproduced the original stale-frame risk and verified the prior fixed hashes; this rerun focuses on deterministic output and corrected performance methodology.",
    },
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  await writeFile(new URL("./l2-result.json", import.meta.url), serialized, "utf8");
  process.stdout.write(serialized);
  if (
    !hashesMatch
    || warnings.length > 0
    || pageBenchmarkWarnings.length > 0
    || !acceptanceWithinTenPercent
  ) {
    process.exitCode = 1;
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

async function benchmarkPageInternal(sheetPath) {
  const samples = { legacy: [], fixed: [] };
  const warnings = [];
  let browser = null;
  try {
    browser = await singleProcessPuppeteer.launch({
      executablePath: chromePath,
      headless: true,
      timeout: 60_000,
      userDataDir: join(root, "page-benchmark-profile"),
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--enable-unsafe-swiftshader",
        "--use-angle=swiftshader",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(60_000);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(sheetPath).href, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    await page.evaluate(() => window.__akariReady);
    await page.evaluate(() => {
      window.__fixedSeekForBenchmark = window.__akariSeek;
      window.__legacySeekForBenchmark = async function(seconds) {
        for (const video of document.querySelectorAll("video")) {
          try {
            video.pause();
            video.currentTime = seconds;
          } catch {}
        }
        await Promise.resolve();
        return { warnings: [] };
      };
    });

    let targetIndex = 1;
    const measure = async (variant, record) => {
      const seconds = (targetIndex % Math.ceil(duration * fps)) / fps;
      targetIndex += 1;
      const observation = await page.evaluate(async ({ selectedVariant, targetSeconds }) => {
        const seek = selectedVariant === "fixed"
          ? window.__fixedSeekForBenchmark
          : window.__legacySeekForBenchmark;
        const started = performance.now();
        const result = await seek(targetSeconds);
        return {
          elapsed_ms: performance.now() - started,
          warnings: result?.warnings ?? [],
        };
      }, { selectedVariant: variant, targetSeconds: seconds });
      if (record) samples[variant].push(roundMilliseconds(observation.elapsed_ms));
      for (const warning of observation.warnings) {
        warnings.push(`${variant} at ${seconds}s: ${warning}`);
      }
      const settled = await page.evaluate(async () => {
        const states = await Promise.all(Array.from(document.querySelectorAll("video")).map(
          (video) => {
            if (!video.seeking) return Promise.resolve(true);
            return new Promise((resolve) => {
              let timeout = null;
              const finish = (value) => {
                video.removeEventListener("seeked", onSeeked);
                video.removeEventListener("error", onError);
                if (timeout !== null) clearTimeout(timeout);
                resolve(value);
              };
              const onSeeked = () => finish(true);
              const onError = () => finish(true);
              video.addEventListener("seeked", onSeeked, { once: true });
              video.addEventListener("error", onError, { once: true });
              timeout = setTimeout(() => finish(false), 5000);
            });
          },
        ));
        return states.every(Boolean);
      });
      if (!settled) warnings.push(`${variant} at ${seconds}s: settle timeout`);
    };

    for (let index = 0; index < 20; index += 1) {
      const order = index % 2 === 0 ? ["fixed", "legacy"] : ["legacy", "fixed"];
      for (const variant of order) await measure(variant, false);
    }
    for (let index = 0; index < pageBenchmarkSamplesPerVariant; index += 1) {
      const order = index % 2 === 0 ? ["fixed", "legacy"] : ["legacy", "fixed"];
      for (const variant of order) await measure(variant, true);
    }
  } finally {
    await browser?.close();
  }

  const legacyMedian = median(samples.legacy);
  const fixedMedian = median(samples.fixed);
  const legacyMean = mean(samples.legacy);
  const fixedMean = mean(samples.fixed);
  return {
    samples,
    warnings,
    summary: {
      sample_count_per_variant: pageBenchmarkSamplesPerVariant,
      clock: "window.performance.now() inside page.evaluate",
      legacy_median_ms: roundMilliseconds(legacyMedian),
      fixed_median_ms: roundMilliseconds(fixedMedian),
      added_median_ms: roundMilliseconds(fixedMedian - legacyMedian),
      legacy_mean_ms: roundMilliseconds(legacyMean),
      fixed_mean_ms: roundMilliseconds(fixedMean),
      added_mean_ms: roundMilliseconds(fixedMean - legacyMean),
      fixed_p95_ms: roundMilliseconds(percentile(samples.fixed, 0.95)),
      fixed_max_ms: roundMilliseconds(Math.max(...samples.fixed)),
      fixed_mean_to_median_ratio: round(fixedMean / fixedMedian),
      fixed_vs_legacy_percent: legacyMedian === 0
        ? null
        : round(percentChange(legacyMedian, fixedMedian)),
      within_ten_percent: false,
      interpretation:
        "The fixed path intentionally waits for one presented video frame while legacy returns almost immediately. The absolute added latency is meaningful; the percentage ratio to a near-zero legacy median is not a useful total-render estimate.",
    },
  };
}

async function capture(label, sheetPath) {
  const framesDirectory = join(root, label);
  const warnings = [];
  let metrics = null;
  await captureWithPuppeteer({
    sheetPath,
    chromePath,
    framesDirectory,
    overlayMovPath: join(root, `${label}.mov`),
    width,
    height,
    fps,
    duration,
    ffmpegCommand,
    timeoutMs: 60_000,
    puppeteerModule: singleProcessPuppeteer,
    onWarning: (warning) => warnings.push(warning),
    onMetrics: (value) => {
      metrics = value;
    },
  });
  const frameNames = (await readdir(framesDirectory))
    .filter((name) => /^frame-\d+\.png$/u.test(name))
    .sort();
  const hashes = await Promise.all(
    frameNames.map(async (name) =>
      createHash("sha256").update(await readFile(join(framesDirectory, name))).digest("hex")),
  );
  return { hashes, metrics, warnings };
}

function renderLegacySheet({ videoUrl, width, height, fps, duration }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}</style>
</head>
<body>
  <video muted preload="auto" width="${width}" height="${height}" src="${videoUrl}"></video>
  <div data-fps="${fps}" data-duration="${duration}"></div>
  <script>
    window.__akariSeek = async function(seconds) {
      for (const video of document.querySelectorAll('video')) {
        try { video.pause(); video.currentTime = seconds; } catch {}
      }
      await Promise.resolve();
      return { warnings: [] };
    };
    window.__akariReady = (async function() {
      await document.fonts.ready;
      await Promise.all(Array.from(document.querySelectorAll('video')).map((video) =>
        video.readyState >= 2
          ? Promise.resolve()
          : new Promise((resolve) => {
              video.addEventListener('loadeddata', resolve, { once: true });
              video.addEventListener('error', resolve, { once: true });
            })
      ));
      await window.__akariSeek(0);
      return true;
    })();
  </script>
</body>
</html>`;
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function percentChange(baseline, candidate) {
  return ((candidate - baseline) / baseline) * 100;
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values, quantile) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * quantile) - 1),
  )];
}

function round(value) {
  return Number(value.toFixed(2));
}

function roundMilliseconds(value) {
  return Number(value.toFixed(3));
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
}
