// materialOverrides の画面差し込みツマミを実ブラウザ（headless Chrome + SwiftShader）で検証する。
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const ORIGINAL_EMISSIVE_INTENSITY = 1.5;
const RED_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const GREEN_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M/wHwAEAQH/cetH5QAAAABJRU5ErkJggg==",
  "base64",
);
// CSS 宣言値ではセミコロンが区切りになるため、CSS 変数側だけ percent-encoded data URI にする。
const GREEN_PNG = `data:image/png,${[...GREEN_PNG_BYTES]
  .map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join("")}`;

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

function buildScreenGlb() {
  const positions = new Float32Array([
    -1, -0.5, 0, 1, -0.5, 0, 1, 1.5, 0, -1, 1.5, 0,
  ]);
  const normals = new Float32Array([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const chunks = [positions, normals, uvs, indices].map((array) =>
    Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  const offsets = [];
  let byteOffset = 0;
  for (const chunk of chunks) {
    offsets.push(byteOffset);
    byteOffset += chunk.length;
  }
  const binary = Buffer.concat(chunks);
  const gltf = {
    asset: { version: "2.0", generator: "akari-video three-screen-knobs test fixture" },
    extensionsUsed: ["KHR_materials_emissive_strength"],
    buffers: [{ byteLength: binary.length }],
    bufferViews: chunks.map((chunk, index) => ({
      buffer: 0,
      byteOffset: offsets[index],
      byteLength: chunk.length,
      target: index === 3 ? 34963 : 34962,
    })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [-1, -0.5, 0], max: [1, 1.5, 0] },
      { bufferView: 1, componentType: 5126, count: 4, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 4, type: "VEC2" },
      { bufferView: 3, componentType: 5123, count: 6, type: "SCALAR" },
    ],
    materials: [{
      name: "ScreenMaterial",
      doubleSided: true,
      emissiveFactor: [1, 1, 1],
      pbrMetallicRoughness: { baseColorFactor: [0, 0, 0, 1], metallicFactor: 0, roughnessFactor: 1 },
      extensions: { KHR_materials_emissive_strength: { emissiveStrength: ORIGINAL_EMISSIVE_INTENSITY } },
    }],
    meshes: [{
      name: "ScreenMesh",
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }],
    }],
    nodes: [{ name: "Screen", mesh: 0 }],
    scenes: [{ nodes: [0] }],
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

const MODEL_DATA_URI = `data:model/gltf-binary;base64,${buildScreenGlb().toString("base64")}`;

function scene(id, override) {
  const descriptor = {
    model: MODEL_DATA_URI,
    camera: { fov: 40, position: [0, 0.5, 3], lookAt: [0, 0.5, 0] },
    materialOverrides: { ScreenMaterial: override },
  };
  return `<div id="${id}" class="scene-content"><div class="fragment-root"><canvas></canvas>`
    + `<script type="application/json" data-akari-3d-scene>${JSON.stringify(descriptor)}</script></div></div>`;
}

function buildHtml() {
  const bundle = readFileSync(join(SRC, "vendor/three-bundle.js"), "utf8");
  const runtime = readFileSync(join(SRC, "three-runtime.js"), "utf8");
  const inlineScript = (source) => source.replaceAll("</script", "<\\/script");
  const scenes = [
    scene("literal", { texture: RED_PNG }),
    scene("texture-var", { texture: RED_PNG, textureVar: "--screen-src" }),
    scene("texture-var-empty", { texture: RED_PNG, textureVar: "--screen-src" }),
    scene("texture-direct-var", { texture: "var(--screen-src)" }),
    scene("texture-direct-empty", { texture: "var(--screen-src)" }),
    scene("brightness-half", { texture: RED_PNG, brightness: 0.5 }),
    scene("brightness-double", { texture: RED_PNG, brightness: 2 }),
    scene("brightness-var", { texture: RED_PNG, brightness: "var(--screen-brightness)" }),
    scene("bad-brightness-string", { texture: RED_PNG, brightness: "bright" }),
    scene("bad-brightness-range", { texture: RED_PNG, brightness: 9 }),
    scene("bad-brightness-type", { texture: RED_PNG, brightness: true }),
  ].join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#222}.scene-content{position:relative;width:128px;height:128px}
    canvas{display:block;width:128px;height:128px}
  </style><script>${inlineScript(bundle)}</script><script>${inlineScript(runtime)}</script></head>
  <body>${scenes}</body></html>`;
}

test("three-runtime resolves material override screen knobs without changing literal overrides", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "three-screen-knobs-"));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));
  const htmlPath = join(tempDir, "index.html");
  writeFileSync(htmlPath, buildHtml(), "utf8");

  const browser = await loadPuppeteer().launch({
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
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error(`[page.error] ${error}`));
  await page.setViewport({ width: 320, height: 240, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  await page.evaluate(({ green }) => {
    document.querySelector("#texture-var canvas").style.setProperty("--screen-src", green);
    document.querySelector("#texture-direct-var canvas").style.setProperty("--screen-src", green);
    document.querySelector("#brightness-var canvas").style.setProperty("--screen-brightness", "2");
  }, { green: GREEN_PNG });

  const observe = (id) => page.evaluate(async (sceneId) => {
    const container = document.getElementById(sceneId);
    window.akari.threeRuntime.render(container, 0);
    const deadline = Date.now() + 15_000;
    for (;;) {
      const inspected = window.akari.threeRuntime.inspect(container);
      if (inspected.status === "ready" || inspected.status === "error" || inspected.status === "disposed"
        || Date.now() > deadline) {
        window.akari.threeRuntime.render(container, 0);
        const canvas = container.querySelector("canvas");
        const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
        const pixel = new Uint8Array(4);
        if (gl) gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return { inspected: window.akari.threeRuntime.inspect(container), pixel: [...pixel] };
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }, id);

  const literal = await observe("literal");
  assert.equal(literal.inspected.status, "ready");
  assert.deepEqual(literal.inspected.materialOverrides[0], {
    name: "ScreenMaterial",
    applied: true,
    resolvedFrom: "literal",
    brightness: 1,
    emissiveIntensity: ORIGINAL_EMISSIVE_INTENSITY,
    video: false,
  });
  assert.ok(literal.pixel[0] > literal.pixel[1] * 2, `literal texture should be red: ${literal.pixel}`);

  const textureVar = await observe("texture-var");
  assert.equal(textureVar.inspected.materialOverrides[0].resolvedFrom, "cssVar");
  assert.ok(textureVar.pixel[1] > textureVar.pixel[0] + 30, `textureVar texture should be green: ${textureVar.pixel}`);

  const textureVarEmpty = await observe("texture-var-empty");
  assert.equal(textureVarEmpty.inspected.materialOverrides[0].resolvedFrom, "literal");
  assert.ok(textureVarEmpty.pixel[0] > textureVarEmpty.pixel[1] * 2, `empty textureVar should use red fallback: ${textureVarEmpty.pixel}`);

  const directVar = await observe("texture-direct-var");
  assert.equal(directVar.inspected.materialOverrides[0].resolvedFrom, "cssVar");
  assert.ok(directVar.pixel[1] > directVar.pixel[0] + 30, `texture var() should resolve green: ${directVar.pixel}`);

  const directEmpty = await observe("texture-direct-empty");
  assert.deepEqual(directEmpty.inspected.materialOverrides[0], {
    name: "ScreenMaterial",
    applied: false,
    resolvedFrom: "unresolved",
    brightness: 1,
    emissiveIntensity: null,
    video: false,
  });
  assert.ok(
    Math.abs(directEmpty.pixel[0] - directEmpty.pixel[1]) < 8,
    `unresolved texture should leave the original white emissive material: ${directEmpty.pixel}`,
  );

  const half = await observe("brightness-half");
  const double = await observe("brightness-double");
  const variable = await observe("brightness-var");
  assert.equal(half.inspected.materialOverrides[0].emissiveIntensity, ORIGINAL_EMISSIVE_INTENSITY * 0.5);
  assert.equal(double.inspected.materialOverrides[0].emissiveIntensity, ORIGINAL_EMISSIVE_INTENSITY * 2);
  assert.equal(variable.inspected.materialOverrides[0].brightness, 2);
  assert.equal(variable.inspected.materialOverrides[0].emissiveIntensity, ORIGINAL_EMISSIVE_INTENSITY * 2);

  for (const id of ["bad-brightness-string", "bad-brightness-range", "bad-brightness-type"]) {
    const invalid = await observe(id);
    assert.equal(invalid.inspected.status, "disposed", `${id} should fail descriptor validation`);
  }
});
