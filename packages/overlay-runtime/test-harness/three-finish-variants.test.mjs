import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const RUNTIME = readFileSync(join(SRC, "three-runtime.js"), "utf8");
const GREEN_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M/wHwAEAQH/cetH5QAAAABJRU5ErkJggg==";

function readDescriptorForTest(descriptor) {
  const window = {};
  const source = RUNTIME.replace("  return {\n    configure,", "  return {\n    readDescriptor,\n    configure,");
  runInNewContext(source, { window });
  const declaration = { textContent: JSON.stringify(descriptor) };
  const container = {
    childElementCount: 1,
    querySelectorAll: (selector) => selector.startsWith("script:not") ? [] : [declaration],
  };
  return window.akari.threeRuntime.readDescriptor(container);
}

const VALID_FINISHES = {
  default: "silver",
  options: { silver: { FrameMat: { color: "#aabbcc", roughness: 0.25 } } },
};

test("finishes descriptor rejects malformed declarations", () => {
  const cases = [
    { ...VALID_FINISHES, extra: true },
    { ...VALID_FINISHES, options: { silver: { FrameMat: { opacity: 0.5 } } } },
    { ...VALID_FINISHES, options: { silver: { FrameMat: { color: "#fff" } } } },
    { ...VALID_FINISHES, options: { silver: { FrameMat: { roughness: 1.01 } } } },
    { ...VALID_FINISHES, default: "orange" },
    { ...VALID_FINISHES, options: {} },
    { ...VALID_FINISHES, var: "finish" },
    { ...VALID_FINISHES, options: { "bad value": {} } },
  ];
  for (const finishes of cases) {
    assert.throws(() => readDescriptorForTest({ model: "model.glb", finishes }),
      (error) => error.name === "TypeError" && /finishes/.test(error.message));
  }
  assert.equal(readDescriptorForTest({ model: "model.glb", finishes: VALID_FINISHES }).finishes.default, "silver");
});

test("materialOverrides does not accept emissive", () => {
  assert.throws(() => readDescriptorForTest({
    model: "model.glb",
    materialOverrides: { FrameMat: { texture: "green.png", emissive: "#ffffff" } },
  }), (error) => error.name === "TypeError" && /materialOverrides/.test(error.message));
});

function buildGlb() {
  const arrays = [
    new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    new Uint16Array([0, 1, 2, 0, 2, 3]),
  ];
  const chunks = arrays.map((array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  const offsets = [];
  let offset = 0;
  for (const chunk of chunks) { offsets.push(offset); offset += chunk.length; }
  const binary = Buffer.concat(chunks);
  const gltf = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: binary.length }],
    bufferViews: chunks.map((chunk, index) => ({
      buffer: 0, byteOffset: offsets[index], byteLength: chunk.length,
      target: index === 3 ? 34963 : 34962,
    })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 4, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 4, type: "VEC2" },
      { bufferView: 3, componentType: 5123, count: 6, type: "SCALAR" },
    ],
    materials: [{
      name: "FrameMat", doubleSided: true, emissiveFactor: [0, 0, 0],
      pbrMetallicRoughness: { baseColorFactor: [0.3, 0.3, 0.3, 1], metallicFactor: 0, roughnessFactor: 1 },
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  };
  const json = Buffer.from(JSON.stringify(gltf));
  const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const binPadded = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]);
}

function loadPuppeteer() {
  const roots = [resolve(HERE, "../../render-cut")];
  const gitFile = resolve(HERE, "../../../.git");
  if (existsSync(gitFile) && statSync(gitFile).isFile()) {
    const gitDir = readFileSync(gitFile, "utf8").trim().replace(/^gitdir:\s*/, "");
    const marker = `${join(".git", "worktrees")}/`;
    const index = gitDir.indexOf(marker);
    if (index >= 0) roots.push(join(gitDir.slice(0, index), "packages/render-cut"));
  }
  for (const root of roots) {
    try { return createRequire(`${root}/`)("puppeteer-core"); } catch { /* Try the next package root. */ }
  }
  throw new Error("puppeteer-core を解決できません");
}

function findChrome() {
  const cacheRoot = join(homedir(), ".cache/puppeteer/chrome-headless-shell");
  const cached = [];
  if (existsSync(cacheRoot)) {
    for (const build of readdirSync(cacheRoot).sort().reverse()) {
      const buildPath = join(cacheRoot, build);
      if (!statSync(buildPath).isDirectory()) continue;
      for (const platform of readdirSync(buildPath)) {
        cached.push(join(buildPath, platform, "chrome-headless-shell"));
      }
    }
  }
  return [process.env.AKARI_TEST_CHROME_PATH, process.env.CHROME_PATH, ...cached]
    .find((candidate) => candidate && existsSync(candidate))
    ?? (() => { throw new Error("headless Chrome が見つかりません"); })();
}

