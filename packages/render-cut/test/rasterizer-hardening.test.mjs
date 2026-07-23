import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  addRasterizerDowngradeWarning,
  chromePathCandidates,
  ffmpegInstallHint,
  findChromePath,
  rasterizeAndComposite,
  resolvePuppeteerPackagePath,
} from "../src/render-cut.mjs";
import { captureWithPuppeteer } from "../src/rasterize.mjs";
import { renderReport } from "../src/report.mjs";

test("Chrome candidate priority is env, newest Playwright headless shell, then system Chrome", async () => {
  const homeDirectory = await mkdtemp(join(tmpdir(), "render-cut-chrome-candidates-"));
  try {
    const older = join(
      homeDirectory,
      "Library/Caches/ms-playwright/chromium_headless_shell-1000/chrome-headless-shell-mac-arm64/chrome-headless-shell",
    );
    const newest = join(
      homeDirectory,
      "Library/Caches/ms-playwright/chromium_headless_shell-2000/chrome-headless-shell-mac-arm64/chrome-headless-shell",
    );
    await mkdir(join(older, ".."), { recursive: true });
    await mkdir(join(newest, ".."), { recursive: true });
    const envChrome = "/test/env/chrome";
    const systemChrome = "/test/system/chrome";
    const executable = async (candidate) => [envChrome, newest, systemChrome].includes(candidate);

    assert.equal(await findChromePath({
      env: { CHROME_PATH: envChrome },
      homeDirectory,
      platform: "darwin",
      systemCandidates: [systemChrome],
      executable,
    }), envChrome);
    assert.equal(await findChromePath({
      env: {},
      homeDirectory,
      platform: "darwin",
      systemCandidates: [systemChrome],
      executable,
    }), newest);
    assert.notEqual(newest, older);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("Chrome candidate priority on win32 mirrors darwin: env, newest Playwright headless shell, then system Chrome", async () => {
  const homeDirectory = await mkdtemp(join(tmpdir(), "render-cut-chrome-candidates-win32-"));
  try {
    const localAppData = join(homeDirectory, "AppData", "Local");
    const older = join(
      localAppData,
      "ms-playwright/chromium_headless_shell-1000/chrome-headless-shell-win64/chrome-headless-shell.exe",
    );
    const newest = join(
      localAppData,
      "ms-playwright/chromium_headless_shell-2000/chrome-headless-shell-win64/chrome-headless-shell.exe",
    );
    await mkdir(join(older, ".."), { recursive: true });
    await mkdir(join(newest, ".."), { recursive: true });
    const envChrome = "C:\\test\\env\\chrome.exe";
    const systemChrome = "C:\\test\\system\\chrome.exe";
    const executable = async (candidate) => [envChrome, newest, systemChrome].includes(candidate);

    assert.equal(await findChromePath({
      env: { CHROME_PATH: envChrome, LOCALAPPDATA: localAppData },
      homeDirectory,
      platform: "win32",
      systemCandidates: [systemChrome],
      executable,
    }), envChrome);
    assert.equal(await findChromePath({
      env: { LOCALAPPDATA: localAppData },
      homeDirectory,
      platform: "win32",
      systemCandidates: [systemChrome],
      executable,
    }), newest);
    assert.notEqual(newest, older);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("chromePathCandidates on win32 resolves the Playwright root under LOCALAPPDATA, falls back to homeDirectory/AppData/Local when LOCALAPPDATA is unset, and builds default system candidates from ProgramFiles/LOCALAPPDATA", async () => {
  const homeDirectory = await mkdtemp(join(tmpdir(), "render-cut-win32-roots-"));
  try {
    const localAppData = join(homeDirectory, "custom-local-appdata");
    const withLocalAppDataButNoDirs = await chromePathCandidates({
      env: { LOCALAPPDATA: localAppData },
      homeDirectory,
      platform: "win32",
      systemCandidates: [],
    });
    assert.deepEqual(withLocalAppDataButNoDirs, [], "no playwright/puppeteer dirs exist yet, so candidates stay empty rather than throwing");

    const fallbackShell = join(
      homeDirectory,
      "AppData/Local/ms-playwright/chromium_headless_shell-1/chrome-headless-shell-win64/chrome-headless-shell.exe",
    );
    await mkdir(join(fallbackShell, ".."), { recursive: true });
    const withoutLocalAppData = await chromePathCandidates({
      env: {},
      homeDirectory,
      platform: "win32",
      systemCandidates: [],
    });
    assert.deepEqual(withoutLocalAppData, [fallbackShell]);

    const defaults = await chromePathCandidates({
      env: {
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
      },
      homeDirectory,
      platform: "win32",
    });
    assert.deepEqual(defaults, [
      join("C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
      join("C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      join("C:\\Users\\tester\\AppData\\Local", "Google", "Chrome", "Application", "chrome.exe"),
    ]);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("ffmpegInstallHint gives a platform-specific install hint (ffmpeg detection logic itself is untouched)", () => {
  assert.match(ffmpegInstallHint("win32"), /FFMPEG/);
  assert.match(ffmpegInstallHint("win32"), /winget install ffmpeg/);
  assert.match(ffmpegInstallHint("darwin"), /FFMPEG/);
  assert.match(ffmpegInstallHint("darwin"), /brew install ffmpeg/);
  assert.doesNotMatch(ffmpegInstallHint("linux"), /winget|brew/);
});

test("puppeteer-core package detection accepts a hoisted require.resolve result", () => {
  const hoisted = "/repo/node_modules/puppeteer-core/package.json";
  const resolved = resolvePuppeteerPackagePath((specifier) => {
    assert.equal(specifier, "puppeteer-core/package.json");
    return hoisted;
  });
  assert.equal(resolved, hoisted);
  assert.equal(resolved !== null, true, "a hoisted resolution must set puppeteerAvailable=true");
  assert.equal(resolvePuppeteerPackagePath(() => {
    throw new Error("not found");
  }), null);
});

test("a hanging static Chrome capture times out and records the rejected attempt", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-hanging-chrome-"));
  try {
    const fakeChrome = join(root, "fake-chrome.sh");
    await writeFile(fakeChrome, "#!/bin/sh\nexec sleep 5\n");
    await chmod(fakeChrome, 0o755);
    const state = {
      warnings: [],
      plan: {
        rasterizer: {
          selected: "static-screenshot",
          order: ["hyperframes", "puppeteer-core", "static-screenshot"],
        },
      },
      provenance: { rasterizer: { planned: "static-screenshot", adopted: null, attempts: [] } },
    };
    const started = Date.now();
    await assert.rejects(
      rasterizeAndComposite({
        state,
        allOverlays: [{
          id: "label",
          html: "<div>label</div>",
          start: 0,
          duration: 1,
          transform: {},
          vars: {},
        }],
        edit: { output: { width: 320, height: 180, fps: 10 } },
        projectRoot: root,
        temporaryDirectory: root,
        cutPath: join(root, "unused-cut.mp4"),
        compositePath: join(root, "unused-composite.mp4"),
        capabilities: {
          hyperframesAvailable: false,
          puppeteerAvailable: false,
          chromePath: fakeChrome,
          ffprobeCommand: "ffprobe",
          ffmpegCommand: "ffmpeg",
        },
        duration: 1,
        hasThreeDimensionalOverlay: false,
        captureTimeoutMs: 50,
      }),
      /all overlay rasterizers failed/,
    );
    assert.ok(Date.now() - started < 2_000);
    const staticAttempt = state.provenance.rasterizer.attempts.find(
      (attempt) => attempt.method === "static-screenshot",
    );
    assert.equal(staticAttempt?.status, "rejected");
    assert.match(staticAttempt?.reason ?? "", /timeout.*50ms/iu);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a hanging Puppeteer launch times out independently of the frame count", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-hanging-puppeteer-launch-"));
  try {
    const started = Date.now();
    await assert.rejects(
      captureWithPuppeteer({
        sheetPath: join(root, "overlay-sheet.html"),
        chromePath: "/fake/chrome",
        framesDirectory: join(root, "frames"),
        overlayMovPath: join(root, "overlay.mov"),
        width: 320,
        height: 180,
        fps: 5,
        duration: 10,
        ffmpegCommand: "ffmpeg",
        timeoutMs: 200,
        puppeteerModule: { launch: () => new Promise(() => {}) },
      }),
      /launching Chrome timeout after 200ms/,
    );
    assert.ok(
      Date.now() - started < 2_000,
      "launch timeout must not scale with the 50-frame capture duration",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the Puppeteer watchdog closes and kills a browser whose screenshot hangs", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-hanging-puppeteer-"));
  let closeCalled = false;
  let killedWith = null;
  const browserProcess = {
    exitCode: null,
    signalCode: null,
    kill(signal) {
      killedWith = signal;
    },
  };
  const page = {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    async setViewport() {},
    async goto() {},
    async evaluate() {},
    screenshot() {
      return new Promise(() => {});
    },
  };
  const browser = {
    connected: true,
    async newPage() {
      return page;
    },
    async close() {
      closeCalled = true;
    },
    process() {
      return browserProcess;
    },
  };
  try {
    await assert.rejects(
      captureWithPuppeteer({
        sheetPath: join(root, "overlay-sheet.html"),
        chromePath: "/fake/chrome",
        framesDirectory: join(root, "frames"),
        overlayMovPath: join(root, "overlay.mov"),
        width: 320,
        height: 180,
        fps: 1,
        duration: 1,
        ffmpegCommand: "ffmpeg",
        timeoutMs: 30,
        puppeteerModule: { launch: async () => browser },
      }),
      /timeout after 30ms/,
    );
    assert.equal(closeCalled, true);
    assert.equal(killedWith, "SIGKILL");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a video seek timeout warns and continues capturing the frame", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-video-seek-timeout-"));
  const warnings = [];
  let evaluateCalls = 0;
  let screenshotCalls = 0;
  const page = {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    async setViewport() {},
    async goto() {},
    async evaluate() {
      evaluateCalls += 1;
      if (evaluateCalls === 1) return true;
      return {
        warnings: [
          "video 1 seek/presentation timeout after 5000ms at 0s; continuing with the current frame",
        ],
      };
    },
    async screenshot() {
      screenshotCalls += 1;
    },
  };
  const browser = {
    connected: false,
    async newPage() {
      return page;
    },
    async close() {},
  };
  try {
    const overlayPath = join(root, "overlay.mov");
    assert.equal(
      await captureWithPuppeteer({
        sheetPath: join(root, "overlay-sheet.html"),
        chromePath: "/fake/chrome",
        framesDirectory: join(root, "frames"),
        overlayMovPath: overlayPath,
        width: 320,
        height: 180,
        fps: 1,
        duration: 1,
        ffmpegCommand: "true",
        timeoutMs: 100,
        puppeteerModule: { launch: async () => browser },
        onWarning: (warning) => warnings.push(warning),
      }),
      overlayPath,
    );
    assert.equal(screenshotCalls, 1, "the timed-out seek must not skip its screenshot");
    assert.deepEqual(warnings, [
      "frame 1/1 at 0s: video 1 seek/presentation timeout after 5000ms at 0s; continuing with the current frame",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a lower-priority adopted rasterizer produces a report warning", () => {
  const state = {
    version: 1,
    phase: "verified",
    inputs: {},
    warnings: [],
    plan: {
      predicted_duration_seconds: 1,
      preset: { width: 320, height: 180, fps: 30 },
      output: "exports/out.mp4",
      intermediates: [],
      commands: {},
      rasterizer: {
        selected: "puppeteer-core",
        order: ["hyperframes", "puppeteer-core", "static-screenshot"],
      },
    },
    provenance: {
      rasterizer: {
        planned: "puppeteer-core",
        adopted: "static-screenshot",
        attempts: [
          { method: "puppeteer-core", status: "rejected", reason: "browser timeout" },
          { method: "static-screenshot", status: "adopted", reason: null },
        ],
      },
    },
    verify: { verdict: "pass", findings: [] },
    artifacts: [],
  };
  addRasterizerDowngradeWarning(state);
  assert.deepEqual(state.warnings, [
    "rasterizer downgraded: puppeteer-core -> static-screenshot (browser timeout)",
  ]);
  const report = renderReport(state, "/project/.akari/reports/render-report.html", "/project");
  assert.match(report, /rasterizer downgraded: puppeteer-core -&gt; static-screenshot \(browser timeout\)/);
});
