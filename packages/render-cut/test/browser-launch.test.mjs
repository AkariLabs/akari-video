import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  chromeAppBundlePath,
  launchBrowser,
  waitForDevToolsActivePort,
  waitForProfileProcessesExit,
} from "../src/browser-launch.mjs";
import {
  captureStaticOverlays,
  captureWithPuppeteer,
  renderOverlaySheet,
} from "../src/rasterize.mjs";
import { rasterizeAndComposite } from "../src/render-cut.mjs";

const SYSTEM_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("chromeAppBundlePath resolves system and Chrome for Testing app bundles", () => {
  assert.equal(
    chromeAppBundlePath(SYSTEM_CHROME),
    "/Applications/Google Chrome.app",
  );
  assert.equal(
    chromeAppBundlePath(
      "/cache/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ),
    "/cache/Google Chrome for Testing.app",
  );
  assert.equal(chromeAppBundlePath("/cache/chrome-headless-shell"), null);
});

test("waitForDevToolsActivePort waits for a valid port and browser endpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-devtools-port-"));
  try {
    setTimeout(() => {
      writeFile(
        join(root, "DevToolsActivePort"),
        "43123\n/devtools/browser/test-browser\n",
        "utf8",
      );
    }, 20);
    assert.deepEqual(
      await waitForDevToolsActivePort({ userDataDir: root, timeoutMs: 500 }),
      {
        port: 43123,
        browserWSEndpoint: "ws://127.0.0.1:43123/devtools/browser/test-browser",
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("LaunchServices cleanup waits until every process releases the profile", async () => {
  const samples = [
    ["chrome --user-data-dir=/tmp/profile", "chrome --type=gpu --user-data-dir=/tmp/profile"],
    ["chrome --type=renderer --user-data-dir=/tmp/profile"],
    [],
  ];
  let polls = 0;
  await waitForProfileProcessesExit({
    userDataDir: "/tmp/profile",
    timeoutMs: 500,
    pollIntervalMs: 1,
    async listProcesses() {
      const sample = samples[Math.min(polls, samples.length - 1)];
      polls += 1;
      return sample;
    },
  });
  assert.equal(polls, 4, "two consecutive empty process samples make shutdown stable");
});

test("macOS launch uses LaunchServices, connects, closes, and removes its unique profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-launchservices-unit-"));
  let launched = null;
  let connected = null;
  let browserClosed = false;
  let remoteCloseEndpoint = null;
  try {
    const session = await launchBrowser({
      puppeteer: {
        async connect(options) {
          connected = options;
          return {
            connected: true,
            async close() {
              browserClosed = true;
            },
          };
        },
      },
      chromePath: SYSTEM_CHROME,
      profileParent: root,
      profilePrefix: "profile-",
      args: ["--no-first-run"],
      timeoutMs: 500,
      platform: "darwin",
      async launchMacApplication(options) {
        launched = options;
        const profileArgument = options.args.find((argument) =>
          argument.startsWith("--user-data-dir="),
        );
        const profile = profileArgument.slice("--user-data-dir=".length);
        await writeFile(
          join(profile, "DevToolsActivePort"),
          "43124\n/devtools/browser/unit-browser\n",
          "utf8",
        );
      },
      async closeRemoteBrowser(endpoint) {
        remoteCloseEndpoint = endpoint;
      },
      onError: () => assert.fail("successful launch must not report an error"),
    });

    assert.equal(launched.appPath, "/Applications/Google Chrome.app");
    assert.deepEqual(launched.args.slice(0, 3), [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${session.userDataDir}`,
    ]);
    assert.deepEqual(connected, {
      browserWSEndpoint: "ws://127.0.0.1:43124/devtools/browser/unit-browser",
      defaultViewport: null,
    });
    await session.close();
    assert.equal(browserClosed, true);
    assert.equal(
      remoteCloseEndpoint,
      "ws://127.0.0.1:43124/devtools/browser/unit-browser",
      "connect() browser.close() resolves without closing remote Chrome, so CDP Browser.close is mandatory",
    );
    assert.equal(existsSync(session.userDataDir), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("non-macOS keeps the direct puppeteer.launch path and removes its profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-direct-launch-unit-"));
  let launchOptions = null;
  let browserClosed = false;
  try {
    const session = await launchBrowser({
      puppeteer: {
        async launch(options) {
          launchOptions = options;
          return {
            connected: false,
            async close() { browserClosed = true; },
            wsEndpoint() { return "ws://127.0.0.1/direct"; },
          };
        },
      },
      chromePath: "/opt/chrome",
      profileParent: root,
      timeoutMs: 500,
      platform: "linux",
      args: ["--no-first-run"],
      onError: () => assert.fail("successful launch must not report an error"),
    });
    assert.equal(launchOptions.executablePath, "/opt/chrome");
    assert.equal(launchOptions.headless, true);
    assert.equal(launchOptions.userDataDir, session.userDataDir);
    assert.deepEqual(launchOptions.args, ["--no-first-run"]);
    await session.close();
    assert.equal(browserClosed, true);
    assert.equal(existsSync(session.userDataDir), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("macOS launches a non-app chrome-headless-shell directly with puppeteer.launch", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-macos-headless-shell-unit-"));
  let launchOptions = null;
  let launchServicesCalled = false;
  let browserClosed = false;
  try {
    const session = await launchBrowser({
      puppeteer: {
        async launch(options) {
          launchOptions = options;
          return {
            connected: false,
            async close() { browserClosed = true; },
            wsEndpoint() { return "ws://127.0.0.1/headless-shell"; },
          };
        },
      },
      chromePath: "/cache/chrome-headless-shell",
      profileParent: root,
      timeoutMs: 500,
      platform: "darwin",
      args: ["--no-first-run"],
      async launchMacApplication() { launchServicesCalled = true; },
      onError: () => assert.fail("successful launch must not report an error"),
    });
    assert.equal(launchServicesCalled, false);
    assert.equal(launchOptions.executablePath, "/cache/chrome-headless-shell");
    assert.equal(launchOptions.headless, true);
    assert.equal(launchOptions.userDataDir, session.userDataDir);
    assert.deepEqual(launchOptions.args, ["--no-first-run"]);
    await session.close();
    assert.equal(browserClosed, true);
    assert.equal(existsSync(session.userDataDir), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("port timeout reports a Japanese user action and removes the failed profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-launchservices-timeout-"));
  const messages = [];
  const failureMarkerPath = join(root, ".browser-launch-failed");
  try {
    await assert.rejects(
      launchBrowser({
        puppeteer: { async connect() { assert.fail("connect must not run without a port"); } },
        chromePath: SYSTEM_CHROME,
        profileParent: root,
        timeoutMs: 40,
        platform: "darwin",
        failureMarkerPath,
        async launchMacApplication() {},
        onError: (message) => messages.push(message),
      }),
      /字幕レンダ用ブラウザの起動に失敗しました.*Chrome のインストール/iu,
    );
    assert.equal(messages.length, 1);
    assert.match(messages[0], /DevToolsActivePort timeout after 40ms/u);
    assert.deepEqual(await readdir(root), [".browser-launch-failed"]);

    let fallbackLaunchCalled = false;
    await assert.rejects(
      launchBrowser({
        puppeteer: { async connect() { assert.fail("fallback connect must not run"); } },
        chromePath: SYSTEM_CHROME,
        profileParent: root,
        timeoutMs: 40,
        platform: "darwin",
        failureMarkerPath,
        async launchMacApplication() { fallbackLaunchCalled = true; },
        onError: (message) => messages.push(message),
      }),
      /簡易描画へ切り替えず停止します/u,
    );
    assert.equal(fallbackLaunchCalled, false);
    assert.equal(messages.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("animated and static captures both use the shared browser launcher", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-shared-browser-launcher-"));
  const launcherCalls = [];
  const closedSessions = [];
  const page = {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    async setViewport() {},
    async goto() {},
    async evaluate() { return { warnings: [] }; },
    async screenshot(options) {
      if (options.path) await writeFile(options.path, "png");
    },
    async close() {},
  };
  const sharedLauncher = async (options) => {
    launcherCalls.push(options);
    const id = launcherCalls.length;
    return {
      browser: { connected: false, async newPage() { return page; } },
      async close() { closedSessions.push(id); },
    };
  };
  try {
    await writeFile(join(root, "sheet.html"), "<!doctype html><title>test</title>", "utf8");
    await captureWithPuppeteer({
      sheetPath: join(root, "sheet.html"),
      chromePath: SYSTEM_CHROME,
      framesDirectory: join(root, "frames"),
      overlayMovPath: join(root, "overlay.mov"),
      width: 320,
      height: 180,
      fps: 1,
      duration: 1,
      ffmpegCommand: "true",
      timeoutMs: 500,
      puppeteerModule: { connect() {} },
      browserLauncher: sharedLauncher,
    });
    const captures = await captureStaticOverlays({
      overlays: [{
        id: "label",
        html: "<div>label</div>",
        start: 0,
        duration: 1,
        transform: {},
        vars: {},
      }],
      edit: { output: { width: 320, height: 180, fps: 1 } },
      projectRoot: root,
      temporaryDirectory: root,
      chromePath: SYSTEM_CHROME,
      timeoutMs: 500,
      puppeteerModule: { connect() {} },
      browserLauncher: sharedLauncher,
    });

    assert.equal(launcherCalls.length, 2);
    assert.equal(launcherCalls[0].profileParent, join(root, "frames"));
    assert.equal(launcherCalls[1].profileParent, root);
    assert.deepEqual(closedSessions, [1, 2]);
    assert.equal(captures.length, 1);
    assert.equal(await readFile(captures[0].path, "utf8"), "png");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a browser launch failure stops the render without a static downgrade or degraded mp4", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-browser-failure-stop-"));
  const compositePath = join(root, "must-not-exist.mp4");
  const state = {
    warnings: [],
    plan: {
      rasterizer: {
        selected: "puppeteer-core",
        order: ["hyperframes", "puppeteer-core", "static-screenshot"],
      },
    },
    provenance: {
      rasterizer: { planned: "puppeteer-core", adopted: null, attempts: [] },
    },
  };
  const messages = [];
  const originalConsoleError = console.error;
  console.error = (...values) => messages.push(values.join(" "));
  try {
    await assert.rejects(
      rasterizeAndComposite({
        state,
        allOverlays: [{
          id: "caption",
          html: "<div>caption</div>",
          start: 0,
          duration: 1,
          transform: {},
          vars: {},
        }],
        edit: { output: { width: 320, height: 180, fps: 1 } },
        projectRoot: root,
        temporaryDirectory: root,
        cutPath: join(root, "unused-cut.mp4"),
        compositePath,
        capabilities: {
          hyperframesAvailable: false,
          puppeteerAvailable: true,
          chromePath: join(root, "missing-chrome"),
          ffprobeCommand: "ffprobe",
          ffmpegCommand: "ffmpeg",
        },
        duration: 1,
        hasThreeDimensionalOverlay: false,
        captureTimeoutMs: 100,
      }),
      /all overlay rasterizers failed/u,
    );
  } finally {
    console.error = originalConsoleError;
  }
  try {
    assert.equal(state.provenance.rasterizer.adopted, null);
    assert.match(
      state.provenance.rasterizer.attempts.find(
        (attempt) => attempt.method === "static-screenshot",
      )?.reason ?? "",
      /簡易描画へ切り替えず停止します/u,
    );
    assert.ok(messages.some((message) =>
      /字幕レンダ用ブラウザの起動に失敗しました.*Chrome のインストール/u.test(message),
    ));
    assert.equal(existsSync(compositePath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real macOS Chrome launches through LaunchServices and captures a transparent 1920x1080 caption PNG", async (t) => {
  if (process.platform !== "darwin") return t.skip("LaunchServices integration requires macOS");
  const integrationChrome = await findLaunchableChromeApp();
  if (!integrationChrome) return t.skip("a Chrome .app bundle is not installed");

  const root = await mkdtemp(join(tmpdir(), "render-cut-launchservices-integration-"));
  let session = null;
  let profile = null;
  try {
    const sheetPath = join(root, "caption-sheet.html");
    await writeFile(
      sheetPath,
      renderOverlaySheet({
        overlays: [{
          id: "caption",
          start: 0,
          duration: 1,
          html: "<div style=\"position:absolute;left:360px;right:360px;bottom:120px;padding:28px;border-radius:24px;background:rgba(0,0,0,.78);color:white;font:600 64px sans-serif;text-align:center\">正規字幕レンダ<br>LaunchServices</div>",
          transform: {},
          vars: {},
        }],
        edit: { output: { width: 1920, height: 1080, fps: 30 } },
        projectRoot: root,
        duration: 1,
      }),
      "utf8",
    );
    const imported = await import("puppeteer-core");
    const puppeteer = imported.default ?? imported;
    try {
      session = await launchBrowser({
        puppeteer,
        chromePath: integrationChrome,
        profileParent: root,
        timeoutMs: 15_000,
        platform: "darwin",
        args: ["--no-first-run", "--no-default-browser-check", "--disable-gpu"],
        onError: () => {},
      });
    } catch (error) {
      if (/kLSNoExecutableErr|invalid signature|code has no resources/iu.test(error.message)) {
        return t.skip("LaunchServices rejected the installed Chrome bundle before launch");
      }
      throw error;
    }
    profile = session.userDataDir;
    const page = await session.browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(sheetPath).href, { waitUntil: "networkidle0" });
    await page.evaluate(() => window.__akariReady);
    await page.evaluate(() => window.__akariSeek(0.5));
    const png = Buffer.from(await page.screenshot({ omitBackground: true }));
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
    assert.equal(png.readUInt32BE(16), 1920);
    assert.equal(png.readUInt32BE(20), 1080);
    assert.equal(png[25], 6, "PNG must use RGBA color type for transparency");
    await page.close();
    await session.close();
    session = null;
    assert.equal(existsSync(profile), false);
    const processes = spawnSync("ps", ["-axo", "command="], { encoding: "utf8" }).stdout;
    assert.doesNotMatch(processes, new RegExp(escapeRegExp(profile), "u"));
  } finally {
    await session?.close({ force: true }).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function findLaunchableChromeApp() {
  const cacheRoot = join(homedir(), ".cache", "puppeteer", "chrome");
  const cached = await readdir(cacheRoot).catch(() => []);
  const architecture = process.arch === "arm64" ? "arm64" : "x64";
  const candidates = [
    process.env.CHROME_PATH,
    ...cached.sort((left, right) => right.localeCompare(left)).map((version) =>
      join(
        cacheRoot,
        version,
        `chrome-mac-${architecture}`,
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
      )),
    SYSTEM_CHROME,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return null;
}
