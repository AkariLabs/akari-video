import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const SRC = join(PACKAGE_ROOT, "src");
const BASE = "8cb6b07c492bc5ed5f8badb0f131ca021e299959";
const FONT_URL = pathToFileURL(join(HERE, "fonts/ZenKakuGothicNew-Black.ttf")).href;
const tempDir = mkdtempSync(join(tmpdir(), "akari-three-fog-background-"));
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
    process.env.CHROME_PATH,
    ...cached,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const chrome = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!chrome) throw new Error("headless Chrome が見つかりません");
  return chrome;
}

function buildGlb() {
  const positions = new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]);
  const normals = new Float32Array([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
  ]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const chunks = [positions, normals, indices].map((array) =>
    Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  const offsets = [];
  let byteOffset = 0;
  for (const chunk of chunks) {
    offsets.push(byteOffset);
    byteOffset += chunk.length;
  }
  const binary = Buffer.concat(chunks);
  const gltf = {
    asset: { version: "2.0", generator: "akari-video fog/background test fixture" },
    extensionsUsed: ["KHR_materials_unlit"],
    buffers: [{ byteLength: binary.length }],
    bufferViews: chunks.map((chunk, index) => ({
      buffer: 0,
      byteOffset: offsets[index],
      byteLength: chunk.length,
      target: index === 2 ? 34963 : 34962,
    })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0] },
      { bufferView: 1, componentType: 5126, count: 4, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: 6, type: "SCALAR" },
    ],
    materials: [{
      name: "White",
      doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
      extensions: { KHR_materials_unlit: {} },
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    nodes: [
      { mesh: 0, translation: [-1.2, 0, 1] },
      { mesh: 0, translation: [3.6, 0, -7], scale: [3, 3, 3] },
    ],
    scenes: [{ nodes: [0, 1] }],
    scene: 0,
  };
  const jsonBytes = Buffer.from(JSON.stringify(gltf), "utf8");
  const paddedJson = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 0x20)]);
  const paddedBinary = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
  const totalLength = 12 + 8 + paddedJson.length + 8 + paddedBinary.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(paddedJson.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(paddedBinary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, paddedJson, binaryHeader, paddedBinary]);
}

const MODEL_DATA_URI = `data:model/gltf-binary;base64,${buildGlb().toString("base64")}`;

function inline(source) {
  return source.replaceAll("</script", "<\\/script");
}

function harnessHtml(runtime) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent}.scene{position:relative;width:256px;height:144px}
    .fragment,canvas{position:absolute;inset:0;width:100%;height:100%}canvas{display:block}
  </style>
  <script>${inline(readFileSync(join(SRC, "vendor/three-bundle.js"), "utf8"))}</script>
  <script>${inline(readFileSync(join(SRC, "vendor/vendor-3d-text-bundle.js"), "utf8"))}</script>
  <script>${inline(runtime)}</script></head><body><main id="stage"></main></body></html>`;
}

async function openRuntimePage(runtime, name) {
  const htmlPath = join(tempDir, `${name}.html`);
  writeFileSync(htmlPath, harnessHtml(runtime), "utf8");
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 480, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  await page.evaluate((fontUrl) => window.akari.threeRuntime.configure({ defaultFontUrl: fontUrl }), FONT_URL);
  return page;
}

async function mount(page, descriptor, id) {
  return page.evaluate(async ({ descriptorValue, sceneId }) => {
    const container = document.createElement("div");
    container.id = sceneId;
    container.className = "scene";
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
      if (status === "ready" || status === "error" || Date.now() > deadline) {
        window.akari.threeRuntime.render(container, 0);
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }, { descriptorValue: descriptor, sceneId: id });
}

function md5(buffer) {
  return createHash("md5").update(buffer).digest("hex");
}

before(async () => {
  browser = await loadPuppeteer().launch({
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
});

after(async () => {
  const process = browser?.process();
  if (process) process.kill("SIGKILL");
  else await browser?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("fog/background omission is pixel-identical to the base runtime for glb and texts", async () => {
  const baseRuntime = execFileSync(
    "git",
    ["show", `${BASE}:packages/overlay-runtime/src/three-runtime.js`],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  const currentRuntime = readFileSync(join(SRC, "three-runtime.js"), "utf8");
  const basePage = await openRuntimePage(baseRuntime, "base");
  const currentPage = await openRuntimePage(currentRuntime, "current");
  const fixtures = {
    glb: {
      model: MODEL_DATA_URI,
      camera: { fov: 40, position: [0, 0.5, 3], lookAt: [0, 0.5, 0] },
    },
    texts: {
      camera: { fov: 40, position: [0, 0, 4] },
      texts: [{
        id: "title",
        text: "時間窓",
        window: { start: 1, duration: 2 },
        mode: "flat",
        size: 1,
        color: "#ffd166",
        layout: { type: "line", spacing: 1.1 },
      }],
    },
  };
  for (const [name, descriptor] of Object.entries(fixtures)) {
    assert.equal(await mount(basePage, descriptor, name), "ready");
    assert.equal(await mount(currentPage, descriptor, name), "ready");
    if (name === "texts") {
      await basePage.evaluate((id) => window.akari.threeRuntime.render(document.getElementById(id), 1.5), name);
      await currentPage.evaluate((id) => window.akari.threeRuntime.render(document.getElementById(id), 1.5), name);
    }
    const basePng = await (await basePage.$(`#${name} canvas`)).screenshot({ type: "png" });
    const currentPng = await (await currentPage.$(`#${name} canvas`)).screenshot({ type: "png" });
    const baseMd5 = md5(basePng);
    const currentMd5 = md5(currentPng);
    console.log(`[three-fog-background-parity] ${name} base=${baseMd5} current=${currentMd5}`);
    assert.equal(currentMd5, baseMd5, `${name} PNG must be byte-identical to ${BASE}`);
  }
  await basePage.close();
  await currentPage.close();
});

