import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");
const SRC = join(PACKAGE_ROOT, "src");
const FONT_URL = pathToFileURL(join(HERE, "fonts/ZenKakuGothicNew-Black.ttf")).href;
const tempDir = mkdtempSync(join(tmpdir(), "akari-three-canvas-target-"));
let browser;

function loadPuppeteer() {
  const roots = [resolve(HERE, "../../render-cut")];
  const gitFile = resolve(HERE, "../../../.git");
  if (existsSync(gitFile) && statSync(gitFile).isFile()) {
    const gitDir = readFileSync(gitFile, "utf8").trim().replace(/^gitdir:\s*/, "");
    const marker = `${join(".git", "worktrees")}/`;
    const markerIndex = gitDir.indexOf(marker);
    if (markerIndex >= 0) roots.push(join(gitDir.slice(0, markerIndex), "packages/render-cut"));
  }
  for (const root of roots) {
    try {
      return createRequire(`${root}/`)("puppeteer-core");
    } catch {
      // 依存の無い worktree では git common dir からメイン checkout を試す。
    }
  }
  throw new Error("puppeteer-core を解決できません");
}

function findChrome() {
  const cacheRoot = join(homedir(), ".cache/puppeteer/chrome-headless-shell");
  const cached = [];
  if (existsSync(cacheRoot)) {
    const directories = (path) => readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const build of directories(cacheRoot).sort().reverse()) {
      for (const platform of directories(join(cacheRoot, build))) {
        cached.push(join(cacheRoot, build, platform, "chrome-headless-shell"));
      }
    }
  }
  const candidates = [
    process.env.AKARI_TEST_CHROME_PATH,
    process.env.CHROME_PATH,
    ...cached,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const chrome = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!chrome) throw new Error("headless Chrome が見つかりません");
  return chrome;
}

function inline(source) {
  return source.replaceAll("</script", "<\\/script");
}

