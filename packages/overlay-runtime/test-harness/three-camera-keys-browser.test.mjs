// camera.keys の実ブラウザ配線を検証する（補間そのものは three-camera-keys.test.mjs の純関数テスト）。
//
//   - camera.keys が宣言されたシーンは GLB にカメラが無くても ready になる
//     （= camera.fromModel を採らない。採ると「glb にカメラがありません」で error になる）
//   - 同じ時刻 t を 2 回描いても同じ位置（決定論）
//   - camera.keys と camera.fromModel の併用は警告を 1 行だけ出し、inspect() の cameraSource は "keys"
//
//   AKARI_TEST_CHROME_PATH=<chrome か edge> node packages/overlay-runtime/test-harness/three-camera-keys-browser.test.mjs
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

// 箱だけの最小 glTF（カメラもアニメも持たない）。fromModel を採ると失敗するので、
// keys が優先されたことの反証になる。
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
    asset: { version: "2.0", generator: "akari-video three-camera-keys test fixture" },
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
  { t: 0, position: [0, 1.4, 5], lookAt: [0, 0, 0], ease: "easeInOut" },
  { t: 1.5, position: [4, 0.8, 3], lookAt: [0, 0, 0], ease: "easeInOut" },
  { t: 3, position: [-4, 1.8, 2], lookAt: [0, 0, 0], ease: "linear" },
];

function buildHtml() {
  const bundle = readFileSync(join(SRC, "vendor/three-bundle.js"), "utf8");
  const runtime = readFileSync(join(SRC, "three-runtime.js"), "utf8");
  const inlineScript = (source) => source.replaceAll("</script", "<\\/script");
  const scene = { model: MODEL, camera: { fov: 40, fromModel: true, keys: KEYS }, background: { color: "#101820" } };
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: #101820; }
  #scene { position: relative; width: 320px; height: 180px; }
  #scene canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
</style><script>${inlineScript(bundle)}</script><script>${inlineScript(runtime)}</script></head><body>
<div id="scene"><div class="root"><canvas data-akari-3d-canvas></canvas>
<script type="application/json" data-akari-3d-scene>${JSON.stringify(scene)}</script></div></div>
</body></html>`;
}

async function main() {
  const puppeteer = require("puppeteer-core");
  const tempDir = mkdtempSync(join(tmpdir(), "three-camera-keys-browser-"));
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
  const close = (actual, expected, epsilon = 1e-3) => Array.isArray(actual) && Array.isArray(expected)
    && actual.length === expected.length
    && expected.every((value, index) => Math.abs(actual[index] - value) <= epsilon);

  try {
    const page = await browser.newPage();
    const warnings = [];
    page.on("pageerror", (error) => console.error(`[page.error] ${error}`));
    page.on("console", (message) => {
      if (message.type() === "warn" || message.type() === "warning") warnings.push(message.text());
    });
    await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });

    const result = await page.evaluate(async () => {
      const container = document.getElementById("scene");
      const runtime = window.akari.threeRuntime;
      runtime.render(container, 0.2);
      for (let attempt = 0; attempt < 600; attempt += 1) {
        const status = runtime.inspect(container).status;
        if (status === "ready" || status === "error") break;
        await new Promise((done) => setTimeout(done, 20));
      }
      const sample = (seconds) => {
        runtime.render(container, seconds);
        const info = runtime.inspect(container);
        return {
          status: info.status, source: info.cameraSource, keyTime: info.cameraKeyTime,
          position: info.cameraWorldPosition, fov: info.cameraFov,
        };
      };
      return {
        status: runtime.inspect(container).status,
        first: sample(0.2), middle: sample(1.5), late: sample(2.8), firstAgain: sample(0.2),
      };
    });

    const keyWarnings = warnings.filter((text) => text.includes("camera.keys"));
    check(result.status === "ready", "camera.keys + camera.fromModel（GLB にカメラ無し）で ready", result.status);
    check(keyWarnings.length === 1 && keyWarnings[0].includes("camera.fromModel") && keyWarnings[0].includes("優先"),
      "camera.fromModel との併用は keys 優先の警告を 1 行だけ出す", JSON.stringify(warnings));
    check(result.first.source === "keys", "inspect().cameraSource が keys", JSON.stringify(result.first));
    check(close(result.first.position, [0.0379, 1.3943, 4.9810]), "t=0.2 は easeInOut の途中の位置", JSON.stringify(result.first.position));
    check(close(result.middle.position, [4, 0.8, 3]), "t=1.5 は 2 番目のキーの位置", JSON.stringify(result.middle.position));
    check(close(result.late.position, [-2.9333, 1.6667, 2.1333]), "t=2.8 は 2→3 番目を linear 補間した位置", JSON.stringify(result.late.position));
    check(close(result.firstAgain.position, result.first.position, 1e-12),
      "同じ t を 2 回描いても同じカメラ位置", `${JSON.stringify(result.firstAgain.position)} vs ${JSON.stringify(result.first.position)}`);
    check(result.middle.fov === 40 && result.middle.keyTime === 1.5, "fov は宣言値のまま・keyTime は t", JSON.stringify(result.middle));
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
