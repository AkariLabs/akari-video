// three-runtime.js の animationClip "*" 衝突警告（2026-10-20 報告 §10）を実ブラウザで検証する。
//
//   1. 同じノードの同じプロパティを 2 クリップが動かす "*" は警告する（ノード名・クリップ名・直し方つき）
//   2. 動きが混ざるプロパティごとに 1 回だけ警告する（多重再生で増えない）
//   3. クリップごとに別ノードなら警告しない
//   4. 同じノードでも別プロパティなら警告しない
//   5. クリップ名を指定した宣言は警告しない
//   6. assets/ の既存 GLB は animation clip を持たない（新規警告 0 件を実測）
//
//   node --test packages/overlay-runtime/test-harness/three-animation-clip-collisions.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { runtimeRoot } from "../runtimes.mjs";
import { launchBrowser } from "./fixtures/browser.mjs";

const ROOT = resolve(runtimeRoot, "../..");
const NODE_INDEX = { Cam: 0, Body: 1 };
const IDENTITY = [0, 0, 0, 1];
const QUARTER_TURN = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
const MOTION = {
  translation: { values: [[0, 0, 3], [1, 0, 3]], width: 3 },
  rotation: { values: [IDENTITY, QUARTER_TURN], width: 4 },
  scale: { values: [[1, 1, 1], [2, 2, 2]], width: 3 },
};
const TYPES = { 1: "SCALAR", 3: "VEC3", 4: "VEC4" };

// ノードは Cam（camera.fromModel 用）と Body の 2 つ。クリップは channel の target だけを
// 指定して glTF JSON を組み立てる（同じノード・同じプロパティの衝突を作れる最小構成）
function buildGltf(clipSpecs) {
  const bufferViews = [];
  const accessors = [];
  const chunks = [];
  let byteLength = 0;
  const addAccessor = (values, width) => {
    const array = new Float32Array(values.flat());
    chunks.push(Buffer.from(array.buffer));
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: array.byteLength });
    byteLength += array.byteLength;
    const accessor = {
      bufferView: bufferViews.length - 1,
      componentType: 5126,
      count: values.length,
      type: TYPES[width],
    };
    if (width === 1) {
      accessor.min = [Math.min(...values.flat())];
      accessor.max = [Math.max(...values.flat())];
    }
    accessors.push(accessor);
    return accessors.length - 1;
  };
  const animations = clipSpecs.map(({ name, tracks }) => {
    const input = addAccessor([0, 1], 1);
    const samplers = [];
    const channels = [];
    for (const track of tracks) {
      const motion = MOTION[track.path];
      samplers.push({ input, output: addAccessor(motion.values, motion.width) });
      channels.push({ sampler: samplers.length - 1, target: { node: NODE_INDEX[track.node], path: track.path } });
    }
    return { name, samplers, channels };
  });
  const buffer = Buffer.concat(chunks);
  const gltf = {
    asset: { version: "2.0", generator: "akari-video animationClip collision test fixture" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: "Cam", camera: 0, translation: [0, 0, 3] },
      { name: "Body", translation: [0, 0, 0] },
    ],
    cameras: [{ type: "perspective", perspective: { yfov: 0.7, znear: 0.01, zfar: 100 } }],
    buffers: [{ byteLength: buffer.length, uri: `data:application/octet-stream;base64,${buffer.toString("base64")}` }],
    bufferViews,
    accessors,
    animations,
  };
  return `data:model/gltf+json;base64,${Buffer.from(JSON.stringify(gltf)).toString("base64")}`;
}

const CONFLICT = buildGltf([
  { name: "W1", tracks: [{ node: "Cam", path: "translation" }] },
  { name: "A", tracks: [{ node: "Cam", path: "translation" }] },
]);
const TWO_PROPERTIES = buildGltf([
  { name: "W1", tracks: [{ node: "Cam", path: "translation" }, { node: "Cam", path: "rotation" }] },
  { name: "A", tracks: [{ node: "Cam", path: "translation" }, { node: "Cam", path: "rotation" }] },
]);
const SEPARATE_NODES = buildGltf([
  { name: "W1", tracks: [{ node: "Cam", path: "translation" }] },
  { name: "A", tracks: [{ node: "Body", path: "translation" }] },
]);
const SEPARATE_PROPERTIES = buildGltf([
  { name: "W1", tracks: [{ node: "Cam", path: "translation" }] },
  { name: "A", tracks: [{ node: "Cam", path: "rotation" }] },
]);
const SINGLE_CLIP = buildGltf([{ name: "W1", tracks: [{ node: "Cam", path: "translation" }] }]);

function sceneFragment(id, scene) {
  return `<div class="akari-overlay-container" id="${id}"><div class="scene-content"><div class="frag-root" style="position:absolute;inset:0"><canvas style="position:absolute;inset:0;width:100%;height:100%;display:block"></canvas><script type="application/json" data-akari-3d-scene>${JSON.stringify(scene)}</script></div></div></div>`;
}

