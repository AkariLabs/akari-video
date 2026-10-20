// data-akari-3d-anchor（3D 座標に追従する HTML 要素）の実ブラウザ配線を検証する。
// 投影の純関数は three-html-anchor.test.mjs。ここでは実際の Three カメラ・camera.keys・DOM 配置を通す。
//
//   - ラベルの DOM 矩形の基準点が、独立に作った Three カメラの投影位置と一致する（±0.5px）
//   - camera.keys でカメラが動いても各時刻で一致する
//   - origin（center / top-left）で基準点が変わる
//   - カメラの後ろ・画面外のラベルは visibility: hidden
//   - 同じ t を 2 回描いても同じ transform（決定論）
//
//   AKARI_TEST_CHROME_PATH=<chrome か edge> node packages/overlay-runtime/test-harness/three-html-anchor-browser.test.mjs
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const require = createRequire(`${resolve(HERE, "../../render-cut")}/`);

function puppeteerCacheCandidates() {
  const root = join(homedir(), ".cache/puppeteer/chrome-headless-shell");
  if (!existsSync(root)) return [];
  const directoriesIn = (path) =>
    readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  return directoriesIn(root)
    .sort()
    .reverse()
    .flatMap((build) => directoriesIn(join(root, build)).map((platform) => join(root, build, platform, "chrome-headless-shell")))
    .filter((candidate) => existsSync(candidate));
}

function findChrome() {
  const candidates = [
    process.env.AKARI_TEST_CHROME_PATH,
    ...puppeteerCacheCandidates(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error("headless Chrome が見つかりません（AKARI_TEST_CHROME_PATH を指定）");
}

// 箱だけの最小 glTF（カメラもアニメも持たない）。texts を使わずに ready にするための土台。
function buildGltf() {
  const h = 0.25;
  const positions = new Float32Array([
    -h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h,
    -h, -h, h, h, -h, h, h, h, h, -h, h, h,
  ]);
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
    3, 6, 2, 3, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ]);
  const chunks = [positions, indices].map((array) => Buffer.from(array.buffer));
  const views = [];
  let offset = 0;
  for (const chunk of chunks) {
    views.push({ buffer: 0, byteOffset: offset, byteLength: chunk.length });
    offset += chunk.length + ((4 - (chunk.length % 4)) % 4);
  }
  const buffer = Buffer.concat(chunks.flatMap((chunk) => [chunk, Buffer.alloc((4 - (chunk.length % 4)) % 4)]));
  const gltf = {
    asset: { version: "2.0", generator: "akari-video three-html-anchor test fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Box", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: "Box", pbrMetallicRoughness: { baseColorFactor: [0.9, 0.4, 0.1, 1] } }],
    buffers: [{ byteLength: buffer.length, uri: `data:application/octet-stream;base64,${buffer.toString("base64")}` }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: "VEC3", min: [-h, -h, -h], max: [h, h, h] },
      { bufferView: 1, componentType: 5123, count: 36, type: "SCALAR" },
    ],
  };
  return `data:model/gltf+json;base64,${Buffer.from(JSON.stringify(gltf)).toString("base64")}`;
}

const MODEL = buildGltf();
const KEYS = [
  { t: 0, position: [0, 1.4, 5], lookAt: [0, 0, 0], ease: "linear" },
  { t: 1.5, position: [4, 0.8, 3], lookAt: [0, 0, 0], ease: "linear" },
  { t: 3, position: [-4, 1.8, 2], lookAt: [0, 0, 0], ease: "linear" },
];

