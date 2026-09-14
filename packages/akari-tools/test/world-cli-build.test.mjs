import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openProject } from "../../edit-store/lib/project.js";
import { runWorldCommand } from "../bin/world.mjs";
import { buildWorld } from "../src/world/build.mjs";
import { createCamera } from "../src/world/camera.mjs";

const fixture = new URL("../../schemas/examples/world-map-v3-flat-valid/planning/world-map.json", import.meta.url);

async function project(t) {
  const root = await mkdtemp(path.join(tmpdir(), "akari-world-build-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await mkdir(path.join(root, "planning"), { recursive: true });
  await cp(fixture, path.join(root, "planning", "world-map.json"));
  await writeFile(path.join(root, "edit.json"), `${JSON.stringify({ version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [], tracks: [{ id: "v1", lane: "visual", items: [] }] }, null, 2)}\n`);
  return root;
}

test("world build: 宣言、3 sheets、6 zones を決定論的に生成して edit-store で読める", async (t) => {
  const root = await project(t);
  const first = await buildWorld(root);
  const firstBytes = await readFile(first.overlayPath);
  const second = await buildWorld(root);
  const secondBytes = await readFile(second.overlayPath);
  assert.deepEqual(secondBytes, firstBytes);
  const html = secondBytes.toString("utf8");
  assert.match(html, /data-akari-world-scene/);
  assert.equal((html.match(/class="akari-world-sheet"/g) ?? []).length, 3);
  assert.equal((html.match(/class="akari-world-zone"/g) ?? []).length, 6);
  const opened = await openProject(root);
  assert.deepEqual(opened.edit.find("world").source, { kind: "html", path: "overlays/world.html" });
  assert.equal(opened.edit.find("world").duration, 450);
});

test("world build: 全 zone の left/top は world 座標と一致する", async (t) => {
  const root = await project(t);
  const { map, html } = await buildWorld(root);
  const positions = new Map([...html.matchAll(/class="akari-world-zone" data-zone="([^"]+)" style="left:([-\d.]+)px; top:([-\d.]+)px"/g)]
    .map((match) => [match[1], [Number(match[2]), Number(match[3])]]));
  assert.equal(positions.size, 6);
  for (const zone of map.zones) assert.deepEqual(positions.get(zone.id), zone.c);
});

test("world build: sheet-local 座標は camera の画面座標式と一致する", async (t) => {
  const root = await project(t);
  const { map, html } = await buildWorld(root);
  const sheetPositions = new Map([...html.matchAll(/class="akari-world-sheet" data-world="([^"]+)" style="left:([-\d.]+)px; top:([-\d.]+)px;/g)]
    .map((match) => [match[1], [Number(match[2]), Number(match[3])]]));
  const zonePositions = new Map([...html.matchAll(/class="akari-world-zone" data-zone="([^"]+)" style="left:([-\d.]+)px; top:([-\d.]+)px"/g)]
    .map((match) => [match[1], [Number(match[2]), Number(match[3])]]));
  const frame = JSON.parse(html.match(/<script type="application\/json" data-akari-world-scene>([\s\S]*?)<\/script>/)[1]).frame;
  const camera = createCamera(map);
  const times = map.cameraStops.flatMap((stop) => [stop.at, (stop.at + stop.leave) / 2]);
  for (const time of times) {
    const cam = camera(time);
    for (const zone of map.zones) {
      const [sheetLeft, sheetTop] = sheetPositions.get(zone.world);
      const [zoneLeft, zoneTop] = zonePositions.get(zone.id);
      const actualX = sheetLeft + (frame.width / 2 - cam.x * cam.scale) + zoneLeft * cam.scale;
      const actualY = sheetTop + (frame.height / 2 - cam.y * cam.scale) + zoneTop * cam.scale;
      const expectedX = frame.width / 2 + (zone.c[0] - cam.x) * cam.scale;
      const expectedY = frame.height / 2 + (zone.c[1] - cam.y) * cam.scale;
      assert.ok(Math.abs(actualX - expectedX) <= 1, `${zone.id} の x が t=${time} で一致しません`);
      assert.ok(Math.abs(actualY - expectedY) <= 1, `${zone.id} の y が t=${time} で一致しません`);
    }
  }
});

