import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";

import { appendLayersAdditive } from "../src/eye-bar/edit-apply.mjs";
import { parseArguments } from "../bin/avatar-vrm/arguments.mjs";
import { EXPRESSION_NAMES, expressionValues, validateDriveDocument } from "../bin/avatar-vrm/drive.mjs";
import { findChrome } from "../bin/avatar-vrm/find-chrome.mjs";
import { buildAvatarVrmLayer } from "../bin/avatar-vrm/layer.mjs";

test("avatar-vrm: 口形と blink は毎フレーム 6 expression を明示する", () => {
  const expected = {
    closed: null, a: "aa", i: "ih", u: "ou", e: "ee", o: "oh",
  };
  for (const [mouth, active] of Object.entries(expected)) {
    const values = expressionValues(mouth, "open");
    assert.deepEqual(Object.keys(values), EXPRESSION_NAMES);
    for (const name of EXPRESSION_NAMES) {
      assert.equal(values[name], name === active ? 1 : 0, `${mouth} -> ${name}`);
    }
  }
  assert.deepEqual(expressionValues("closed", "closed"), {
    aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, blink: 1,
  });
});

test("avatar-vrm vendor bridge: 実 three-vrm の VRM1/MToon/update API を使う", async () => {
  const context = vm.createContext({
    console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, Blob,
    Request, Response, Headers, fetch, structuredClone, performance,
  });
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.runInContext(readFileSync(new URL("../../overlay-runtime/src/vendor/three-bundle.js", import.meta.url), "utf8"), context);
  vm.runInContext(readFileSync(new URL("../../overlay-runtime/src/vendor/avatar-vrm-bundle.js", import.meta.url), "utf8"), context);
  const { THREE, VRMLoaderPlugin, VRMUtils } = context.AkariThree;
  assert.equal(THREE.REVISION, "185");
  assert.equal(typeof VRMLoaderPlugin, "function");
  assert.equal(typeof VRMUtils, "function");

  const fixture = readFileSync(new URL("./fixtures/avatar-vrm/minimal-avatar-vrm1.vrm", import.meta.url));
  const jsonLength = fixture.readUInt32LE(12);
  const json = JSON.parse(fixture.subarray(20, 20 + jsonLength).toString("utf8").trim());
  const nodes = json.nodes.map(() => new THREE.Object3D());
  json.nodes.forEach((node, index) => {
    nodes[index].name = node.name;
    nodes[index].position.fromArray(node.translation ?? [0, 0, 0]);
    for (const child of node.children ?? []) nodes[index].add(nodes[child]);
  });
  const morphMesh = new THREE.Mesh();
  morphMesh.morphTargetInfluences = [0, 0, 0, 0, 0, 0];
  nodes[17].add(morphMesh);
  const scene = new THREE.Scene();
  for (const root of json.scenes[0].nodes) scene.add(nodes[root]);
  const parser = {
    json,
    associations: new Map(),
    options: { path: "" },
    getDependency: async (kind, index) => {
      if (kind === "node") return nodes[index];
      throw new Error(`unexpected dependency: ${kind}[${index}]`);
    },
    getDependencies: async (kind) => {
      if (kind === "node") return nodes;
      throw new Error(`unexpected dependencies: ${kind}`);
    },
  };
  const plugin = new VRMLoaderPlugin(parser);
  assert.equal(plugin.humanoidPlugin.helperRoot, undefined);
  await plugin.beforeRoot();
  const gltf = { scene, userData: {}, parser };
  await plugin.afterRoot(gltf);
  const vrm = gltf.userData.vrm;
  assert.ok(vrm);
  assert.deepEqual(Object.keys(vrm.expressionManager.expressionMap).sort(), [...EXPRESSION_NAMES].sort());
  assert.equal(vrm.humanoid.getRawBoneNode("head"), nodes[4]);

  vrm.expressionManager.setValue("aa", 1);
  vrm.update(0);
  assert.deepEqual(morphMesh.morphTargetInfluences, [1, 0, 0, 0, 0, 0]);
  vrm.expressionManager.setValue("aa", 0);
  vrm.expressionManager.setValue("blink", 1);
  vrm.update(0);
  assert.deepEqual(morphMesh.morphTargetInfluences, [0, 0, 0, 0, 0, 1]);

  const MToonMaterial = plugin.getMaterialType(2);
  const materialParams = {};
  await plugin.extendMaterialParams(2, materialParams);
  assert.equal(materialParams.transparentWithZWrite, false);
  assert.deepEqual(Array.from(materialParams.shadeColorFactor.toArray()), [0.05, 0.35, 0.6]);
  const material = new MToonMaterial(materialParams);
  assert.equal(material.isMToonMaterial, true);
  vrm.materials = [material];
  const uvState = () => [material.uvAnimationScrollXOffset, material.uvAnimationScrollYOffset, material.uvAnimationRotationPhase];
  const before = uvState();
  vrm.update(0);
  vrm.update(0);
  assert.deepEqual(uvState(), before);
});