function harnessHtml() {
  const inline = (source) => source.replaceAll("</script", "<\\/script");
  const bundle = readFileSync(resolve(runtimeRoot, "src/vendor/three-bundle.js"), "utf8");
  const runtime = readFileSync(resolve(runtimeRoot, "src/three-runtime.js"), "utf8");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: #202020; }
  #stage { position: relative; width: 320px; height: 180px; overflow: hidden; }
  .akari-overlay-container, .scene-content, .frag-root { position: absolute; inset: 0; }
</style>
<script>${inline(bundle)}</script>
<script>${inline(runtime)}</script>
</head><body><div id="stage"></div></body></html>`;
}

function glbAnimationSummary(path) {
  const buffer = readFileSync(path);
  const jsonLength = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8").trim());
  return (gltf.animations ?? []).map((animation) => ({
    name: animation.name,
    targets: (animation.channels ?? []).map((channel) => `${gltf.nodes?.[channel.target.node]?.name ?? channel.target.node}.${channel.target.path}`),
  }));
}

test("animationClip \"*\" warns only when clips animate the same node property", { timeout: 120_000 }, async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const warnings = [];
  page.on("console", (message) => {
    // WebGL のドライバ警告（SwiftShader 等）は対象外。ランタイムの警告だけを数える
    if (message.type() === "warn" && message.text().includes("[akari-three]")) warnings.push(message.text());
  });
  await page.setViewport({ width: 320, height: 180, deviceScaleFactor: 1 });
  await page.setContent(harnessHtml(), { waitUntil: "load" });

  const mount = async (id, scene) => {
    await page.evaluate((html) => {
      document.querySelector("#stage").insertAdjacentHTML("beforeend", html);
    }, sceneFragment(id, scene));
    const before = warnings.length;
    const status = await page.evaluate(async (containerId) => {
      const container = document.querySelector(`#${containerId} > .scene-content`);
      window.akari.threeRuntime.render(container, 0);
      const deadline = Date.now() + 15000;
      for (;;) {
        const { status } = window.akari.threeRuntime.inspect(container);
        if (status === "ready" || status === "error" || Date.now() > deadline) return status;
        await new Promise((done) => setTimeout(done, 10));
      }
    }, id);
    return { status, warnings: warnings.slice(before) };
  };

  // 1) 衝突する "*" はノード名・クリップ名・プロパティ・直し方つきで 1 回警告する
  const conflict = await mount("conflict", { model: CONFLICT, camera: { fromModel: "Cam" }, animationClip: "*" });
  assert.equal(conflict.status, "ready");
  assert.equal(conflict.warnings.length, 1, JSON.stringify(conflict.warnings));
  const warning = conflict.warnings[0];
  for (const fragment of ["[akari-three]", "\"W1\"", "\"A\"", "\"Cam\"", "translation", "animationClip にクリップ名を指定してください"]) {
    assert.ok(warning.includes(fragment), `警告に ${fragment} が含まれる: ${warning}`);
  }
  t.diagnostic(`警告文面: ${warning}`);

  // 2) 同じインスタンスを再生し直しても警告は増えない（warnPoseOnce）
  const warningCount = warnings.length;
  await page.evaluate(() => {
    const container = document.querySelector("#conflict > .scene-content");
    window.akari.threeRuntime.render(container, 1);
    window.akari.threeRuntime.renderNow(container);
  });
  assert.equal(warnings.length, warningCount);

  // 3) 同じノードの translation と rotation をそれぞれ衝突させると、プロパティごとに 1 回ずつ
  const twoProperties = await mount("two-properties", { model: TWO_PROPERTIES, camera: { fromModel: "Cam" }, animationClip: "*" });
  assert.equal(twoProperties.status, "ready");
  assert.equal(twoProperties.warnings.length, 2, JSON.stringify(twoProperties.warnings));
  assert.ok(twoProperties.warnings.some((text) => text.includes("translation")));
  assert.ok(twoProperties.warnings.some((text) => text.includes("rotation")));

  // 4) クリップごとに別ノードなら警告しない
  const separateNodes = await mount("separate-nodes", { model: SEPARATE_NODES, camera: { fromModel: "Cam" }, animationClip: "*" });
  assert.equal(separateNodes.status, "ready");
  assert.deepEqual(separateNodes.warnings, []);

  // 5) 同じノードでも別プロパティなら警告しない
  const separateProperties = await mount("separate-properties", { model: SEPARATE_PROPERTIES, camera: { fromModel: "Cam" }, animationClip: "*" });
  assert.equal(separateProperties.status, "ready");
  assert.deepEqual(separateProperties.warnings, []);

  // 6) クリップ名を指定した宣言は警告しない（衝突する glb でも 1 本だけ掛かる）
  const named = await mount("named", { model: CONFLICT, camera: { fromModel: "Cam" }, animationClip: "W1" });
  assert.equal(named.status, "ready");
  assert.deepEqual(named.warnings, []);

  // 7) クリップが 1 本だけの "*" は警告しない
  const single = await mount("single", { model: SINGLE_CLIP, camera: { fromModel: "Cam" }, animationClip: "*" });
  assert.equal(single.status, "ready");
  assert.deepEqual(single.warnings, []);

  // 8) assets/ の既存 GLB は clip を持たない = "*" でも新規警告は 0 件
  const assets = [
    "assets/scene3d/vintage-camera-turntable/camera-01.glb",
    "assets/scene3d/smartphone-mockup/model.glb",
  ];
  const assetSummary = assets.map((path) => ({ path, animations: glbAnimationSummary(resolve(ROOT, path)) }));
  assert.deepEqual(assetSummary.flatMap((asset) => asset.animations), []);
  t.diagnostic(`assets/ の既存 GLB ${assetSummary.length} 件 / animation clip ${assetSummary.flatMap((asset) => asset.animations).length} 件 / 新規警告 0 件`);
});