test("world build: spatial GLB と three 断片を決定論的に生成して upsert する", async (t) => {
  const root = await project(t);
  await cp(new URL("../../schemas/examples/world-map-v3-spatial-valid/planning/world-map.json", import.meta.url), path.join(root, "planning", "world-map.json"));
  const first = await buildWorld(root);
  const firstGlb = await readFile(first.glbPath);
  const firstHtml = await readFile(first.overlayPath);
  const second = await buildWorld(root);
  assert.deepEqual(await readFile(second.glbPath), firstGlb);
  assert.deepEqual(await readFile(second.overlayPath), firstHtml);
  assert.equal(firstGlb.readUInt32LE(0), 0x46546c67);
  assert.match(firstHtml.toString("utf8"), /data-akari-3d-scene/);
  const declaration = JSON.parse(firstHtml.toString("utf8").match(/data-akari-3d-scene>(.*?)<\/script>/s)[1]);
  assert.deepEqual(Object.keys(declaration), ["model", "camera", "animationClip", "environment", "lights", "fog", "background"]);
  assert.deepEqual(declaration.camera, { fromModel: "TourCamera" });
  assert.equal(declaration.animationClip, "Tour");
  for (const world of first.map.worlds) {
    const grid = first.gltf.nodes.find((node) => node.name === `World grid ${world.id}`);
    assert.ok(grid);
    const material = first.gltf.materials[first.gltf.meshes[grid.mesh].primitives[0].material];
    assert.equal(material.name, `${world.palette.dots}:1`);
  }
  assert.ok(first.gltf.nodes.some((node) => node.name === "Transition fog center-stair"));
  assert.equal(first.gltf.animations.find((animation) => animation.name === "Tour").channels.length, 3);
  const opened = await openProject(root);
  assert.deepEqual(opened.edit.find("world").source, { kind: "html", path: "overlays/world.html" });
  assert.equal((await runWorldCommand(["build", root], { logError: () => {} })).exitCode, 0);
});

test("world build: edit.json v1 は変更せず migrate 案内で fail-closed にする", async (t) => {
  const root = await project(t);
  const file = path.join(root, "edit.json");
  const legacy = `${JSON.stringify({ version: 1, output: { width: 1920, height: 1080, fps: 30 }, sources: [{ id: "base", path: "base.mp4" }], cuts: [{ src: "base", in: 0, out: 1 }], overlays: [] }, null, 2)}\n`;
  await writeFile(file, legacy);
  await assert.rejects(() => buildWorld(root), /先に akari migrate <project-root> を実行してください/);
  assert.equal(await readFile(file, "utf8"), legacy);
});

test("world build: world-items の overlay 断片と CSS 変数を zone へ差し込む", async (t) => {
  const root = await project(t);
  const asset = path.join(root, "resolved-overlay");
  await mkdir(asset);
  await writeFile(path.join(asset, "fragment.html"), '<strong data-fragment>hello</strong>');
  await writeFile(path.join(root, "planning", "world-items.json"), `${JSON.stringify({ schemaVersion: 1, items: [{ id: "hello", zone: "atelier-desk", asset: "overlay/hello", offset: [4, -2], scale: 1.25, vars: { color: "#fff" } }] }, null, 2)}\n`);
  const result = await buildWorld(root, { resolveAsset: async () => ({ category: "overlay", dir: asset }) });
  assert.match(result.html, /data-fragment/);
  assert.match(result.html, /--color:#fff/);
  assert.match(result.html, /--akari-item-scale:1.25/);
});

test("world build: spatial の GLB を持つ overlay item を zone 配下へ統合する", async (t) => {
  const root = await project(t);
  await cp(new URL("../../schemas/examples/world-map-v3-spatial-valid/planning/world-map.json", import.meta.url), path.join(root, "planning", "world-map.json"));
  const base = await buildWorld(root);
  await writeFile(path.join(root, "planning", "world-items.json"), `${JSON.stringify({ schemaVersion: 1, items: [{ id: "prop", zone: "hall-door", asset: "overlay/prop", offset: [2, -1], scale: 0.5 }] }, null, 2)}\n`);
  const result = await buildWorld(root, { resolveAsset: async () => ({ category: "overlay", dir: path.dirname(base.glbPath) }) });
  const item = result.gltf.nodes.find((node) => node.name === "World item prop");
  assert.deepEqual(item.translation, [-2, 1, 9]);
  assert.deepEqual(item.scale, [0.5, 0.5, 0.5]);
  assert.ok(result.gltf.animations.some((animation) => animation.name === "prop:Tour"));
  assert.equal(result.gltf.animations.at(-1).name, "Tour");
});
