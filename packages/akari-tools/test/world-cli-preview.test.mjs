import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildWorld } from "../src/world/build.mjs";
import { previewTimes, previewWorld } from "../src/world/preview.mjs";

const fixture = new URL("../../schemas/examples/world-map-v3-flat-valid/planning/world-map.json", import.meta.url);

async function project(t) {
  const root = await mkdtemp(path.join(tmpdir(), "akari-world-preview-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await mkdir(path.join(root, "planning"), { recursive: true });
  await cp(fixture, path.join(root, "planning", "world-map.json"));
  await writeFile(path.join(root, "edit.json"), `${JSON.stringify({ version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [], tracks: [{ id: "v1", lane: "visual", items: [] }] }, null, 2)}\n`);
  await buildWorld(root);
  return root;
}

test("world preview: 代表時点 PNG と camera-proof の時点集合を生成する", async (t) => {
  const root = await project(t);
  const map = JSON.parse(await readFile(path.join(root, "planning", "world-map.json"), "utf8"));
  const capture = async ({ times, outputDir }) => {
    const files = new Map();
    for (const time of times) { const file = path.join(outputDir, `fake-${time}.png`); await writeFile(file, "png"); files.set(time, file); }
    return files;
  };
  const result = await previewWorld(root, { capture });
  assert.equal(result.files.size, previewTimes(map).length);
  assert.deepEqual(result.frames.map((frame) => frame.time), previewTimes(map));
  const proof = JSON.parse(await readFile(result.proofPath, "utf8"));
  assert.deepEqual(proof.frames.map((frame) => frame.time), previewTimes(map));
});

test("world preview --measure: cover 以外の JSON 値を変えない", async (t) => {
  const root = await project(t);
  const file = path.join(root, "planning", "world-map.json");
  const before = JSON.parse(await readFile(file, "utf8"));
  const capture = async ({ times, outputDir }) => {
    const files = new Map();
    for (const time of times) { const target = path.join(outputDir, `fake-${time}.png`); await writeFile(target, String(time)); files.set(time, target); }
    return files;
  };
  const result = await previewWorld(root, { capture, measure: true, measureFrame: async (file) => ({ covered: Number((await readFile(file, "utf8"))) >= 5 && Number((await readFile(file, "utf8"))) <= 5.1 }) });
  const after = JSON.parse(await readFile(file, "utf8"));
  const strip = (value) => ({ ...value, edges: value.edges.map((edge) => ({ ...edge, transition: { ...edge.transition, cover: null } })) });
  assert.deepEqual(strip(after), strip(before));
  assert.equal(result.measurements.length, 2);
  assert.notEqual(after.edges[1].transition.cover, before.edges[1].transition.cover);
});

test("world preview: spatial も同じ rasterize capture 契約へ渡す", async (t) => {
  const root = await project(t);
  await cp(new URL("../../schemas/examples/world-map-v3-spatial-valid/planning/world-map.json", import.meta.url), path.join(root, "planning", "world-map.json"));
  await buildWorld(root);
  let receivedHtml = "";
  const result = await previewWorld(root, { capture: async ({ html, times, outputDir }) => {
    receivedHtml = html;
    const files = new Map();
    for (const time of times) { const file = path.join(outputDir, `spatial-${time}.png`); await writeFile(file, "png"); files.set(time, file); }
    return files;
  } });
  assert.match(receivedHtml, /data-akari-3d-scene/);
  const map = JSON.parse(await readFile(path.join(root, "planning", "world-map.json"), "utf8"));
  assert.equal(result.frames.length, previewTimes(map).length);
  assert.ok(result.frames.every((frame) => Array.isArray(frame.camera.eye) && Array.isArray(frame.camera.target)));
});
