// materialOverrides の動画テクスチャをライブプレビュー相当（別オリジンの配信 + syncVideos）で
// 実ブラウザ検証する。2026-09-16 の不具合: <video> に crossOrigin が無く、別オリジン
// （127.0.0.1 の asset stream）の動画は canvas を汚染して WebGL へ上がらず画面が真っ黒だった。
// あわせて再生中は <video> を走らせ、停止中はシークで追従することを確かめる。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");

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
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    for (const build of directories(cacheRoot).sort().reverse()) {
      for (const platform of directories(join(cacheRoot, build))) {
        cached.push(join(cacheRoot, build, platform, "chrome-headless-shell"));
      }
    }
  }
  const candidates = [process.env.CHROME_PATH, ...cached, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  const chrome = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!chrome) throw new Error("headless Chrome が見つかりません");
  return chrome;
}

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// three-screen-knobs.test.mjs と同じ、発光する ScreenMaterial 1 枚の板
function buildScreenGlb() {
  const positions = new Float32Array([-1, -0.5, 0, 1, -0.5, 0, 1, 1.5, 0, -1, 1.5, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
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
    asset: { version: "2.0", generator: "akari-video three-video-texture-live test fixture" },
    buffers: [{ byteLength: binary.length }],
    bufferViews: chunks.map((chunk, index) => ({
      buffer: 0, byteOffset: offsets[index], byteLength: chunk.length, target: index === 3 ? 34963 : 34962,
    })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [-1, -0.5, 0], max: [1, 1.5, 0] },
      { bufferView: 1, componentType: 5126, count: 4, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 4, type: "VEC2" },
      { bufferView: 3, componentType: 5123, count: 6, type: "SCALAR" },
    ],
    materials: [{
      name: "ScreenMaterial", doubleSided: true, emissiveFactor: [1, 1, 1],
      pbrMetallicRoughness: { baseColorFactor: [0, 0, 0, 1], metallicFactor: 0, roughnessFactor: 1 },
    }],
    meshes: [{ name: "ScreenMesh", primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    nodes: [{ name: "Screen", mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const jsonBytes = Buffer.from(JSON.stringify(gltf), "utf8");
  const paddedJson = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 0x20)]);
  const paddedBinary = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + paddedJson.length + 8 + paddedBinary.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(paddedJson.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(paddedBinary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, paddedJson, binaryHeader, paddedBinary]);
}

const MODEL_DATA_URI = `data:model/gltf-binary;base64,${buildScreenGlb().toString("base64")}`;

// ページは localhost、動画は 127.0.0.1 から配る = シェルの webview ⇄ asset stream と同じ別オリジン
function serve(dir) {
  const types = { ".html": "text/html; charset=utf-8", ".webm": "video/webm", ".js": "text/javascript" };
  const server = createServer((request, response) => {
    const file = join(dir, decodeURIComponent(new URL(request.url, "http://x").pathname));
    if (!existsSync(file)) { response.writeHead(404); response.end(); return; }
    const body = readFileSync(file);
    const ext = file.slice(file.lastIndexOf("."));
    const headers = { "Content-Type": types[ext] ?? "application/octet-stream", "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes" };
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      response.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${body.length}`, "Content-Length": end - start + 1 });
      response.end(body.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, { ...headers, "Content-Length": body.length });
    response.end(body);
  });
  return new Promise((resolveServer) => server.listen(0, "127.0.0.1", () => resolveServer({ server, port: server.address().port })));
}

test("cross-origin video texture renders through the live preview sync (crossOrigin + play/seek follow)", { skip: hasFfmpeg() ? false : "ffmpeg が無い" }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "akari-three-video-live-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // 明るい単色（緑）の 2 秒 VP9。黒（転送失敗）との区別が画素 1 点で付く
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x20e020:size=64x64:rate=30", "-t", "2",
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-g", "60", join(dir, "screen.webm")], { stdio: "ignore" });
  const { server, port } = await serve(dir);
  t.after(() => server.close());
  const descriptor = {
    model: MODEL_DATA_URI,
    camera: { fov: 40, position: [0, 0.5, 3], lookAt: [0, 0.5, 0] },
    materialOverrides: { ScreenMaterial: { texture: `http://127.0.0.1:${port}/screen.webm` } },
  };
  const inline = (source) => source.replaceAll("</script", "<\\/script");
  writeFileSync(join(dir, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#222}.scene-content{position:relative;width:128px;height:128px}canvas{display:block;width:128px;height:128px}
  </style><script>${inline(readFileSync(join(SRC, "vendor/three-bundle.js"), "utf8"))}</script><script>${inline(readFileSync(join(SRC, "three-runtime.js"), "utf8"))}</script></head>
  <body><div id="scene" class="scene-content"><div class="fragment-root"><canvas></canvas><div data-akari-3d-fallback>3Dを読み込み中</div>
  <script type="application/json" data-akari-3d-scene>${JSON.stringify(descriptor)}</script></div></div></body></html>`);

  const browser = await loadPuppeteer().launch({
    executablePath: findChrome(), headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error(`[page.error] ${error}`));
  await page.setViewport({ width: 320, height: 240, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${port}/index.html`, { waitUntil: "load" });

  const result = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const container = document.getElementById("scene");
    const rt = window.akari.threeRuntime;
    const centerPixel = () => {
      rt.render(container, 0.5, { syncVideos: true, maxRenderSize: 720, playing: false });
      const canvas = container.querySelector("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      const pixel = new Uint8Array(4);
      gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    };
    // 停止中の同期（シーク）で読み込み → 提示フレーム到達まで待つ
    rt.render(container, 0.5, { syncVideos: true, maxRenderSize: 720, playing: false });
    for (let i = 0; i < 400; i++) {
      const status = rt.inspect(container).status;
      if (status === "error") break;
      const video = document.querySelector("video[data-akari-three-video-texture]");
      if (status === "ready" && video && !video.seeking && video.readyState >= 2) break;
      rt.render(container, 0.5, { syncVideos: true, maxRenderSize: 720, playing: false });
      await sleep(50);
    }
    const video = document.querySelector("video[data-akari-three-video-texture]");
    // seeked 後の描き直し / 提示フレーム到達を待ってから読む
    await sleep(300);
    const pausedPixel = centerPixel();
    const pausedState = video ? { crossOrigin: video.crossOrigin, paused: video.paused, currentTime: video.currentTime, seeking: video.seeking } : null;
    // 再生中の同期は <video> を走らせる
    for (let i = 0; i < 10; i++) {
      rt.render(container, 0.6 + i * 0.033, { syncVideos: true, maxRenderSize: 720, playing: true });
      await sleep(33);
    }
    const playingState = video ? { paused: video.paused, playbackRate: video.playbackRate } : null;
    // 停止へ戻すと止まる
    rt.render(container, 1.0, { syncVideos: true, maxRenderSize: 720, playing: false });
    await sleep(50);
    const stoppedState = video ? { paused: video.paused } : null;
    return { status: rt.inspect(container).status, overrides: rt.inspect(container).materialOverrides, pausedPixel, pausedState, playingState, stoppedState };
  });

  assert.equal(result.status, "ready", JSON.stringify(result));
  assert.equal(result.overrides[0]?.video, true);
  assert.equal(result.pausedState?.crossOrigin, "anonymous", "別オリジン配信の動画は CORS で読む");
  assert.ok(result.pausedPixel[1] > 100 && result.pausedPixel[1] > result.pausedPixel[0] + 60,
    `screen should show the green video, got ${result.pausedPixel} (${JSON.stringify(result.pausedState)})`);
  assert.equal(result.playingState?.paused, false, "再生中は <video> を走らせる");
  assert.equal(result.stoppedState?.paused, true, "停止すると <video> も止まる");
});
