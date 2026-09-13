import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openProject } from "../../edit-store/lib/project.js";
import { runWorldCommand } from "../bin/world.mjs";
import { buildWorld, SpatialWorldBuildError } from "../src/world/build.mjs";

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

test("world build: spatial は案内つき exit 2 相当で拒否する", async (t) => {
  const root = await project(t);
  const map = JSON.parse(await readFile(path.join(root, "planning", "world-map.json"), "utf8"));
  map.kind = "spatial";
  map.worlds = map.worlds.map(({ id, label, palette }) => ({ id, label, palette, spatial: { c: [0, 0, 0] } }));
  map.zones = map.zones.map((zone) => ({ ...zone, c: [...zone.c, 0] }));
  map.cameraStops = map.cameraStops.map(({ c, ...stop }) => ({ ...stop, eye: [c[0], c[1], 10], target: [c[0], c[1], 0] }));
  await writeFile(path.join(root, "planning", "world-map.json"), `${JSON.stringify(map, null, 2)}\n`);
  await assert.rejects(() => buildWorld(root), (error) => error instanceof SpatialWorldBuildError && error.exitCode === 2 && /GLB/.test(error.message));
  const errors = [];
  const result = await runWorldCommand(["build", root], { logError: (line) => errors.push(line) });
  assert.equal(result.exitCode, 2);
  assert.match(errors.join("\n"), /GLB/);
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
