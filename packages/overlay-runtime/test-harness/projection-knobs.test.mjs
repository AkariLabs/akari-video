// three-runtime.js の標準ツマミ（--akari-3d-pan-x / --akari-3d-pan-y / --akari-3d-zoom）を
// 実ブラウザ（ヘッドレス Chrome）で検証する。
//
// task 2026-08-06-live-knob-camera-v2: ツマミの効き先を canvas の CSS 変形からカメラの投影
// （camera.setViewOffset / fov）へ移した。本テストは three-runtime.js の inspect() が返す
// cameraFov / cameraViewOffset（同タスクで追加した検証専用フィールド）を実測し、以下を確認する:
//
//   1. 後方互換: 3 プロパティとも未宣言なら camera.view に一切触れない（cameraViewOffset === null）
//   2. pan/zoom 宣言時: setViewOffset の引数・fov のズームレンズ式が仕様どおりに反映される
//   3. 単位: "50%" と無単位 "0.5" が同じ割合として解決される
//   4. 動的更新: draw のたびに値を読み直し、変化を追随する
//
//   node packages/overlay-runtime/test-harness/projection-knobs.test.mjs
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");

// puppeteer-core は自パッケージの devDependency ではないため、内部リポの harness 各スクリプト
// （knob-audit.mjs 等）と同じ流儀でメイン checkout の解決を借りる（読み取りのみ・メイン
// checkout は無編集）。worktree 側に別途 node_modules を持たせる必要が無い
const require = createRequire("/Users/ryoma/_edit/30_products/akari-video/packages/render-cut/");

const CHROME_CANDIDATES = [
  "/Users/ryoma/.cache/puppeteer/chrome-headless-shell/mac_arm-149.0.7827.22/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("headless Chrome が見つかりません（CHROME_CANDIDATES を確認）");
}

// mesh もテクスチャも持たない最小の有効な glTF-Binary。GLTFLoader が確実に "ready" へ
// 到達することだけが目的（絵の内容は検証対象外 — カメラの投影状態だけを見る）。
function buildMinimalGlb() {
  const json = JSON.stringify({
    asset: { version: "2.0", generator: "akari-video projection-knobs test fixture" },
    scene: 0,
    scenes: [{ nodes: [] }],
  });
  const jsonBytes = Buffer.from(json, "utf8");
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length, 8);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(jsonChunk.length, 0);
  chunkHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  return Buffer.concat([header, chunkHeader, jsonChunk]);
}

const MODEL_DATA_URI = `data:model/gltf-binary;base64,${buildMinimalGlb().toString("base64")}`;
const BASE_FOV = 40;
const WIDTH = 640;
const HEIGHT = 360;

// render-cut / knob-audit と同じ入れ子（akari-overlay-container > scene-content > 断片ルート）。
// container id ごとに独立したカメラ投影状態を持つ。
function sceneFragment({ id, styleVars, panXExpr, panYExpr, zoomExpr, useLegacyTransform }) {
  const bridge = useLegacyTransform
    ? "transform: translate(var(--legacy-x, 0px), var(--legacy-y, 0px)) scale(var(--legacy-scale, 1));"
    : `--akari-3d-pan-x: ${panXExpr};
       --akari-3d-pan-y: ${panYExpr};
       --akari-3d-zoom: ${zoomExpr};`;
  return `
  <div class="akari-overlay-container" id="${id}" style="${styleVars}">
    <div class="scene-content">
      <div class="frag-root" style="position:absolute;inset:0;${bridge}">
        <canvas class="frag-canvas" style="position:absolute;inset:0;width:100%;height:100%;display:block"></canvas>
        <script type="application/json" data-akari-3d-scene>
          { "model": "${MODEL_DATA_URI}", "camera": { "fov": ${BASE_FOV} } }
        </script>
      </div>
    </div>
  </div>`;
}

