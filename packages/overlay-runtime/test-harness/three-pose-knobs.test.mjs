// three-runtime.js の標準ツマミ --akari-3d-rot-x/y/z（モデルの向き）と --akari-3d-clip（動きのプリセット）を
// 実ブラウザ（ヘッドレス Chrome / Edge）で検証する。
//
//   1. 後方互換: 回転を宣言しなければ姿勢の Group は単位行列のまま
//   2. 軸は水平を保ったカメラ基準（X = 画面の横・Y = 真上・Z = 手前）。横から見るカメラでは X 回転の世界軸が変わり、
//      見下ろすカメラでも Y 回転は世界の鉛直軸まわり（本体が傾かない）
//   3. 回転の中心はモデルに固定した点（外接箱の中心）。クリップが本体を動かしても中心が追随する
//   4. draw のたびに読み直す（renderNow でも即座に効く）・"deg" 接尾辞
//   5. --akari-3d-clip: none で静止姿勢に戻る / クリップ名で切り替わる / 無い名前は断片の既定へ
//   6. camera.fromModel でカメラがモデルの木の中にあっても、カメラは一緒に回らない
//
//   AKARI_TEST_CHROME_PATH=<chrome か edge> node packages/overlay-runtime/test-harness/three-pose-knobs.test.mjs
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

// 立方体 1 個（中心 = ノードの原点、辺 0.5）を (0.5, 0, 0) に置いた glTF。
// クリップ "Move" は 0→1 秒で本体を (0.5,0,0) → (1.5,0,0) へ動かす。withCamera なら木の中に "Cam" を持つ
function buildGltf({ withCamera }) {
  const h = 0.25;
  const positions = new Float32Array([
    -h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h,
    -h, -h, h, h, -h, h, h, h, h, -h, h, h,
  ]);
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
    3, 6, 2, 3, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ]);
  const times = new Float32Array([0, 1]);
  const moves = new Float32Array([0.5, 0, 0, 1.5, 0, 0]);
  const chunks = [positions, indices, times, moves].map((array) => Buffer.from(array.buffer));
  const views = [];
  let offset = 0;
  for (const chunk of chunks) {
    views.push({ buffer: 0, byteOffset: offset, byteLength: chunk.length });
    offset += chunk.length + ((4 - (chunk.length % 4)) % 4);
  }
  const buffer = Buffer.concat(chunks.flatMap((chunk) => [chunk, Buffer.alloc((4 - (chunk.length % 4)) % 4)]));
  const nodes = [{ name: "Body", mesh: 0, translation: [0.5, 0, 0] }];
  if (withCamera) nodes.push({ name: "Cam", camera: 0, translation: [0, 0, 3] });
  const gltf = {
    asset: { version: "2.0", generator: "akari-video three-pose-knobs test fixture" },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: "Body", pbrMetallicRoughness: { baseColorFactor: [0.9, 0.4, 0.1, 1] } }],
    ...(withCamera ? { cameras: [{ type: "perspective", perspective: { yfov: 0.7, znear: 0.01, zfar: 100 } }] } : {}),
    buffers: [{ byteLength: buffer.length, uri: `data:application/octet-stream;base64,${buffer.toString("base64")}` }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: "VEC3", min: [-h, -h, -h], max: [h, h, h] },
      { bufferView: 1, componentType: 5123, count: 36, type: "SCALAR" },
      { bufferView: 2, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
      { bufferView: 3, componentType: 5126, count: 2, type: "VEC3" },
    ],
    animations: [{
      name: "Move",
      channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
      samplers: [{ input: 2, output: 3, interpolation: "LINEAR" }],
    }],
  };
  return `data:model/gltf+json;base64,${Buffer.from(JSON.stringify(gltf)).toString("base64")}`;
}

const MODEL = buildGltf({ withCamera: false });
const MODEL_WITH_CAMERA = buildGltf({ withCamera: true });
const WIDTH = 640;
const HEIGHT = 360;

function sceneFragment({ id, styleVars = "", scene }) {
  return `
  <div class="akari-overlay-container" id="${id}" style="${styleVars}">
    <div class="scene-content">
      <div class="frag-root" style="position:absolute;inset:0">
        <canvas style="position:absolute;inset:0;width:100%;height:100%;display:block"></canvas>
        <script type="application/json" data-akari-3d-scene>${JSON.stringify(scene)}</script>
      </div>
    </div>
  </div>`;
}

const FRONT = { position: [0, 0, 3], lookAt: [0, 0, 0], fov: 40 };
const SIDE = { position: [3, 0, 0], lookAt: [0, 0, 0], fov: 40 };
const ABOVE = { position: [0, 2, 3], lookAt: [0, 0, 0], fov: 40 };

