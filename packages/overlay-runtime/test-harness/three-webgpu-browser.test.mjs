// 宣言型 3D の WebGPU 経路（renderer: "webgpu"）を実ブラウザで検証する。
//
// headless Chrome には WebGPU が無いため、WebGPURenderer は自動で WebGL2 backend に落ちる。
// それでも「WebGPURenderer のコード経路（node material / init / 出力パス）」は通るので、
//  - 宣言の受理・拒否
//  - WebGL2 backend へのフォールバックと inspect() の実測値
//  - 背景色が WebGL と同じ値で出ること（逆トーンマッピング）
//  - flat テキストが輪郭メッシュで描かれ、WebGL(troika) と同じ配置・window・billboard で動くこと
//  - フォント未収録文字が理由付きエラーになること
//  - dispose → 再生成が落ちないこと
// を確かめる。実 GPU の WebGPU backend は L1（Electron 書き出し）で確認する。
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
const DATA_FONT_URL = `data:font/ttf;base64,${readFileSync(
  join(HERE, "fonts/ZenKakuGothicNew-Black.ttf")
).toString("base64")}`;
const require = createRequire(`${resolve(HERE, "../../render-cut")}/`);
const tempDir = mkdtempSync(join(tmpdir(), "akari-three-webgpu-"));
const htmlPath = join(tempDir, "harness.html");
let browser;
let page;