test("avatar-vrm vendor bridge: 実 three-vrm が VRM1/MToon/expression を headless 描画する", {
  skip: findChrome() ? false : "Chrome for Testing が見つかりません",
}, async (context) => {
  let launchAvatarVrmBrowser;
  try {
    ({ launchAvatarVrmBrowser } = await import("../bin/avatar-vrm/browser.mjs"));
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" && /puppeteer-core/.test(error.message)) {
      context.skip("puppeteer-core が配置されていません");
      return;
    }
    throw error;
  }
  const browser = await launchAvatarVrmBrowser();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    await page.setViewport({ width: 720, height: 720, deviceScaleFactor: 1 });
    await page.goto(new URL("../bin/avatar-vrm/render.html", import.meta.url).href, { waitUntil: "load" });
    await page.waitForFunction(() => document.body.dataset.ready === "true");
    const modelData = readFileSync(new URL("./fixtures/avatar-vrm/minimal-avatar-vrm1.vrm", import.meta.url)).toString("base64");
    const loaded = await page.evaluate(
      ({ url }) => window.avatarVrmRenderer.loadModel(url, "bust"),
      { url: `data:model/gltf-binary;base64,${modelData}` },
    );
    assert.deepEqual(loaded.expressions, [...EXPRESSION_NAMES].sort());
    assert.equal(loaded.mtoonMaterialCount, 3);
    assert.equal(loaded.threeRevision, "185");

    await page.evaluate(() => window.avatarVrmRenderer.renderExpressions({}));
    const neutral = Buffer.from(await page.screenshot({ omitBackground: true }));
    await page.evaluate(() => window.avatarVrmRenderer.renderExpressions({ aa: 1 }));
    const aa = Buffer.from(await page.screenshot({ omitBackground: true }));
    await page.evaluate(() => window.avatarVrmRenderer.renderExpressions({ blink: 1 }));
    const blink = Buffer.from(await page.screenshot({ omitBackground: true }));
    assert.notDeepEqual(aa, neutral);
    assert.notDeepEqual(blink, neutral);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
});

test("avatar-vrm: drive は語彙・同長・fps を検証する", () => {
  const valid = { drive: { fps: 30, mouth: ["closed", "a", "i", "u", "e", "o"], eyes: ["open", "open", "open", "open", "closed", "open"] } };
  assert.deepEqual(validateDriveDocument(valid), valid.drive);
  assert.throws(() => validateDriveDocument({ drive: { ...valid.drive, eyes: ["open"] } }), /長さ/);
  assert.throws(() => validateDriveDocument({ drive: { ...valid.drive, mouth: ["x"], eyes: ["open"] } }), /mouth\[0\]/);
  assert.throws(() => validateDriveDocument({ drive: { ...valid.drive, fps: 0 } }), /fps/);
});

test("avatar-vrm: 引数の既定値と不正値を外部処理前に確定する", () => {
  const parsed = parseArguments(["--model", "model.vrm", "--drive", "drive.json", "--out", "avatar.mov"]);
  assert.equal(parsed.framing, "bust");
  assert.equal(parsed.position, "right-bottom");
  assert.equal(parsed.outputWidth, 1920);
  assert.equal(parsed.outputHeight, 1080);
  assert.throws(() => parseArguments(["--framing", "face"]), /framing/);
  assert.throws(() => parseArguments(["--position", "somewhere"]), /position/);
  assert.throws(() => parseArguments(["--scale", "0"]), /正数/);
  assert.throws(() => parseArguments(["--apply"]), /project/);
});