function buildHtml() {
  const bundle = readFileSync(join(SRC, "vendor/three-bundle.js"), "utf8");
  const runtime = readFileSync(join(SRC, "three-runtime.js"), "utf8");
  const inlineScript = (source) => source.replaceAll("</script", "<\\/script");

  const fragments = [
    // 1) 後方互換: 標準プロパティを一切宣言しない旧断片（transform 方式）
    sceneFragment({
      id: "c-undeclared",
      styleVars: "--legacy-x:120px;--legacy-y:-40px;--legacy-scale:1.5;",
      useLegacyTransform: true,
    }),
    // 2) pan/zoom 宣言（% 単位）: pan-x=50%・pan-y=-25%・zoom=2
    sceneFragment({
      id: "c-declared-percent",
      styleVars: "",
      panXExpr: "50%",
      panYExpr: "-25%",
      zoomExpr: "2",
    }),
    // 3) pan/zoom 宣言（無単位小数）: 2 と同じ意味を無単位で表現（単位換算の一致確認）
    sceneFragment({
      id: "c-declared-unitless",
      styleVars: "",
      panXExpr: "0.5",
      panYExpr: "-0.25",
      zoomExpr: "2",
    }),
    // 4) 既定値を明示宣言（pan=0/zoom=1）: view.enabled=true だが数値は無効化と等価
    sceneFragment({
      id: "c-declared-default",
      styleVars: "",
      panXExpr: "0",
      panYExpr: "0",
      zoomExpr: "1",
    }),
    // 5) 動的更新の確認用（後で CSS 変数を書き換えて再 render する）
    sceneFragment({
      id: "c-dynamic",
      styleVars: "--dyn-x:0%;",
      panXExpr: "var(--dyn-x, 0)",
      panYExpr: "0",
      zoomExpr: "1",
    }),
  ].join("\n");

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #202020; }
  #stage { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  .akari-overlay-container { position: absolute; inset: 0; }
  .akari-overlay-container > .scene-content { position: absolute; inset: 0; }
</style>
<script>${inlineScript(bundle)}</script>
<script>${inlineScript(runtime)}</script>
</head><body><div id="stage">${fragments}</div></body></html>`;
}

async function main() {
  const puppeteer = require("puppeteer-core");
  const tempDir = mkdtempSync(join(tmpdir(), "projection-knobs-test-"));
  const htmlPath = join(tempDir, "harness.html");
  writeFileSync(htmlPath, buildHtml(), "utf8");

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: "shell",
    pipe: true,
    args: [
      "--no-sandbox",
      "--no-zygote",
      "--single-process",
      "--allow-file-access-from-files",
      // chrome-headless-shell に GPU が無いため WebGL は SwiftShader で回す。無いと
      // WebGLRenderer の生成が落ち、ランタイムは status=disposed のまま止まる
      // （harness/render-fragment.mjs と同じ流儀）
      "--disable-gpu",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
    ],
  });

  const results = [];
  const fail = (message) => {
    results.push({ ok: false, message });
  };
  const assertClose = (actual, expected, epsilon, message) => {
    const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon;
    results.push({ ok, message: `${message}（実測 ${actual}, 期待 ${expected} ±${epsilon}）` });
    if (!ok) console.error(`NG: ${message} 実測=${actual} 期待=${expected}`);
  };
  const assertTrue = (condition, message) => {
    results.push({ ok: Boolean(condition), message });
    if (!condition) console.error(`NG: ${message}`);
  };

  try {
    const page = await browser.newPage();
    // ページ内の例外だけ拾う（SwiftShader の GL Driver Message 系警告はノイズなので出さない）
    page.on("pageerror", (error) => console.error(`[page.error] ${error}`));
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });

    const waitReady = (containerId) =>
      page.evaluate(async (id) => {
        const container = document.querySelector(`#${id} > .scene-content`);
        window.akari.threeRuntime.render(container, 0);
        const deadline = Date.now() + 15000;
        for (;;) {
          const { status } = window.akari.threeRuntime.inspect(container);
          if (status === "ready" || status === "error" || Date.now() > deadline) return status;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }, containerId);

    const inspectOf = (containerId) =>
      page.evaluate((id) => {
        const container = document.querySelector(`#${id} > .scene-content`);
        window.akari.threeRuntime.render(container, 0);
        return window.akari.threeRuntime.inspect(container);
      }, containerId);

    // --- 1) 後方互換 ---
    const undeclaredStatus = await waitReady("c-undeclared");
    assertTrue(undeclaredStatus === "ready", "c-undeclared: 3D シーンが ready になった");
    const undeclared = await inspectOf("c-undeclared");
    assertTrue(
      undeclared.cameraViewOffset === null,
      "後方互換: 標準プロパティ未宣言（旧 CSS transform 方式）では camera.view に一切触れない"
    );
    assertClose(undeclared.cameraFov, BASE_FOV, 1e-9, "後方互換: fov は宣言どおりのまま変化しない");

    // --- 2) pan/zoom 宣言（% 単位） ---
    const percentStatus = await waitReady("c-declared-percent");
    assertTrue(percentStatus === "ready", "c-declared-percent: 3D シーンが ready になった");
    const percent = await inspectOf("c-declared-percent");
    assertTrue(percent.cameraViewOffset?.enabled === true, "% 宣言: camera.view が有効化される");
    // camera.setViewOffset(W,H, -panX*W, -panY*H, W,H) — 公開リポ skills/overlay-authoring/3d.md
    const expectedWidth = percent.cameraViewOffset?.fullWidth;
    const expectedHeight = percent.cameraViewOffset?.fullHeight;
    assertClose(
      percent.cameraViewOffset?.offsetX,
      -0.5 * expectedWidth,
      0.51,
      "% 宣言: pan-x=50% → offsetX = -0.5 * フレーム幅"
    );
    assertClose(
      percent.cameraViewOffset?.offsetY,
      0.25 * expectedHeight,
      0.51,
      "% 宣言: pan-y=-25% → offsetY = +0.25 * フレーム高さ（既存 CSS translate と同じ向き）"
    );
    const expectedZoomedFov =
      (2 * Math.atan(Math.tan((BASE_FOV * Math.PI) / 180 / 2) / 2) * 180) / Math.PI;
    assertClose(
      percent.cameraFov,
      expectedZoomedFov,
      1e-6,
      "% 宣言: zoom=2 → fov = 2*atan(tan(fov0/2)/zoom)（ズームレンズ式）"
    );

    // --- 3) 単位換算の一致（% と無単位小数が同じ割合） ---
    const unitlessStatus = await waitReady("c-declared-unitless");
    assertTrue(unitlessStatus === "ready", "c-declared-unitless: 3D シーンが ready になった");
    const unitless = await inspectOf("c-declared-unitless");
    assertClose(
      unitless.cameraViewOffset?.offsetX,
      percent.cameraViewOffset?.offsetX,
      1e-6,
      "単位換算: 無単位 0.5 と \"50%\" が同じ offsetX を生む"
    );
    assertClose(
      unitless.cameraViewOffset?.offsetY,
      percent.cameraViewOffset?.offsetY,
      1e-6,
      "単位換算: 無単位 -0.25 と \"-25%\" が同じ offsetY を生む"
    );
    assertClose(
      unitless.cameraFov,
      percent.cameraFov,
      1e-9,
      "単位換算: zoom の無単位/% 表記で fov が一致"
    );

    // --- 4) 既定値を明示宣言（pan=0/zoom=1）: view は enabled だが数値上は無効化と等価 ---
    const defaultStatus = await waitReady("c-declared-default");
    assertTrue(defaultStatus === "ready", "c-declared-default: 3D シーンが ready になった");
    const declaredDefault = await inspectOf("c-declared-default");
    assertTrue(
      declaredDefault.cameraViewOffset?.enabled === true,
      "既定値宣言: pan=0/zoom=1 でも宣言があれば camera.view は有効化される（未宣言とはコード経路が異なる）"
    );
    assertClose(declaredDefault.cameraViewOffset?.offsetX, 0, 1e-6, "既定値宣言: pan-x=0 → offsetX=0");
    assertClose(declaredDefault.cameraViewOffset?.offsetY, 0, 1e-6, "既定値宣言: pan-y=0 → offsetY=0");
    assertClose(
      declaredDefault.cameraFov,
      BASE_FOV,
      1e-6,
      "既定値宣言: zoom=1 → fov は実質不変（既定の見た目を変えない）"
    );

    // --- 5) 動的更新: draw のたびに値を読み直す ---
    const dynamicStatus = await waitReady("c-dynamic");
    assertTrue(dynamicStatus === "ready", "c-dynamic: 3D シーンが ready になった");
    const before = await inspectOf("c-dynamic");
    assertClose(before.cameraViewOffset?.offsetX, 0, 1e-6, "動的更新: 初期値 --dyn-x=0% → offsetX=0");
    await page.evaluate(() => {
      document.getElementById("c-dynamic").style.setProperty("--dyn-x", "30%");
    });
    const after = await inspectOf("c-dynamic");
    const dynWidth = after.cameraViewOffset?.fullWidth;
    assertClose(
      after.cameraViewOffset?.offsetX,
      -0.3 * dynWidth,
      0.31,
      "動的更新: --dyn-x を 30% へ書き換えた後の render() で offsetX が追随する"
    );
  } finally {
    const process = browser.process();
    if (process) process.kill("SIGKILL");
    else await browser.close();
    rmSync(tempDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`  ${r.ok ? "OK  " : "NG  "} ${r.message}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

await main();
