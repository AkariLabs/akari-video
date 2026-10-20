// texts[].billboard / screenSpace を実ブラウザ（headless Chrome + SwiftShader）で検証する。
//
//   1. 宣言検証: 真偽値以外は初期化エラー、省略時は既定 false（既存の宣言と同じ絵）
//   2. billboard: 斜めのカメラでもテキストの法線（+Z）がカメラ方向を向く。ロール無し
//      （局所 +X が水平 = 画面の上はワールド +Y に近い）
//   3. screenSpace: 距離が 2 倍でも group.scale が 2 倍になり、画面上の文字の高さが変わらない
//   4. extrude でも同じコードパスで効く（flat と同じ flag 解決）
//
//   AKARI_TEST_CHROME_PATH=<chrome> node packages/overlay-runtime/test-harness/three-text-billboard.test.mjs
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
// opentype 経路は fetch() でフォントを読むため file: では取得できない（Chrome の制約）。
// data: なら同じ 1 ファイルを埋め込める（extrude の flag 解決だけを見るテスト用）
const EXTRUDE_FONT_URL = `data:font/ttf;base64,${readFileSync(
  join(HERE, "fonts/ZenKakuGothicNew-Black.ttf")
).toString("base64")}`;
const require = createRequire(`${resolve(HERE, "../../render-cut")}/`);
const tempDir = mkdtempSync(join(tmpdir(), "akari-three-text-billboard-"));
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
    const deadline = Date.now() + 20_000;
    for (;;) {
      const status = window.akari.threeRuntime.inspect(container).status;
      if (status === "ready" || status === "error" || status === "disposed") return { id, status };
      if (Date.now() > deadline) return { id, status: "timeout" };
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }, { descriptorValue: descriptor, defaultFontUrl: FONT_URL });
}