function buildHtml() {
  const bundle = readFileSync(join(SRC, "vendor/three-bundle.js"), "utf8");
  const runtime = readFileSync(join(SRC, "three-runtime.js"), "utf8");
  const inlineScript = (source) => source.replaceAll("</script", "<\\/script");
  const scene = { model: MODEL, camera: { fov: 40, keys: KEYS }, background: { color: "#101820" } };
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: #101820; }
  #scene { position: relative; width: 320px; height: 180px; }
  #scene canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .label { position: absolute; left: 0; top: 0; display: block; }
  #center { width: 40px; height: 20px; background: #ff00ff; }
  #topleft { width: 30px; height: 10px; background: #00ffff; }
  #behind { width: 40px; height: 20px; background: #ffff00; }
  #outside { width: 40px; height: 20px; background: #00ff00; }
  #occluded { width: 20px; height: 10px; background: #ff8800; }
</style><script>${inlineScript(bundle)}</script><script>${inlineScript(runtime)}</script></head><body>
<div id="scene"><div class="root"><canvas data-akari-3d-canvas></canvas>
  <span id="center" class="label" data-akari-3d-anchor="0,0,0"></span>
  <span id="topleft" class="label" data-akari-3d-anchor="1,0.5,0" data-akari-3d-anchor-origin="top-left"></span>
  <span id="behind" class="label" data-akari-3d-anchor="0,0,10"></span>
  <span id="outside" class="label" data-akari-3d-anchor="100,0,0"></span>
  <span id="occluded" class="label" data-akari-3d-anchor="0,0,0" data-akari-3d-anchor-occlude="true"></span>
<script type="application/json" data-akari-3d-scene>${JSON.stringify(scene)}</script></div></div>
</body></html>`;
}

async function main() {
  const puppeteer = require("puppeteer-core");
  const tempDir = mkdtempSync(join(tmpdir(), "three-html-anchor-browser-"));
  const htmlPath = join(tempDir, "harness.html");
  writeFileSync(htmlPath, buildHtml(), "utf8");
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: "shell",
    pipe: true,
    userDataDir: join(tempDir, "profile"),
    args: ["--no-sandbox", "--no-zygote", "--single-process", "--allow-file-access-from-files",
      "--disable-gpu", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  });
  const results = [];
  const check = (condition, message, detail = "") => {
    results.push({ ok: Boolean(condition), message: detail ? `${message}（${detail}）` : message });
    if (!condition) console.error(`NG: ${message} ${detail}`);
  };

  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.error(`[page.error] ${error}`));
    await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });

    const result = await page.evaluate(async (cameraKeys) => {
      const container = document.getElementById("scene");
      const runtime = window.akari.threeRuntime;
      runtime.render(container, 0);
      for (let attempt = 0; attempt < 600; attempt += 1) {
        const status = runtime.inspect(container).status;
        if (status === "ready" || status === "error") break;
        await new Promise((done) => setTimeout(done, 20));
      }
      const { THREE } = window.AkariThree;
      const canvasRect = container.querySelector("canvas").getBoundingClientRect();
      const expectedAt = (seconds, point) => {
        const key = window.akari.threeRuntime.cameraKeysAt(
          window.akari.threeRuntime.validateCameraKeys(cameraKeys), seconds);
        const camera = new THREE.PerspectiveCamera(40, canvasRect.width / canvasRect.height, 0.1, 2000);
        camera.position.fromArray(Array.from(key.position));
        camera.lookAt(...Array.from(key.lookAt));
        camera.updateMatrixWorld(true);
        const projected = new THREE.Vector3(...point).project(camera);
        return {
          x: ((projected.x + 1) / 2) * canvasRect.width,
          y: ((1 - projected.y) / 2) * canvasRect.height,
        };
      };
      const rectOf = (id) => {
        const rect = document.getElementById(id).getBoundingClientRect();
        return {
          left: rect.left - canvasRect.left,
          top: rect.top - canvasRect.top,
          width: rect.width,
          height: rect.height,
          visibility: getComputedStyle(document.getElementById(id)).visibility,
        };
      };
      const sample = (seconds) => {
        runtime.render(container, seconds);
        const info = runtime.inspect(container);
        return {
          info,
          center: rectOf("center"),
          topleft: rectOf("topleft"),
          behind: rectOf("behind"),
          outside: rectOf("outside"),
          occluded: rectOf("occluded"),
        };
      };
      return {
        status: runtime.inspect(container).status,
        times: [0, 1.5, 3].map((seconds) => ({ seconds, ...sample(seconds) })),
        firstAgain: sample(0),
        expected: {
          0: expectedAt(0, [0, 0, 0]),
          1.5: expectedAt(1.5, [0, 0, 0]),
          3: expectedAt(3, [0, 0, 0]),
          topleft: expectedAt(0, [1, 0.5, 0]),
        },
      };
    }, KEYS);

    check(result.status === "ready", "3D シーンが ready", result.status);
    const close = (actual, expected, epsilon = 0.5) => Math.abs(actual - expected) <= epsilon;
    for (const sample of result.times) {
      const expected = result.expected[sample.seconds];
      const centerX = sample.center.left + sample.center.width / 2;
      const centerY = sample.center.top + sample.center.height / 2;
      check(close(centerX, expected.x) && close(centerY, expected.y),
        `t=${sample.seconds} center ラベルの中心が投影位置`,
        `${centerX},${centerY} vs ${expected.x},${expected.y}`);
      const anchor = sample.info.anchors.find((entry) => entry.point[0] === 0 && entry.point[2] === 0);
      check(anchor?.visible === true && close(anchor.x, expected.x) && close(anchor.y, expected.y),
        `t=${sample.seconds} inspect().anchors が投影位置`,
        JSON.stringify(anchor));
      check(sample.behind.visibility === "hidden", `t=${sample.seconds} カメラの後ろは hidden`, sample.behind.visibility);
      check(sample.outside.visibility === "hidden", `t=${sample.seconds} 画面外は hidden`, sample.outside.visibility);
      check(sample.occluded.visibility === "hidden", `t=${sample.seconds} occlude=true はモデルの陰で hidden`, sample.occluded.visibility);
    }
    check(close(result.times[0].topleft.left, result.expected.topleft.x)
      && close(result.times[0].topleft.top, result.expected.topleft.y),
    "origin=top-left は要素の左上が投影位置", JSON.stringify(result.times[0].topleft));
    check(result.firstAgain.info.anchors.every((entry, index) =>
      JSON.stringify(entry) === JSON.stringify(result.times[0].info.anchors[index])),
    "同じ t を 2 回描いても同じ投影結果");
    check(result.firstAgain.center.left === result.times[0].center.left
      && result.firstAgain.center.top === result.times[0].center.top,
    "同じ t を 2 回描いても同じ transform");
  } finally {
    const child = browser.process();
    if (child) child.kill("SIGKILL");
    else await browser.close();
    try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`  ${result.ok ? "OK  " : "NG  "} ${result.message}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

await main();