test("avatar-vrm: layer は baked schema 形状・配置・相対 src を満たす", () => {
  const root = "/tmp/avatar-project";
  const layer = buildAvatarVrmLayer({
    projectRoot: root,
    outPath: join(root, ".akari", "cache", "avatar-vrm.mov"),
    outputWidth: 1920,
    outputHeight: 1080,
    duration: 12,
    position: "right-bottom",
    scale: 0.5,
    framing: "bust",
  });
  assert.deepEqual(layer, {
    id: "avatar-vrm-0", t: 0, duration: 12, kind: "baked",
    src: ".akari/cache/avatar-vrm.mov",
    transform: { x: 732, y: 312, scale: 0.5, rotate: 0 },
    preset: "avatar-vrm-v0",
    params: { framing: "bust", position: "right-bottom" },
  });
  const explicit = buildAvatarVrmLayer({
    outPath: "/tmp/avatar.mov", outputWidth: 1280, outputHeight: 720,
    duration: 1, position: "320,240", scale: 1,
  });
  assert.equal(explicit.transform.x, -320);
  assert.equal(explicit.transform.y, -120);
});

test("avatar-vrm: --apply と同じ共有経路は既存 JSON 不変の末尾追記", () => {
  const root = mkdtempSync(join(tmpdir(), "avatar-vrm-apply-"));
  const editPath = join(root, "edit.json");
  const original = {
    version: 0, output: { width: 1280, height: 720, fps: 30 },
    source: { path: "source.mp4", proxy: null }, cuts: [{ in: 0, out: 2 }],
    overlays: [{ id: "keep", html: "keep.html", start: 0, duration: 1 }],
    layers: [{ id: "existing", t: 0, duration: 1, kind: "video", src: "pip.mp4" }],
  };
  writeFileSync(editPath, `${JSON.stringify(original, null, 2)}\n`);
  const layer = buildAvatarVrmLayer({
    projectRoot: root, outPath: join(root, "avatar.mov"), outputWidth: 1280,
    outputHeight: 720, duration: 2, position: "center",
  });
  assert.equal(appendLayersAdditive(editPath, [layer]).ok, true);
  const applied = JSON.parse(readFileSync(editPath, "utf8"));
  assert.deepEqual({ ...applied, layers: applied.layers.slice(0, -1) }, original);
  assert.equal(applied.layers.at(-1).preset, "avatar-vrm-v0");
  assert.equal(appendLayersAdditive(editPath, [layer]).ok, false);
});

test("avatar-vrm fixture: generator は同一 byte 列と VRM1/MToon/6 expressions を作る", () => {
  const root = mkdtempSync(join(tmpdir(), "avatar-vrm-fixture-test-"));
  const fixtureRoot = new URL("./fixtures/avatar-vrm/", import.meta.url).pathname;
  const fixture = join(fixtureRoot, "minimal-avatar-vrm1.vrm");
  const before = readFileSync(fixture);
  const generated = spawnSync(process.execPath, [join(fixtureRoot, "generate.mjs")], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  assert.deepEqual(readFileSync(fixture), before);
  writeFileSync(join(root, "copy.vrm"), before);
  const jsonLength = before.readUInt32LE(12);
  const json = JSON.parse(before.subarray(20, 20 + jsonLength).toString("utf8").trim());
  assert.equal(json.extensions.VRMC_vrm.specVersion, "1.0");
  assert.equal(json.extensions.VRMC_vrm.meta.licenseUrl, "https://vrm.dev/licenses/1.0/");
  assert.deepEqual(Object.keys(json.extensions.VRMC_vrm.expressions.preset), EXPRESSION_NAMES);
  assert.ok(json.extensionsUsed.includes("VRMC_materials_mtoon"));
  assert.ok(json.materials.some((material) => material.alphaMode === "BLEND" && material.extensions?.VRMC_materials_mtoon));
  assert.equal(json.extensions.VRMC_vrm.humanoid.humanBones.head.node, 4);
});

test("avatar-vrm CLI: 必須入力なしは exit 2、--check は 1 行 JSON", () => {
  const script = new URL("../bin/avatar-vrm.mjs", import.meta.url).pathname;
  const missing = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(missing.status, 2);
  assert.match(JSON.parse(missing.stdout).reason, /--model/);
  const checked = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  assert.equal(checked.stdout.trim().split("\n").length, 1);
  assert.equal(typeof JSON.parse(checked.stdout).available, "boolean");
});

test("avatar-vrm CLI: 状態列の長さ不一致はブラウザ起動前に exit 1", () => {
  const root = mkdtempSync(join(tmpdir(), "avatar-vrm-invalid-drive-"));
  const model = join(root, "model.vrm");
  const drive = join(root, "drive.json");
  writeFileSync(model, "fixture placeholder");
  writeFileSync(drive, JSON.stringify({ drive: { fps: 30, mouth: ["a", "i"], eyes: ["open"] } }));
  const script = new URL("../bin/avatar-vrm.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [script, "--model", model, "--drive", drive, "--out", join(root, "out.mov")], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).reason, /長さ/);
});