test("finishes switch, restore, and coexist with materialOverrides in the browser", async (t) => {
  const model = `data:model/gltf-binary;base64,${buildGlb().toString("base64")}`;
  const finishes = {
    default: "silver",
    options: {
      silver: { FrameMat: { color: "#cccccc", roughness: 0.25, emissive: "#000000" } },
      orange: { FrameMat: { color: "#ff6600", emissive: "#000000" } },
    },
  };
  const scene = (id, extra = {}) => `<div id="${id}"><div><canvas></canvas><script type="application/json" data-akari-3d-scene>${JSON.stringify({
    model, camera: { fov: 40, position: [0, 0, 3], lookAt: [0, 0, 0] },
    lights: [{ type: "ambient", intensity: 2 }], ...extra,
  })}</script></div></div>`;
  const inline = (source) => source.replaceAll("</script", "<\\/script");
  const html = `<!doctype html><html><head><style>canvas{width:96px;height:96px}</style>
    <script>${inline(readFileSync(join(SRC, "vendor/three-bundle.js"), "utf8"))}</script>
    <script>${inline(RUNTIME)}</script></head><body>
    ${scene("first", { finishes })}${scene("second", { finishes })}
    ${scene("override", { materialOverrides: { FrameMat: { texture: GREEN_PNG, brightness: 0.5 } },
      finishes: { default: "green", options: { green: { FrameMat: { color: "#101010", emissive: "#ffffff" } } } } })}
    ${scene("missing", { finishes: { default: "silver", options: {
      silver: { MissingMat: { color: "#ffffff" }, FrameMat: { color: "#223344" } },
      orange: { FrameMat: { color: "#ff6600" } },
    } } })}
    ${scene("legacy")}</body></html>`;

  const browser = await loadPuppeteer().launch({
    executablePath: findChrome(), headless: "shell", pipe: true,
    dumpio: process.env.AKARI_TEST_BROWSER_DUMPIO === "1",
    args: ["--no-sandbox", "--no-zygote", "--single-process", "--disable-gpu",
      "--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 480, height: 500, deviceScaleFactor: 1 });
  await page.setContent(html);
  const result = await page.evaluate(async () => {
    const runtime = window.akari.threeRuntime;
    runtime.configurePremount({});
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(" ")); originalWarn(...args); };
    const containers = Object.fromEntries(["first", "second", "override", "missing", "legacy"]
      .map((id) => [id, document.getElementById(id)]));
    for (const container of Object.values(containers)) runtime.render(container, 0);
    const deadline = Date.now() + 15000;
    while (Object.values(containers).some((container) => runtime.inspect(container).status === "loading")) {
      if (Date.now() > deadline) throw new Error("3D model loading timed out");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const observe = (id) => {
      const container = containers[id];
      runtime.render(container, 0);
      const inspected = runtime.inspect(container);
      const canvas = container.querySelector("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      const pixel = new Uint8Array(4);
      gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return { inspected, pixel: [...pixel] };
    };
    const first = observe("first");
    const second = observe("second");
    const override = observe("override");
    const missing = observe("missing");
    const missingCanvas = containers.missing.querySelector("canvas");
    missingCanvas.style.setProperty("--akari-3d-finish", "orange");
    observe("missing");
    missingCanvas.style.setProperty("--akari-3d-finish", "silver");
    const missingAgain = observe("missing");
    const legacy = observe("legacy");
    const canvas = containers.first.querySelector("canvas");
    canvas.style.setProperty("--akari-3d-finish", '"orange"');
    const orange = observe("first");
    const stillSilver = observe("second");
    canvas.style.setProperty("--akari-3d-finish", "silver");
    const restored = observe("first");
    canvas.style.setProperty("--akari-3d-finish", "unknown");
    const unknownFirst = observe("first");
    const unknownSecond = observe("first");
    containers.legacy.querySelector("canvas").style.setProperty("--akari-3d-finish", "orange");
    const legacyAfter = observe("legacy");
    console.warn = originalWarn;
    return { first, second, override, missing, missingAgain, legacy, orange, stillSilver,
      restored, unknownFirst, unknownSecond, legacyAfter, warnings };
  });
  for (const id of ["first", "second", "override", "missing", "legacy"]) {
    assert.equal(result[id].inspected.status, "ready", `${id} should load`);
  }
  assert.equal(result.first.inspected.finish.selected, "silver");
  assert.equal(result.first.inspected.materials[0].color, "#cccccc");
  assert.equal(result.orange.inspected.finish.selected, "orange");
  assert.equal(result.orange.inspected.materials[0].color, "#ff6600");
  assert.notDeepEqual(result.orange.pixel, result.first.pixel);
  assert.equal(result.orange.inspected.materials[0].roughness, 1);
  assert.equal(result.stillSilver.inspected.materials[0].color, "#cccccc");
  assert.equal(result.restored.inspected.materials[0].color, "#cccccc");
  assert.equal(result.restored.inspected.materials[0].roughness, 0.25);
  assert.equal(result.unknownFirst.inspected.finish.selected, "silver");
  assert.deepEqual(result.unknownSecond.pixel, result.unknownFirst.pixel);
  assert.equal(result.warnings.filter((message) => message.includes("finishes の未知の選択値")).length, 1);
  assert.equal(result.override.inspected.materialOverrides[0].applied, true);
  assert.equal(result.override.inspected.materialOverrides[0].brightness, 0.5);
  assert.equal(result.override.inspected.materials[0].emissive, "#ffffff");
  assert.equal(result.override.inspected.materials[0].color, "#101010");
  assert.equal(result.override.inspected.materials[0].emissiveIntensity, 0.5);
  assert.ok(result.override.pixel[1] > result.override.pixel[0], `emissiveMap should remain green: ${result.override.pixel}`);
  assert.equal(result.missing.inspected.materials[0].color, "#223344");
  assert.deepEqual(result.missing.inspected.finish.applied[0], { material: "MissingMat", applied: false });
  assert.equal(result.missing.inspected.finish.applied[1].applied, true);
  assert.equal(result.missingAgain.inspected.materials[0].color, "#223344");
  assert.equal(result.warnings.filter((message) => message.includes("finishes の対象が見つかりません: MissingMat")).length, 1);
  assert.equal(result.legacy.inspected.finish, null);
  assert.equal(result.legacyAfter.inspected.finish, null);
  assert.deepEqual(result.legacyAfter.inspected.materials, result.legacy.inspected.materials);
});
