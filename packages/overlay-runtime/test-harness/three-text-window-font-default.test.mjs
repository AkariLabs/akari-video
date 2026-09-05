import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const FONT_URL = pathToFileURL(join(HERE, "fonts/ZenKakuGothicNew-Black.ttf")).href;
const require = createRequire(`${resolve(HERE, "../../render-cut")}/`);
const tempDir = mkdtempSync(join(tmpdir(), "akari-three-text-window-"));
const htmlPath = join(tempDir, "harness.html");
let browser;
let configuredPage;
let unconfiguredPage;

function findChrome() {
  const cacheRoot = join(homedir(), ".cache/puppeteer/chrome-headless-shell");
  const candidates = [];
  if (existsSync(cacheRoot)) {
    for (const build of readFileDirectories(cacheRoot).sort().reverse()) {
      for (const platform of readFileDirectories(join(cacheRoot, build))) {
        candidates.push(join(cacheRoot, build, platform, "chrome-headless-shell"));
      }
    }
  }
  candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  const found = candidates.find(existsSync);
  if (!found) throw new Error("headless Chrome が見つかりません");
  return found;
}

function readFileDirectories(path) {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function inline(source) {
  return source.replaceAll("</script", "<\\/script");
}

function harnessHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
    #stage{position:relative;width:640px;height:360px}
    .scene-content{position:absolute;inset:0}
    .fragment{position:absolute;inset:0}
    canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  </style>
  <script>${inline(readFileSync(join(SRC, "vendor/three-bundle.js"), "utf8"))}</script>
  <script>${inline(readFileSync(join(SRC, "vendor/vendor-3d-text-bundle.js"), "utf8"))}</script>
  <script>${inline(readFileSync(join(SRC, "three-runtime.js"), "utf8"))}</script>
  </head><body><div id="stage"></div></body></html>`;
}

async function freshPage(configured = true) {
  return configured ? configuredPage : unconfiguredPage;
}

async function mount(page, descriptor, { configure = true } = {}) {
  return page.evaluate(async ({ descriptorValue, defaultFontUrl, shouldConfigure }) => {
    if (shouldConfigure) window.akari.threeRuntime.configure({ defaultFontUrl });
    const id = `scene-${document.querySelectorAll(".scene-content").length}`;
    const container = document.createElement("div");
    container.id = id;
    container.className = "scene-content";
    const root = document.createElement("div");
    root.className = "fragment";
    const canvas = document.createElement("canvas");
    root.appendChild(canvas);
    const script = document.createElement("script");
    script.type = "application/json";
    script.setAttribute("data-akari-3d-scene", "");
    script.textContent = JSON.stringify(descriptorValue);
    root.appendChild(script);
    container.appendChild(root);
    document.getElementById("stage").appendChild(container);
    window.akari.threeRuntime.render(container, 0);
    const deadline = Date.now() + 20_000;
    for (;;) {
      const status = window.akari.threeRuntime.inspect(container).status;
      if (status === "ready" || status === "error" || status === "disposed") return { id, status };
      if (Date.now() > deadline) return { id, status: "timeout" };
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }, { descriptorValue: descriptor, defaultFontUrl: FONT_URL, shouldConfigure: configure });
}

async function measure(page, id, seconds) {
  return page.evaluate(({ containerId, time }) => {
    const container = document.getElementById(containerId);
    window.akari.threeRuntime.render(container, time);
    const canvas = container.querySelector("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let count = 0;
    let minX = canvas.width;
    let maxX = -1;
    let minY = canvas.height;
    let maxY = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue;
        count += 1;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    const width = maxX >= minX ? maxX - minX + 1 : 0;
    const height = maxY >= minY ? maxY - minY + 1 : 0;
    return {
      alphaPixels: count,
      width,
      height,
      pixelAspect: height > 0 ? width / height : 0,
      runtime: window.akari.threeRuntime.inspect(container),
    };
  }, { containerId: id, time: seconds });
}

async function validationError(page, descriptor) {
  return page.evaluate((descriptorValue) => {
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args.map((value) => value?.message ?? String(value)).join(" "));
    const container = document.createElement("div");
    container.className = "scene-content";
    const root = document.createElement("div");
    root.innerHTML = `<canvas></canvas><script type="application/json" data-akari-3d-scene></script>`;
    root.querySelector("script").textContent = JSON.stringify(descriptorValue);
    container.appendChild(root);
    document.getElementById("stage").appendChild(container);
    window.akari.threeRuntime.render(container, 0);
    console.error = originalError;
    return errors.join("\n");
  }, descriptor);
}

before(async () => {
  writeFileSync(htmlPath, harnessHtml(), "utf8");
  browser = await require("puppeteer-core").launch({
    executablePath: findChrome(),
    headless: "shell",
    pipe: true,
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
  configuredPage = await browser.newPage();
  unconfiguredPage = await browser.newPage();
  for (const page of [configuredPage, unconfiguredPage]) {
    await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  }
  await configuredPage.evaluate((defaultFontUrl) => {
    window.akari.threeRuntime.configure({ defaultFontUrl });
  }, FONT_URL);
});

after(async () => {
  const process = browser?.process();
  if (process) process.kill("SIGKILL");
  else await browser?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("texts[].window.start rejects negative values", async () => {
  const page = await freshPage();
  const error = await validationError(page, {
    texts: [{ id: "title", text: "窓", font: FONT_URL, window: { start: -1, duration: 1 } }],
  });
  assert.match(error, /window\.start は 0 以上の数値/u);
});

test("texts[].window.duration rejects zero", async () => {
  const page = await freshPage();
  const error = await validationError(page, {
    texts: [{ id: "title", text: "窓", font: FONT_URL, window: { start: 0, duration: 0 } }],
  });
  assert.match(error, /window\.duration は正の数値/u);
});

test("texts[].window is invisible outside and visible inside by pixels", async () => {
  const page = await freshPage();
  const mounted = await mount(page, {
    camera: { fov: 40, position: [0, 0, 4] },
    texts: [{ id: "title", text: "窓", font: FONT_URL, size: 1, window: { start: 1, duration: 2 } }],
  });
  assert.equal(mounted.status, "ready");
  const beforeWindow = await measure(page, mounted.id, 0.999);
  const atWindowStart = await measure(page, mounted.id, 1);
  const insideWindow = await measure(page, mounted.id, 2);
  const atWindowEnd = await measure(page, mounted.id, 3);
  console.log('[three-text-window-measurement]', JSON.stringify({
    before: { t: 0.999, alphaPixels: beforeWindow.alphaPixels },
    inside: { t: 2, alphaPixels: insideWindow.alphaPixels },
    after: { t: 3, alphaPixels: atWindowEnd.alphaPixels },
  }));
  assert.equal(beforeWindow.alphaPixels, 0);
  assert.ok(atWindowStart.alphaPixels > 100);
  assert.ok(insideWindow.alphaPixels > 100);
  assert.equal(atWindowEnd.alphaPixels, 0);
});

test("omitting texts[].window preserves full-duration visibility", async () => {
  const page = await freshPage();
  const mounted = await mount(page, {
    camera: { fov: 40, position: [0, 0, 4] },
    texts: [{ id: "title", text: "A", font: FONT_URL, size: 1 }],
  });
  assert.equal(mounted.status, "ready");
  assert.ok((await measure(page, mounted.id, 0)).alphaPixels > 100);
  assert.ok((await measure(page, mounted.id, 120)).alphaPixels > 100);
});

test("font omission renders through configure defaultFontUrl", async () => {
  const page = await freshPage();
  const mounted = await mount(page, {
    camera: { fov: 40, position: [0, 0, 4] },
    texts: [{ id: "title", text: "既", size: 1 }],
  });
  assert.equal(mounted.status, "ready");
  assert.ok((await measure(page, mounted.id, 0)).alphaPixels > 100);
});

test("font omission without configure reports an explicit Japanese error", async () => {
  const page = await freshPage(false);
  const error = await validationError(page, {
    texts: [{ id: "title", text: "未設定" }],
  });
  assert.match(error, /既定フォント URL が未設定/u);
});

test("CSS rotate keeps camera and rendered pixel aspect invariant", async () => {
  const page = await freshPage();
  const mounted = await mount(page, {
    camera: { fov: 40, position: [0, 0, 4] },
    texts: [{ id: "title", text: "AB", font: FONT_URL, size: 1 }],
  });
  assert.equal(mounted.status, "ready");
  const beforeRotation = await measure(page, mounted.id, 0);
  await page.evaluate((id) => {
    document.getElementById(id).firstElementChild.style.transform = "rotate(15deg)";
  }, mounted.id);
  const afterRotation = await measure(page, mounted.id, 0);
  console.log('[three-text-rotate-measurement]', JSON.stringify({
    before: {
      cameraAspect: beforeRotation.runtime.cameraAspect,
      pixelAspect: beforeRotation.pixelAspect,
      alphaPixels: beforeRotation.alphaPixels,
    },
    after: {
      cameraAspect: afterRotation.runtime.cameraAspect,
      pixelAspect: afterRotation.pixelAspect,
      alphaPixels: afterRotation.alphaPixels,
    },
  }));
  assert.equal(beforeRotation.runtime.cameraAspect, 640 / 360);
  assert.equal(afterRotation.runtime.cameraAspect, beforeRotation.runtime.cameraAspect);
  assert.ok(beforeRotation.alphaPixels > 100);
  assert.equal(afterRotation.alphaPixels, beforeRotation.alphaPixels);
  assert.ok(Math.abs(afterRotation.pixelAspect - beforeRotation.pixelAspect) < 0.01);
});

test("physics uses each text window start as simulation time zero", async () => {
  const page = await freshPage();
  const mounted = await mount(page, {
    camera: { fov: 40, position: [0, 0, 4] },
    texts: [{
      id: "fall",
      text: "落",
      font: FONT_URL,
      size: 0.8,
      window: { start: 1, duration: 2 },
      layout: { position: [0, 1, 0] },
    }],
    physics: {
      enabled: true,
      seed: 7,
      duration: 2,
      start: "layout",
      gravity: [0, -1],
      targets: ["fall"],
      colliders: [],
    },
  });
  assert.equal(mounted.status, "ready");
  const beforeWindow = (await measure(page, mounted.id, 0.5)).runtime.physics.charStates[0];
  const atWindowStart = (await measure(page, mounted.id, 1)).runtime.physics.charStates[0];
  const afterWindowStart = (await measure(page, mounted.id, 1.5)).runtime.physics.charStates[0];
  assert.deepEqual(beforeWindow, atWindowStart);
  assert.ok(afterWindowStart.y < atWindowStart.y);
});