test("background changes the center pixel and fog moves the far plate toward fog.color", async () => {
  const page = await openRuntimePage(readFileSync(join(SRC, "three-runtime.js"), "utf8"), "effect");
  const camera = { fov: 50, position: [0, 0, 5], lookAt: [0, 0, 0] };
  const backgroundCamera = { fov: 50, position: [0, 0, 5], lookAt: [50, 0, 5] };
  assert.equal(await mount(page, { model: MODEL_DATA_URI, camera: backgroundCamera }, "transparent"), "ready");
  assert.equal(await mount(page, {
    model: MODEL_DATA_URI,
    camera: backgroundCamera,
    background: { color: "#1640ff" },
  }, "background"), "ready");
  const backgroundPixels = await page.evaluate(() => {
    const readCenter = (id) => {
      window.akari.threeRuntime.render(document.getElementById(id), 0);
      const canvas = document.querySelector(`#${id} canvas`);
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      const pixel = new Uint8Array(4);
      gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    };
    return { transparent: readCenter("transparent"), background: readCenter("background") };
  });
  assert.notDeepEqual(backgroundPixels.background, backgroundPixels.transparent);

  assert.equal(await mount(page, {
    model: MODEL_DATA_URI,
    camera,
    fog: { color: "#ff0000", near: 1, far: 14 },
  }, "fog"), "ready");
  const fogPixels = await page.evaluate(() => {
    const THREE = window.AkariThree.THREE;
    const nearCenter = new THREE.Vector3(-1.2, 0, 1);
    const farCenter = new THREE.Vector3(3.6, 0, -7);
    window.akari.threeRuntime.render(document.getElementById("fog"), 0);
    const canvas = document.querySelector("#fog canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const cameraNode = new THREE.PerspectiveCamera(50, canvas.width / canvas.height, 0.1, 2000);
    cameraNode.position.set(0, 0, 5);
    cameraNode.lookAt(0, 0, 0);
    cameraNode.updateMatrixWorld();
    cameraNode.updateProjectionMatrix();
    const readWorld = (world) => {
      const projected = world.clone().project(cameraNode);
      const x = Math.round((projected.x * 0.5 + 0.5) * (canvas.width - 1));
      const y = Math.round((projected.y * 0.5 + 0.5) * (canvas.height - 1));
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    };
    return { near: readWorld(nearCenter), far: readWorld(farCenter) };
  });
  const distanceToRed = ([r, g, b]) => Math.hypot(255 - r, g, b);
  console.log(`[three-fog-background-effect] ${JSON.stringify({ backgroundPixels, fogPixels })}`);
  assert.ok(
    distanceToRed(fogPixels.far) < distanceToRed(fogPixels.near),
    `far=${fogPixels.far} must be closer to fog red than near=${fogPixels.near}`,
  );
  await page.close();
});

test("invalid fog/background declarations fail with TypeError", async () => {
  const page = await openRuntimePage(readFileSync(join(SRC, "three-runtime.js"), "utf8"), "validation");
  const invalid = [
    ["color non-hex", { background: { color: "red" } }],
    ["near >= far", { fog: { color: "#ffffff", near: 4, far: 4 } }],
    ["negative density", { fog: { color: "#ffffff", density: -0.1 } }],
    ["fog array", { fog: [] }],
    ["background unknown key", { background: { color: "#ffffff", alpha: 1 } }],
  ];
  for (const [name, partial] of invalid) {
    const result = await page.evaluate(({ descriptor, id }) => {
      const captured = [];
      const originalError = console.error;
      console.error = (...args) => captured.push({
        typeError: args.some((value) => value instanceof TypeError),
        message: args.map((value) => value?.message ?? String(value)).join(" "),
      });
      const container = document.createElement("div");
      container.id = id;
      container.className = "scene";
      const root = document.createElement("div");
      root.className = "fragment";
      root.innerHTML = '<canvas></canvas><script type="application/json" data-akari-3d-scene></script>';
      root.querySelector("script").textContent = JSON.stringify({ model: descriptor.model, ...descriptor.partial });
      container.appendChild(root);
      document.getElementById("stage").appendChild(container);
      window.akari.threeRuntime.render(container, 0);
      console.error = originalError;
      return { captured, status: window.akari.threeRuntime.inspect(container).status };
    }, { descriptor: { model: MODEL_DATA_URI, partial }, id: `invalid-${name.replaceAll(" ", "-")}` });
    assert.equal(result.status, "error", `${name} must fail validation`);
    assert.equal(result.captured.length, 1, `${name} must report one initialization error`);
    assert.equal(result.captured[0].typeError, true, `${name} must report TypeError`);
  }
  await page.close();
});