async function draw(id, seconds = 0) {
  return page.evaluate(({ containerId, time }) => {
    const container = document.getElementById(containerId);
    window.akari.threeRuntime.render(container, time);
    const canvas = container.querySelector("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let minY = canvas.height;
    let maxY = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    return {
      pixelHeight: maxY >= minY ? maxY - minY + 1 : 0,
      runtime: window.akari.threeRuntime.inspect(container),
    };
  }, { containerId: id, time: seconds });
}

function applyQuaternion(quaternion, [x, y, z]) {
  const [qx, qy, qz, qw] = quaternion;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
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

test("texts[].billboard rejects non-boolean values", async () => {
  const error = await page.evaluate((descriptorValue) => {
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
  }, {
    texts: [{ id: "title", text: "斜", font: FONT_URL, billboard: "yes" }],
  });
  assert.match(error, /billboard は真偽値である必要があります/u);
});

test("texts[].screenSpace rejects non-boolean values", async () => {
  const error = await page.evaluate((descriptorValue) => {
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
  }, {
    texts: [{ id: "title", text: "斜", font: FONT_URL, screenSpace: 1 }],
  });
  assert.match(error, /screenSpace は真偽値である必要があります/u);
});

test("omitting billboard / screenSpace keeps the legacy geometry", async () => {
  const omitted = await mount({
    camera: { fov: 40, position: [0, 0, 4], lookAt: [0, 0, 0] },
    texts: [{ id: "label", text: "ABC", font: FONT_URL, size: 1 }],
  });
  const explicit = await mount({
    camera: { fov: 40, position: [0, 0, 4], lookAt: [0, 0, 0] },
    texts: [{ id: "label", text: "ABC", font: FONT_URL, size: 1, billboard: false, screenSpace: false }],
  });
  assert.equal(omitted.status, "ready");
  assert.equal(explicit.status, "ready");
  const before = await draw(omitted.id);
  const after = await draw(explicit.id);
  assert.equal(before.runtime.texts[0].billboard, false);
  assert.equal(before.runtime.texts[0].screenSpace, false);
  assert.deepEqual(after.runtime.texts[0].worldQuaternion, before.runtime.texts[0].worldQuaternion);
  assert.deepEqual(after.runtime.texts[0].scale, before.runtime.texts[0].scale);
  assert.equal(after.pixelHeight, before.pixelHeight);
});

test("billboard faces an oblique camera without roll", async () => {
  const mounted = await mount({
    camera: { fov: 40, position: [3, 2, 4], lookAt: [0, 0, 0] },
    texts: [{ id: "label", text: "ABC", font: FONT_URL, size: 1, billboard: true }],
  });
  assert.equal(mounted.status, "ready");
  const frame = await draw(mounted.id);
  const group = frame.runtime.texts[0];
  assert.equal(group.billboard, true);
  const expected = [3, 2, 4].map((value) => value / Math.hypot(3, 2, 4));
  const dot = group.normal.reduce((sum, value, index) => sum + value * expected[index], 0);
  console.log("[three-billboard-orientation]", JSON.stringify({
    normal: group.normal, expected, dot,
  }));
  assert.ok(dot > 0.999, `normal ${JSON.stringify(group.normal)} does not face camera ${JSON.stringify(expected)}`);
  const localX = applyQuaternion(group.worldQuaternion, [1, 0, 0]);
  assert.ok(Math.abs(localX[1]) < 1e-6, `local +X must stay horizontal (no roll), got ${JSON.stringify(localX)}`);
  const localY = applyQuaternion(group.worldQuaternion, [0, 1, 0]);
  assert.ok(localY[1] > 0.9, `local +Y must point up, got ${JSON.stringify(localY)}`);
  // 同じ t・同じカメラで同じ絵（決定論）
  const again = await draw(mounted.id);
  assert.deepEqual(again.runtime.texts[0].worldQuaternion, group.worldQuaternion);
});

test("layout.rotation is overridden by billboard", async () => {
  const mounted = await mount({
    camera: { fov: 40, position: [4, 0, 0], lookAt: [0, 0, 0] },
    texts: [{
      id: "label", text: "ABC", font: FONT_URL, size: 1, billboard: true,
      layout: { rotation: [0, 0.6, 0] },
    }],
  });
  assert.equal(mounted.status, "ready");
  const group = (await draw(mounted.id)).runtime.texts[0];
  assert.ok(group.normal[0] > 0.999, `normal must follow the camera, got ${JSON.stringify(group.normal)}`);
});

test("screenSpace doubles scale when the camera depth doubles and keeps pixel height", async () => {
  const near = await mount({
    camera: { fov: 40, position: [0, 0, 4], lookAt: [0, 0, 0] },
    texts: [{ id: "label", text: "ABC", font: FONT_URL, size: 40, screenSpace: true }],
  });
  const far = await mount({
    camera: { fov: 40, position: [0, 0, 8], lookAt: [0, 0, 0] },
    texts: [{ id: "label", text: "ABC", font: FONT_URL, size: 40, screenSpace: true }],
  });
  assert.equal(near.status, "ready");
  assert.equal(far.status, "ready");
  const nearFrame = await draw(near.id);
  const farFrame = await draw(far.id);
  const nearScale = nearFrame.runtime.texts[0].scale[1];
  const farScale = farFrame.runtime.texts[0].scale[1];
  console.log("[three-screen-space-measurement]", JSON.stringify({
    nearScale, farScale, nearPixelHeight: nearFrame.pixelHeight, farPixelHeight: farFrame.pixelHeight,
  }));
  assert.ok(Math.abs(farScale / nearScale - 2) < 0.01, `scale ratio ${farScale / nearScale} != 2`);
  assert.ok(nearFrame.pixelHeight > 0);
  assert.ok(Math.abs(farFrame.pixelHeight / nearFrame.pixelHeight - 1) < 0.03,
    `pixel height changed: ${nearFrame.pixelHeight} -> ${farFrame.pixelHeight}`);
});

test("without screenSpace the rendered label shrinks with distance", async () => {
  const near = await mount({
    camera: { fov: 40, position: [0, 0, 4], lookAt: [0, 0, 0] },
    texts: [{ id: "label", text: "ABC", font: FONT_URL, size: 1 }],
  });
  const far = await mount({
    camera: { fov: 40, position: [0, 0, 8], lookAt: [0, 0, 0] },
    texts: [{ id: "label", text: "ABC", font: FONT_URL, size: 1 }],
  });
  const nearHeight = (await draw(near.id)).pixelHeight;
  const farHeight = (await draw(far.id)).pixelHeight;
  console.log("[three-screen-space-legacy]", JSON.stringify({ nearHeight, farHeight, ratio: farHeight / nearHeight }));
  assert.ok(farHeight / nearHeight < 0.55, `expected shrink, got ${farHeight / nearHeight}`);
});

test("extrude texts use the same billboard flag resolution", async () => {
  const mounted = await mount({
    camera: { fov: 40, position: [3, 2, 4], lookAt: [0, 0, 0] },
    texts: [{
      id: "label", text: "AB", font: EXTRUDE_FONT_URL, size: 1, mode: "extrude", billboard: true,
    }],
  });
  assert.equal(mounted.status, "ready");
  const group = (await draw(mounted.id)).runtime.texts[0];
  const expected = [3, 2, 4].map((value) => value / Math.hypot(3, 2, 4));
  const dot = group.normal.reduce((sum, value, index) => sum + value * expected[index], 0);
  assert.ok(dot > 0.999);
});