function buildHtml() {
  const bundle = readFileSync(join(SRC, "vendor/three-bundle.js"), "utf8");
  const runtime = readFileSync(join(SRC, "three-runtime.js"), "utf8");
  const inlineScript = (source) => source.replaceAll("</script", "<\\/script");
  const fragments = [
    sceneFragment({ id: "c-none", scene: { model: MODEL, camera: FRONT } }),
    sceneFragment({ id: "c-roty", styleVars: "--akari-3d-rot-y:90;", scene: { model: MODEL, camera: FRONT } }),
    sceneFragment({ id: "c-side", styleVars: "--akari-3d-rot-x:90;", scene: { model: MODEL, camera: SIDE } }),
    sceneFragment({ id: "c-above", styleVars: "--akari-3d-rot-y:90;", scene: { model: MODEL, camera: ABOVE } }),
    sceneFragment({ id: "c-dynamic", scene: { model: MODEL, camera: FRONT } }),
    sceneFragment({ id: "c-clip", styleVars: "--akari-3d-rot-y:180;", scene: { model: MODEL, camera: FRONT, animationClip: "Move" } }),
    sceneFragment({ id: "c-incam", styleVars: "--akari-3d-rot-y:45;", scene: { model: MODEL_WITH_CAMERA, camera: { fromModel: "Cam" } } }),
    sceneFragment({ id: "c-incam-still", scene: { model: MODEL_WITH_CAMERA, camera: { fromModel: "Cam" } } }),
  ].join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #202020; }
  #stage { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  .akari-overlay-container, .scene-content { position: absolute; inset: 0; }
</style>
<script>${inlineScript(bundle)}</script>
<script>${inlineScript(runtime)}</script>
</head><body><div id="stage">${fragments}</div></body></html>`;
}

async function main() {
  const puppeteer = require("puppeteer-core");
  const tempDir = mkdtempSync(join(tmpdir(), "three-pose-knobs-test-"));
  const htmlPath = join(tempDir, "harness.html");
  writeFileSync(htmlPath, buildHtml(), "utf8");
  const executablePath = findChrome();
  // Edge（Chrome の無い Windows 機）は --single-process / headless: "shell" で起動直後に落ちるので外す
  const edge = /msedge/i.test(executablePath);
  const browser = await puppeteer.launch({
    executablePath,
    headless: edge ? true : "shell",
    pipe: true,
    userDataDir: join(tempDir, "profile"),
    args: ["--no-sandbox", ...(edge ? [] : ["--no-zygote", "--single-process"]), "--allow-file-access-from-files",
      "--disable-gpu", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  });

  const results = [];
  const check = (condition, message, detail = "") => {
    results.push({ ok: Boolean(condition), message: detail ? `${message}（${detail}）` : message });
    if (!condition) console.error(`NG: ${message} ${detail}`);
  };
  const close = (actual, expected, epsilon = 1e-4) => Array.isArray(expected)
    ? Array.isArray(actual) && expected.every((value, index) => Math.abs(actual[index] - value) <= epsilon)
    : Math.abs(actual - expected) <= epsilon;
  const s45 = Math.SQRT1_2;

  try {
    const page = await browser.newPage();
    const warnings = [];
    page.on("pageerror", (error) => console.error(`[page.error] ${error}`));
    page.on("console", (message) => { if (message.type() === "warn" || message.type() === "warning") warnings.push(message.text()); });
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });

    const ready = (id) => page.evaluate(async (containerId) => {
      const container = document.querySelector(`#${containerId} > .scene-content`);
      window.akari.threeRuntime.render(container, 0);
      const deadline = Date.now() + 15000;
      for (;;) {
        const { status } = window.akari.threeRuntime.inspect(container);
        if (status === "ready" || status === "error" || Date.now() > deadline) return status;
        await new Promise((done) => setTimeout(done, 10));
      }
    }, id);
    const poseAt = (id, seconds = 0) => page.evaluate((containerId, time) => {
      const container = document.querySelector(`#${containerId} > .scene-content`);
      window.akari.threeRuntime.render(container, time);
      return window.akari.threeRuntime.inspect(container).pose;
    }, id, seconds);
    const setVar = (id, name, value) => page.evaluate((containerId, property, next) => {
      document.getElementById(containerId).style.setProperty(property, next);
    }, id, name, value);

    for (const id of ["c-none", "c-roty", "c-side", "c-above", "c-dynamic", "c-clip", "c-incam", "c-incam-still"]) {
      check(await ready(id) === "ready", `${id}: 3D シーンが ready になった`);
    }

    // 1) 後方互換
    const none = await poseAt("c-none");
    check(close(none.quaternion, [0, 0, 0, 1]) && close(none.position, [0, 0, 0]),
      "後方互換: 回転を宣言しなければ姿勢の Group は単位行列", JSON.stringify(none));

    // 2) 正面カメラ: rot-y 90 = 世界 Y 軸まわり 90°。中心 (0.5,0,0) は動かない → position = c − R·c = (0.5,0,0.5)
    const roty = await poseAt("c-roty");
    check(close(roty.quaternion, [0, s45, 0, s45]), "正面カメラ: rot-y=90 は世界 Y 軸まわりの 90°", JSON.stringify(roty.quaternion));
    check(close(roty.position, [0.5, 0, 0.5]), "回転の中心はモデルの外接箱の中心（その場で回る）", JSON.stringify(roty.position));

    // 3) 横カメラ（+X から原点を見る）: 画面右 = 世界 −Z。rot-x 90 は世界 −Z 軸まわり
    const side = await poseAt("c-side");
    check(close(side.quaternion, [0, 0, -s45, s45]), "軸はカメラ基準: 横から見るカメラの rot-x は世界 −Z 軸まわり", JSON.stringify(side.quaternion));

    const above = await poseAt("c-above");
    check(close(above.quaternion, [0, s45, 0, s45]), "見下ろすカメラでも rot-y は世界の鉛直軸まわり（ターンテーブル）", JSON.stringify(above.quaternion));

    // 4) 動的更新・deg 接尾辞・renderNow
    await setVar("c-dynamic", "--akari-3d-rot-z", "90deg");
    const dynamic = await page.evaluate(() => {
      const container = document.querySelector("#c-dynamic > .scene-content");
      const drawn = window.akari.threeRuntime.renderNow(container);
      return { drawn, pose: window.akari.threeRuntime.inspect(container).pose };
    });
    check(dynamic.drawn === true, "renderNow: 読み込み済みなら即座に描いて true を返す");
    check(close(dynamic.pose.quaternion, [0, 0, s45, s45]) && dynamic.pose.rotZ === 90,
      "動的更新: --akari-3d-rot-z を 90deg に変えると renderNow で世界 Z 軸まわり 90° になる", JSON.stringify(dynamic.pose));

    // 5) クリップ: Move の 0.5 秒目は本体が (1,0,0)（1 秒ちょうどはループで 0 秒に戻る）。rot-y 180 の中心が追随 → position = 2c = (2,0,0)
    const moving = await poseAt("c-clip", 0.5);
    check(moving.clip === "Move" && moving.clipKnob === "", "既定: 断片の animationClip（Move）が掛かる", JSON.stringify(moving));
    check(close(moving.position, [2, 0, 0], 1e-3), "回転の中心はクリップで動いた本体に追随する", JSON.stringify(moving.position));
    await setVar("c-clip", "--akari-3d-clip", "none");
    const still = await poseAt("c-clip", 0.5);
    check(still.clip === null && still.clipKnob === "none", "--akari-3d-clip: none でクリップが止まる", JSON.stringify(still));
    check(close(still.position, [1, 0, 0], 1e-3), "none: 本体は読み込み直後の静止姿勢 (0.5,0,0) に戻る", JSON.stringify(still.position));
    await setVar("c-clip", "--akari-3d-clip", "Move");
    const named = await poseAt("c-clip", 0.5);
    check(named.clip === "Move" && close(named.position, [2, 0, 0], 1e-3), "クリップ名で切り替えられる", JSON.stringify(named));
    await setVar("c-clip", "--akari-3d-clip", "\"Nope\"");
    const unknown = await poseAt("c-clip", 0.5);
    check(unknown.clip === "Move" && warnings.some((text) => text.includes("Nope")),
      "glb に無い名前は警告して断片の既定へ（引用符つきの値も読む）", JSON.stringify(unknown));

    // 6) カメラが木の中: 回してもカメラの世界行列は回さないときと同じ
    const incam = await poseAt("c-incam");
    const incamStill = await poseAt("c-incam-still");
    check(incam.cameraInTree === true, "camera.fromModel のカメラを木の中のカメラとして扱う");
    check(close(incam.quaternion, [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)]), "木の中のカメラでも rot-y=45 は世界 Y 軸まわり", JSON.stringify(incam.quaternion));
    check(close(incam.cameraMatrixWorld, incamStill.cameraMatrixWorld),
      "木の中のカメラはモデルと一緒に回らない（世界行列が回転なしと同じ）",
      `${JSON.stringify(incam.cameraMatrixWorld?.slice(12, 15))} vs ${JSON.stringify(incamStill.cameraMatrixWorld?.slice(12, 15))}`);
    const bounds = await page.evaluate(() => ["c-incam", "c-incam-still"].map((id) => {
      const canvas = document.querySelector(`#${id} canvas`);
      const box = window.akari.threeRuntime.contentBounds(canvas);
      return box ? [box.left, box.right] : null;
    }));
    check(bounds[0] && bounds[1] && !close(bounds[0], bounds[1], 2),
      "木の中のカメラ: 回すと画面上の内容枠が変わる（見た目に効いている）", JSON.stringify(bounds));
  } finally {
    const child = browser.process();
    if (child) child.kill("SIGKILL");
    else await browser.close();
    // Edge は kill 直後もプロファイルを掴んでいることがある。後片付けの失敗で結果を落とさない
    try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`  ${result.ok ? "OK  " : "NG  "} ${result.message}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

await main();