function readFileDirectories(path) {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function findChrome() {
  const cacheRoot = join(homedir(), ".cache/puppeteer/chrome-headless-shell");
  const candidates = [process.env.AKARI_TEST_CHROME_PATH].filter(Boolean);
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

function inline(source) {
  return source.replaceAll("</script", "<\\/script");
}

function harnessHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent}
    #stage{position:relative;width:320px;height:180px}
    .scene-content{position:absolute;inset:0}
    .fragment{position:absolute;inset:0}
    canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  </style>
  <script>${inline(readFileSync(join(SRC, "vendor/three-bundle.js"), "utf8"))}</script>
  <script>${inline(readFileSync(join(SRC, "vendor/vendor-3d-text-bundle.js"), "utf8"))}</script>
  <script>${inline(readFileSync(join(SRC, "three-runtime.js"), "utf8"))}</script>
  </head><body><div id="stage"></div></body></html>`;
}

async function mount(descriptor) {
  return page.evaluate(async ({ descriptorValue, defaultFontUrl }) => {
    window.akari.threeRuntime.configure({ defaultFontUrl });
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
    const deadline = Date.now() + 30_000;
    for (;;) {
      const inspect = window.akari.threeRuntime.inspect(container);
      if (inspect.status === "ready" || inspect.status === "error" || inspect.status === "disposed") {
        return { id, status: inspect.status, inspect };
      }
      if (Date.now() > deadline) return { id, status: "timeout", inspect };
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }, { descriptorValue: descriptor, defaultFontUrl: FONT_URL });
}

// WebGPU canvas は getContext("webgl2") を持たないので、2D canvas へ drawImage して読む
async function readFrame(id, seconds = 0) {
  return page.evaluate(({ containerId, time }) => {
    const container = document.getElementById(containerId);
    window.akari.threeRuntime.render(container, time);
    const source = container.querySelector("canvas");
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let opaque = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] === 0) continue;
        opaque += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    const center = (() => {
      const index = ((height >> 1) * width + (width >> 1)) * 4;
      return [data[index], data[index + 1], data[index + 2], data[index + 3]];
    })();
    return {
      width,
      height,
      opaque,
      center,
      bbox: maxX >= minX ? { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
      pixels: [...data],
      runtime: window.akari.threeRuntime.inspect(container),
    };
  }, { containerId: id, time: seconds });
}

function comparePixels(left, right) {
  let sum = 0;
  let over8 = 0;
  let count = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const diff = Math.abs(left[index + channel] - right[index + channel]);
      sum += diff;
      if (diff > 8) over8 += 1;
      count += 1;
    }
  }
  return { meanAbs: sum / Math.max(1, count), over8Ratio: over8 / Math.max(1, count) };
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
  page = await browser.newPage();
  if (process.env.AKARI_TEST_BROWSER_LOG === "1") {
    page.on("console", (message) => console.log(`[browser:${message.type()}]`, message.text()));
  }
  await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
});

after(async () => {
  const process = browser?.process();
  if (process) process.kill("SIGKILL");
  else await browser?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("bundle exposes WebGPU entry with a single shared three core", async () => {
  const result = await page.evaluate(() => {
    const library = window.AkariThree;
    return {
      hasWebGPURenderer: typeof library.WebGPU?.WebGPURenderer === "function",
      hasPMREM: typeof library.WebGPU?.PMREMGenerator === "function",
      sharedCore: library.WebGPU?.sharedCore === true,
      rendererBasePrototype: library.WebGPU?.RendererBase?.prototype?.isPrototypeOf(
        library.WebGPU.WebGPURenderer.prototype
      ) === true,
    };
  });
  console.log("[three-webgpu-bundle]", JSON.stringify(result));
  assert.equal(result.hasWebGPURenderer, true);
  assert.equal(result.hasPMREM, true);
  assert.equal(result.sharedCore, true);
  assert.equal(result.rendererBasePrototype, true);
});

test("renderer: \"webgpu\" runs through WebGPURenderer and reports the real backend", async () => {
  const mounted = await mount({
    renderer: "webgpu",
    camera: { fov: 40, position: [0, 0, 4], lookAt: [0, 0, 0] },
    texts: [{ id: "gpu", text: "GPU", font: DATA_FONT_URL, size: 0.4 }],
  });
  console.log("[three-webgpu-backend]", JSON.stringify({
    status: mounted.status,
    renderer: mounted.inspect.renderer,
    error: mounted.inspect.error ?? null,
  }));
  assert.equal(mounted.status, "ready");
  assert.equal(mounted.inspect.renderer.declared, "webgpu");
  assert.equal(mounted.inspect.renderer.isWebGPURenderer, true);
  assert.equal(mounted.inspect.renderer.initialized, true);
  // headless は WebGPU 非対応なので WebGL2 backend に落ちる（契約 指示 7）
  assert.equal(mounted.inspect.renderer.backend, "webgl2");
  assert.equal(mounted.inspect.textNodes, 3);
});

test("renderer rejects unknown values with a TypeError", async () => {
  const result = await page.evaluate((descriptorValue) => {
    const captured = [];
    const originalError = console.error;
    console.error = (...args) => captured.push(args.map((value) => value?.message ?? String(value)).join(" "));
    const container = document.createElement("div");
    container.className = "scene-content";
    const root = document.createElement("div");
    root.innerHTML = '<canvas></canvas><script type="application/json" data-akari-3d-scene></script>';
    root.querySelector("script").textContent = JSON.stringify(descriptorValue);
    container.appendChild(root);
    document.getElementById("stage").appendChild(container);
    window.akari.threeRuntime.render(container, 0);
    console.error = originalError;
    return {
      captured,
      inspect: window.akari.threeRuntime.inspect(container),
    };
  }, { renderer: "gpu", texts: [{ id: "x", text: "X", font: DATA_FONT_URL }] });
  assert.equal(result.inspect.status, "error");
  assert.match(result.inspect.error.message, /renderer は "webgl" または "webgpu"/u);
});

test("WebGPU background color matches the WebGL declaration", async () => {
  const colors = ["#000000", "#14171c", "#404040", "#808080", "#c0c0c0", "#ffffff"];
  const measured = [];
  for (const color of colors) {
    const descriptor = {
      camera: { fov: 40, position: [0, 0, 4], lookAt: [0, 0, 0] },
      texts: [{ id: "hidden", text: "X", font: DATA_FONT_URL, window: { start: 10, duration: 1 } }],
      background: { color },
    };
    const webgl = await mount(descriptor);
    const webgpu = await mount({ ...descriptor, renderer: "webgpu" });
    assert.equal(webgl.status, "ready");
    assert.equal(webgpu.status, "ready");
    const webglFrame = await readFrame(webgl.id);
    const webgpuFrame = await readFrame(webgpu.id);
    measured.push({
      color,
      webgl: webglFrame.center,
      webgpu: webgpuFrame.center,
      webgpuClear: webgpuFrame.runtime.backgroundClear,
    });
  }
  console.log("[three-webgpu-background]", JSON.stringify(measured));
  for (const row of measured) {
    assert.deepEqual(
      row.webgpu.slice(0, 3),
      row.webgl.slice(0, 3),
      `background ${row.color}: webgpu ${row.webgpu} != webgl ${row.webgl}`
    );
  }
});

test("WebGPU flat text draws glyph outlines with the same window and placement as troika", async () => {
  const descriptor = {
    camera: { fov: 40, position: [0, 0, 4], lookAt: [0, 0, 0] },
    texts: [{
      id: "flat", text: "ABC", font: DATA_FONT_URL, size: 0.8, color: "#ffd166",
      window: { start: 1, duration: 2 },
    }],
  };
  const webgl = await mount(descriptor);
  const webgpu = await mount({ ...descriptor, renderer: "webgpu" });
  assert.equal(webgl.status, "ready");
  assert.equal(webgpu.status, "ready");
  const hiddenGl = await readFrame(webgl.id, 0.5);
  const hiddenGpu = await readFrame(webgpu.id, 0.5);
  assert.equal(hiddenGl.opaque, 0);
  assert.equal(hiddenGpu.opaque, 0);
  const webglFrame = await readFrame(webgl.id, 1.5);
  const webgpuFrame = await readFrame(webgpu.id, 1.5);
  const diff = comparePixels(webglFrame.pixels, webgpuFrame.pixels);
  console.log("[three-webgpu-flat-text]", JSON.stringify({
    webgl: webglFrame.bbox,
    webgpu: webgpuFrame.bbox,
    diff,
    webgpuRenderer: webgpuFrame.runtime.renderer,
  }));
  assert.ok(webglFrame.bbox, "troika text must draw");
  assert.ok(webgpuFrame.bbox, "outline text must draw");
  // 字形の実装差（SDF vs 輪郭メッシュ）は許容するが、配置・大きさは同じ宣言として近いこと
  assert.ok(Math.abs(webglFrame.bbox.width - webgpuFrame.bbox.width) <= 6);
  assert.ok(Math.abs(webglFrame.bbox.height - webgpuFrame.bbox.height) <= 6);
  assert.ok(Math.abs(webglFrame.bbox.minX - webgpuFrame.bbox.minX) <= 4);
  assert.ok(Math.abs(webglFrame.bbox.minY - webgpuFrame.bbox.minY) <= 4);
  assert.ok(diff.meanAbs < 40, `mean abs diff ${diff.meanAbs} too large`);
});

test("WebGPU flat text keeps billboard / screenSpace / anim on the shared code path", async () => {
  const mounted = await mount({
    renderer: "webgpu",
    camera: { fov: 40, position: [3, 2, 4], lookAt: [0, 0, 0] },
    texts: [{
      id: "billboard", text: "ABC", font: DATA_FONT_URL, size: 0.4,
      billboard: true, anim: { preset: "flip-wave", seed: 7 },
    }],
  });
  assert.equal(mounted.status, "ready");
  const frame = await readFrame(mounted.id, 1.2);
  const group = frame.runtime.texts[0];
  assert.equal(group.billboard, true);
  const expected = [3, 2, 4].map((value) => value / Math.hypot(3, 2, 4));
  const dot = group.normal.reduce((sum, value, index) => sum + value * expected[index], 0);
  assert.ok(dot > 0.999, `normal ${JSON.stringify(group.normal)} does not face camera`);
  assert.ok(frame.opaque > 0);
});

test("WebGPU flat text fails loudly for glyphs the font does not contain", async () => {
  const mounted = await mount({
    renderer: "webgpu",
    camera: { fov: 40, position: [0, 0, 4], lookAt: [0, 0, 0] },
    texts: [{ id: "missing", text: "\u{1F600}", font: DATA_FONT_URL, size: 0.4 }],
  });
  console.log("[three-webgpu-missing-glyph]", JSON.stringify(mounted.inspect.error ?? null));
  assert.equal(mounted.status, "error");
  assert.match(mounted.inspect.error.message, /texts\[missing\].*フォントに収録されていません/u);
});

test("dispose then remount keeps the WebGPU path alive", async () => {
  const first = await mount({
    renderer: "webgpu",
    camera: { fov: 40, position: [0, 0, 4], lookAt: [0, 0, 0] },
    texts: [{ id: "cycle", text: "A", font: DATA_FONT_URL, size: 0.4 }],
  });
  assert.equal(first.status, "ready");
  const disposed = await page.evaluate((id) => {
    const container = document.getElementById(id);
    window.akari.threeRuntime.dispose(container);
    return window.akari.threeRuntime.inspect(container);
  }, first.id);
  assert.equal(disposed.status, "disposed");
  const second = await mount({
    renderer: "webgpu",
    camera: { fov: 40, position: [0, 0, 4], lookAt: [0, 0, 0] },
    texts: [{ id: "cycle", text: "B", font: DATA_FONT_URL, size: 0.4 }],
  });
  assert.equal(second.status, "ready");
  assert.ok((await readFrame(second.id)).opaque > 0);
});