function harnessHtml(runtime) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent}
    .scene{position:relative;width:320px;height:180px}
    .fragment{position:absolute;inset:0;width:100%;height:100%}
    canvas{position:absolute;top:0;width:160px;height:180px;display:block}
    .deco{left:0}.stage{left:160px}
  </style>
  <script>${inline(readFileSync(join(SRC, "vendor/three-bundle.js"), "utf8"))}</script>
  <script>${inline(readFileSync(join(SRC, "vendor/vendor-3d-text-bundle.js"), "utf8"))}</script>
  <script>${inline(runtime)}</script></head><body><main id="stage"></main></body></html>`;
}

async function openPage(name) {
  const runtime = readFileSync(process.env.THREE_RUNTIME_SOURCE || join(SRC, "three-runtime.js"), "utf8");
  const htmlPath = join(tempDir, `${name}.html`);
  writeFileSync(htmlPath, harnessHtml(runtime), "utf8");
  const page = await browser.newPage();
  const warnings = [];
  const errors = [];
  page.on("console", message => {
    if (!message.text().startsWith("[akari-three]")) return;
    if (message.type() === "warn" || message.type() === "warning") warnings.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setViewport({ width: 640, height: 480, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  await page.evaluate(fontUrl => window.akari.threeRuntime.configure({
    defaultFontUrl: fontUrl, previewDiagnostics: true,
  }), FONT_URL);
  return { page, warnings, errors };
}

async function mount(page, id, markers, count) {
  return page.evaluate(async ({ id, markers, count }) => {
    const container = document.createElement("div");
    container.id = id;
    container.className = "scene";
    const root = document.createElement("div");
    root.className = "fragment";
    for (let index = 0; index < count; index += 1) {
      const canvas = document.createElement("canvas");
      canvas.className = index === 0 ? "deco" : "stage";
      if (markers.includes(index)) canvas.setAttribute("data-akari-3d-canvas", "");
      root.appendChild(canvas);
    }
    const script = document.createElement("script");
    script.type = "application/json";
    script.setAttribute("data-akari-3d-scene", "");
    script.textContent = JSON.stringify({
      background: { color: "#00ff00" },
      texts: [{ id: "label", text: "A", size: 0.5, window: { start: 2, duration: 1 } }],
    });
    root.appendChild(script);
    container.appendChild(root);
    document.getElementById("stage").appendChild(container);
    window.akari.threeRuntime.render(container, 0);
    const deadline = Date.now() + 20_000;
    for (;;) {
      const status = window.akari.threeRuntime.inspect(container).status;
      if (status === "ready" || status === "error" || Date.now() > deadline) {
        if (status === "ready") window.akari.threeRuntime.render(container, 0);
        return status;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }, { id, markers, count });
}

function canvasState(page, id, { select = false, times = [], pixel = false } = {}) {
  return page.evaluate(({ id, select, times, pixel }) => {
    const container = document.getElementById(id);
    const runtime = window.akari.threeRuntime;
    for (const time of times) runtime.render(container, time);
    const canvases = [...container.querySelectorAll("canvas")];
    const selected = select && typeof runtime.canvasFor === "function"
      ? canvases.indexOf(runtime.canvasFor(container)) : -1;
    let centerPixel = null;
    if (pixel) {
      const canvas = canvases[0];
      runtime.render(container, 0.5);
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (gl) {
        const rgba = new Uint8Array(4);
        gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2),
          1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        centerPixel = [...rgba];
      }
    }
    return {
      selected,
      contexts2d: canvases.map(canvas => canvas.getContext("2d") !== null),
      centerPixel,
      error: container.querySelector("[data-akari-3d-fallback]")?.title ?? null,
    };
  }, { id, select, times, pixel });
}

before(async () => {
  browser = await loadPuppeteer().launch({
    executablePath: findChrome(),
    headless: "shell",
    pipe: true,
    dumpio: process.env.AKARI_TEST_BROWSER_DUMPIO === '1',
    args: [
      "--no-sandbox",
      "--no-zygote",
      "--single-process",
      "--allow-file-access-from-files",
      "--disable-gpu",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
    ],
  });
});

after(async () => {
  const process = browser?.process();
  if (process) process.kill("SIGKILL");
  else await browser?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("(a) explicit stage canvas receives WebGL without a warning", async () => {
  const { page, warnings } = await openPage("explicit");
  try {
    assert.equal(await mount(page, "explicit", [1], 2), "ready");
    assert.deepEqual((await canvasState(page, "explicit")).contexts2d, [true, false]);
    assert.equal(warnings.length, 0);
  } finally { await page.close(); }
});

test("(b) ambiguous legacy canvases use the first canvas and warn once", async () => {
  const { page, warnings } = await openPage("legacy");
  try {
    assert.equal(await mount(page, "legacy", [], 2), "ready");
    const state = await canvasState(page, "legacy", { select: true, times: [0.1, 0.2, 0.3] });
    assert.deepEqual(state.contexts2d, [false, true]);
    assert.equal(state.selected, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /\[akari-three\] 3D の断片に canvas が 2 個あり/u);
    assert.match(warnings[0], /data-akari-3d-canvas/u);
  } finally { await page.close(); }
});

test("(c) duplicate markers and missing canvas use the same initialization error path", async () => {
  const { page, errors } = await openPage("invalid");
  try {
    assert.equal(await mount(page, "duplicate", [0, 1], 2), "error");
    assert.equal(await mount(page, "missing", [], 0), "error");
    const duplicate = await canvasState(page, "duplicate");
    const missing = await canvasState(page, "missing");
    assert.deepEqual(duplicate.contexts2d, [true, true]);
    assert.deepEqual(missing.contexts2d, []);
    assert.match(duplicate.error, /data-akari-3d-canvas/u);
    assert.match(missing.error, /3D overlay には canvas が必要です/u);
    assert.equal(errors.length, 2);
    for (const error of errors) {
      assert.match(error, /^\[akari-three\] 3D scene の初期化に失敗しました/u);
    }
  } finally { await page.close(); }
});

test("(d) one unmarked canvas renders the green scene without a warning", async () => {
  const { page, warnings } = await openPage("single");
  try {
    assert.equal(await mount(page, "single", [], 1), "ready");
    const state = await canvasState(page, "single", { pixel: true });
    assert.deepEqual(state.contexts2d, [false]);
    assert.ok(state.centerPixel, "WebGL context must be available");
    assert.ok(state.centerPixel[0] <= 40 && state.centerPixel[1] >= 200
      && state.centerPixel[2] <= 40, `expected green canvas center, got ${state.centerPixel}`);
    assert.equal(warnings.length, 0);
  } finally { await page.close(); }
});

test("(e) canvasFor returns the WebGL canvas for explicit, legacy, and single-canvas fragments", async () => {
  const { page } = await openPage("canvas-for");
  try {
    const cases = [
      { id: "explicit", markers: [1], count: 2, selected: 1, contexts2d: [true, false] },
      { id: "legacy", markers: [], count: 2, selected: 0, contexts2d: [false, true] },
      { id: "single", markers: [], count: 1, selected: 0, contexts2d: [false] },
    ];
    for (const item of cases) {
      assert.equal(await mount(page, item.id, item.markers, item.count), "ready");
      const state = await canvasState(page, item.id, { select: true });
      assert.equal(state.selected, item.selected);
      assert.deepEqual(state.contexts2d, item.contexts2d);
    }
  } finally { await page.close(); }
});
