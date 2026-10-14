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

// CSS カスタムプロパティの値に ";" を含められないので、charset 指定の無い data URI にする
const svgUri = (body) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`)}`;
const LEFT_HALF = svgUri('<rect x="0" y="0" width="5" height="10" fill="#000"/>');
const FULL = svgUri('<rect x="0" y="0" width="10" height="10" fill="#f00"/>');

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

const withOverride = (override) => readDescriptorForTest({
  model: "model.glb", materialOverrides: { LogoMat: { texture: "logo.svg", ...override } },
});

test("materialOverrides target mask: valid declarations", () => {
  assert.equal(withOverride({ target: "mask" }).materialOverrides.LogoMat.target, "mask");
  assert.equal(withOverride({ target: "emissive", brightness: 2 }).materialOverrides.LogoMat.brightness, 2);
  const full = withOverride({ target: "mask", textureVar: "--logo-src", fit: 0.65, fitVar: "--logo-size" });
  assert.equal(full.materialOverrides.LogoMat.fit, 0.65);
  assert.equal(withOverride({ target: "mask", fit: 0 }).materialOverrides.LogoMat.fit, 0);
});

test("materialOverrides target mask: malformed declarations are rejected", () => {
  const cases = [
    { target: "alpha" },
    { target: "mask", fit: 1.5 },
    { target: "mask", fit: -0.1 },
    { target: "mask", fit: "0.5" },
    { target: "mask", fitVar: "logo-size" },
    { target: "mask", brightness: 2 },
    { fit: 0.5 },
    { target: "emissive", fitVar: "--logo-size" },
    { target: "mask", emissive: "#ffffff" },
  ];
  for (const override of cases) {
    assert.throws(() => withOverride(override),
      (error) => error.name === "TypeError" && /materialOverrides/.test(error.message),
      JSON.stringify(override));
  }
});

function buildGlb() {
  const arrays = [
    new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
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
      name: "LogoMat", doubleSided: true, alphaMode: "BLEND", emissiveFactor: [0, 0, 0],
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
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

test("target mask cuts the plate out with an SVG, follows fitVar, and survives a broken image", async (t) => {
  const model = `data:model/gltf-binary;base64,${buildGlb().toString("base64")}`;
  const scene = (id, override) => `<div id="${id}"><div><canvas></canvas><script type="application/json" data-akari-3d-scene>${JSON.stringify({
    model, camera: { fov: 40, position: [0, 0, 3], lookAt: [0, 0, 0] },
    lights: [{ type: "ambient", intensity: 2 }],
    materialOverrides: { LogoMat: { target: "mask", ...override } },
  })}</script></div></div>`;
  const inline = (source) => source.replaceAll("</script", "<\\/script");
  const html = `<!doctype html><html><head><style>canvas{width:96px;height:96px}</style>
    <script>${inline(readFileSync(join(SRC, "vendor/three-bundle.js"), "utf8"))}</script>
    <script>${inline(RUNTIME)}</script></head><body>
    ${scene("half", { texture: LEFT_HALF })}
    ${scene("fit", { texture: FULL, fit: 0.5, fitVar: "--mask-fit" })}
    ${scene("fitLiteral", { texture: FULL, fit: 0.5, fitVar: "--unset-fit" })}
    ${scene("broken", { texture: svgUri("<rect") })}
    ${scene("viaVar", { texture: FULL, textureVar: "--mask-src" })}</body></html>`;

  // Windows の Edge / Chrome は headless-shell でも --single-process でも起動しないので、通常の headless で起動する
  const windows = process.platform === "win32";
  const browser = await loadPuppeteer().launch({
    executablePath: findChrome(), headless: windows ? true : "shell", pipe: true,
    dumpio: process.env.AKARI_TEST_BROWSER_DUMPIO === "1",
    args: ["--no-sandbox", ...(windows ? [] : ["--no-zygote", "--single-process"]), "--disable-gpu",
      "--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 480, height: 500, deviceScaleFactor: 1 });
  await page.setContent(html);
  const result = await page.evaluate(async (leftHalf) => {
    const runtime = window.akari.threeRuntime;
    runtime.configurePremount({});
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(" ")); originalWarn(...args); };
    const ids = ["half", "fit", "fitLiteral", "broken", "viaVar"];
    const containers = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
    // 変数は mount より前に canvas へ置く（materialOverrides は mount 時に 1 回だけ読む）
    containers.fit.querySelector("canvas").style.setProperty("--mask-fit", "1");
    containers.viaVar.querySelector("canvas").style.setProperty("--mask-src", leftHalf);
    for (const container of Object.values(containers)) runtime.render(container, 0);
    const deadline = Date.now() + 15000;
    while (Object.values(containers).some((container) => runtime.inspect(container).status === "loading")) {
      if (Date.now() > deadline) throw new Error("3D model loading timed out");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const observe = (id) => {
      const container = containers[id];
      runtime.render(container, 0);
      const canvas = container.querySelector("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      const at = (fx, fy) => {
        const pixel = new Uint8Array(4);
        gl.readPixels(Math.floor(canvas.width * fx), Math.floor(canvas.height * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return [...pixel];
      };
      return { inspected: runtime.inspect(container), left: at(0.3, 0.5), right: at(0.7, 0.5), edge: at(0.15, 0.5), center: at(0.5, 0.5) };
    };
    const observed = Object.fromEntries(ids.map((id) => [id, observe(id)]));
    console.warn = originalWarn;
    return { observed, warnings };
  }, LEFT_HALF);

  for (const id of ["half", "fit", "fitLiteral", "broken", "viaVar"]) {
    assert.equal(result.observed[id].inspected.status, "ready", `${id} should load`);
  }
  // 左半分だけ不透明な SVG: 左は板の色（白 x 環境光）・右は透明（アルファ 0）
  const half = result.observed.half;
  assert.equal(half.inspected.materialOverrides[0].applied, true);
  assert.equal(half.inspected.materialOverrides[0].target, "mask");
  assert.ok(half.left[3] > 200 && half.left[0] > 100, `left should be the plate: ${half.left}`);
  assert.equal(half.right[3], 0, `right should be cut out: ${half.right}`);
  // fit: fitVar が 1 なら全面・fit 0.5 の既定なら外周が抜ける（fitVar が literal を上書きする）
  assert.equal(result.observed.fit.inspected.materialOverrides[0].fit, 1);
  assert.ok(result.observed.fit.edge[3] > 200, `fit 1 should cover the edge: ${result.observed.fit.edge}`);
  // fitVar が未設定なら literal の 0.5: 中央は埋まり外周は抜ける
  const literal = result.observed.fitLiteral;
  assert.equal(literal.inspected.materialOverrides[0].fit, 0.5);
  assert.ok(literal.center[3] > 200, `center should be filled: ${literal.center}`);
  assert.equal(literal.edge[3], 0, `edge should be cut out at fit 0.5: ${literal.edge}`);
  // 壊れた画像: シーンは落ちず、焼き込みの形（ここでは全面）が残り、警告が 1 回出る
  assert.equal(result.observed.broken.inspected.materialOverrides[0].applied, false);
  assert.equal(result.observed.broken.inspected.materialOverrides[0].resolvedFrom, "mask-error");
  assert.ok(result.warnings.some((message) => message.includes("mask を適用できません")));
  // textureVar: 変数が texture（全面）を上書きして左半分になる
  assert.equal(result.observed.viaVar.inspected.materialOverrides[0].resolvedFrom, "cssVar");
  assert.equal(result.observed.viaVar.right[3], 0);
});
