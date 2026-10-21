// terrain / lines の入力収集と data URI 埋め込み（task 2026-10-21-scene3d-terrain-lines の r1）。
//
// 書き出し（render-cut）と capture は runtimes.mjs の extractRuntimeAssetReferences で入力を列挙し、
// entry.embed（embedThreeModels）で実体を data URI にする。どちらかが terrain / lines を知らないと、
// 地形と線だけの断片が「3D model must be a relative path」で止まるか、画像がシートに載らない。
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractRuntimeAssetReferences, runtimes } from "../runtimes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, "fixtures/terrain-4x4.png");
const FIXTURE_BASE64 = readFileSync(FIXTURE).toString("base64");
const THREE = runtimes.find(entry => entry.id === "three");
const TERRAIN = { heightmap: "media/height.png", texture: "media/photo.png", exaggeration: 2 };
const LINES = [
  { points: [[0, 0, 0], [1, 1, 0], [2, 0, 0]], color: "#ff3366", width: 12, progress: 0.4 },
  { points: [[-1, 0, 0], [1, 0, 0]], keys: [{ t: 0, progress: 0 }, { t: 3, progress: 1 }] },
];
const MODEL = "models/world.glb";

function htmlFor(descriptor) {
  return `<div><script type="application/json" data-akari-3d-scene>${JSON.stringify(descriptor)}</script></div>`;
}

function embeddedDescriptor(html, projectRoot, htmlPath = "fragment.html") {
  const embedded = THREE.embed({ id: "scene", html, htmlPath }, { projectRoot });
  const match = embedded.match(/data-akari-3d-scene>([\s\S]*?)<\/script>/u);
  assert.ok(match, `埋め込み後の宣言が見つかりません: ${embedded}`);
  return JSON.parse(match[1]);
}

function makeProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), "akari-terrain-lines-"));
  mkdirSync(join(projectRoot, "media"), { recursive: true });
  mkdirSync(join(projectRoot, "models"), { recursive: true });
  copyFileSync(FIXTURE, join(projectRoot, "media", "height.png"));
  copyFileSync(FIXTURE, join(projectRoot, "media", "photo.png"));
  writeFileSync(join(projectRoot, "models", "world.glb"), Buffer.from("glTF-test-model"));
  return projectRoot;
}

test("terrain-only fragment: references are listed and both images are embedded", t => {
  const projectRoot = makeProject();
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  const html = htmlFor({ terrain: TERRAIN });

  assert.deepEqual(extractRuntimeAssetReferences(html, "fragment.html", "overlay:scene"), [
    { role: "terrain-heightmap", path: "media/height.png" },
    { role: "terrain-texture", path: "media/photo.png" },
  ]);

  const descriptor = embeddedDescriptor(html, projectRoot);
  assert.equal(descriptor.terrain.heightmap, `data:image/png;base64,${FIXTURE_BASE64}`);
  assert.equal(descriptor.terrain.texture, `data:image/png;base64,${FIXTURE_BASE64}`);
  assert.equal(descriptor.terrain.exaggeration, 2);
  assert.equal(descriptor.model, undefined);
});

test("lines-only fragment: no asset references and the declaration is embedded unchanged", t => {
  const projectRoot = makeProject();
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  const source = { lines: LINES };
  const html = htmlFor(source);

  assert.deepEqual(extractRuntimeAssetReferences(html, "fragment.html", "overlay:scene"), []);
  assert.deepEqual(embeddedDescriptor(html, projectRoot), source);
});

test("terrain + lines + model fragment: all three kinds are listed and embedded", t => {
  const projectRoot = makeProject();
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  const html = htmlFor({ model: MODEL, terrain: TERRAIN, lines: LINES });

  assert.deepEqual(extractRuntimeAssetReferences(html, "fragment.html", "overlay:scene"), [
    { role: "model", path: MODEL },
    { role: "terrain-heightmap", path: "media/height.png" },
    { role: "terrain-texture", path: "media/photo.png" },
  ]);

  const descriptor = embeddedDescriptor(html, projectRoot);
  assert.equal(descriptor.model, `data:model/gltf-binary;base64,${Buffer.from("glTF-test-model").toString("base64")}`);
  assert.equal(descriptor.terrain.heightmap, `data:image/png;base64,${FIXTURE_BASE64}`);
  assert.deepEqual(descriptor.lines, LINES);
});

test("fragment-relative terrain paths resolve beside the fragment first", t => {
  const projectRoot = makeProject();
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  mkdirSync(join(projectRoot, "overlays"), { recursive: true });
  copyFileSync(FIXTURE, join(projectRoot, "overlays", "height.png"));
  const html = htmlFor({ terrain: { heightmap: "height.png" } });

  assert.deepEqual(
    extractRuntimeAssetReferences(html, "overlays/fragment.html", "overlay:scene"),
    [{ role: "terrain-heightmap", path: "overlays/height.png", fallbackPath: "height.png" }],
  );
  const descriptor = embeddedDescriptor(html, projectRoot, "overlays/fragment.html");
  assert.equal(descriptor.terrain.heightmap, `data:image/png;base64,${FIXTURE_BASE64}`);
});

test("terrain input paths are validated before the sheet is built", t => {
  const projectRoot = makeProject();
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  for (const heightmap of [
    "https://example.com/height.png",
    "/tmp/height.png",
    "",
  ]) {
    const html = htmlFor({ terrain: { heightmap } });
    assert.throws(
      () => extractRuntimeAssetReferences(html, "fragment.html", "overlay:scene"),
      /terrain\.heightmap must be a relative path|terrain must be an object/,
      heightmap,
    );
  }
  assert.throws(
    () => extractRuntimeAssetReferences(
      htmlFor({ terrain: { heightmap: "height.png", texture: "https://example.com/photo.png" } }),
      "fragment.html",
      "overlay:scene",
    ),
    /terrain\.texture must be a relative path/,
  );
  assert.throws(
    () => embeddedDescriptor(htmlFor({ terrain: { heightmap: "media/height.jpg" } }), projectRoot),
    /terrain\.heightmap must be a PNG image/,
  );
  assert.throws(
    () => embeddedDescriptor(
      htmlFor({ terrain: { heightmap: "media/height.png", texture: "media/movie.mp4" } }),
      projectRoot,
    ),
    /terrain\.texture must be an image/,
  );
});

test("the model/texts gate still rejects an empty scene", () => {
  assert.throws(
    () => extractRuntimeAssetReferences(htmlFor({}), "fragment.html", "overlay:scene"),
    /3D model must be a relative path/,
  );
  assert.throws(
    () => extractRuntimeAssetReferences(htmlFor({ lines: [] }), "fragment.html", "overlay:scene"),
    /3D model must be a relative path/,
  );
});
