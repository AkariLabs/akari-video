import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildWorld, renderWorldHtml } from "../src/world/build.mjs";
import { validateWorldItems } from "../src/world/items.mjs";

const fixture = new URL("../../schemas/examples/world-map-v3-flat-valid/planning/world-map.json", import.meta.url);
const item = { id: "frame", zone: "garden-pond", asset: "overlay/sample-kit-frame" };

async function project(t) {
  const root = await mkdtemp(path.join(tmpdir(), "akari-world-item-clock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "planning"), { recursive: true });
  await cp(fixture, path.join(root, "planning", "world-map.json"));
  await writeFile(path.join(root, "edit.json"), JSON.stringify({ version: 2, output: { width: 320, height: 180, fps: 30 }, sources: [], tracks: [{ id: "v1", lane: "visual", items: [] }] }));
  const asset = path.join(root, "resolved-overlay");
  await cp(new URL("../../schemas/examples/kit-manifest-v1-with-asset/assets/overlay/sample-kit-frame/", import.meta.url), asset, { recursive: true });
  return { root, resolveAsset: async () => ({ category: "overlay", dir: asset }) };
}

test("world item clock: build は到着 + delay と背景 role を決定論的に出力する", async t => {
  const { root, resolveAsset } = await project(t);
  const variants = [{}, { delay: 0.5 }, { role: "background" },
    ...["world-width", "world-height", "--world-width", "--world-height"].map(key => ({ vars: { [key]: 640 } }))];
  await writeFile(path.join(root, "planning", "world-items.json"), JSON.stringify({ schemaVersion: 1, items: variants.map((variant, index) => ({ ...item, id: `frame-${index}`, ...variant })) }));
  const first = await buildWorld(root, { resolveAsset });
  assert.equal((await buildWorld(root, { resolveAsset })).html, first.html);
  const tags = [...first.html.matchAll(/<div class="akari-world-item"[^>]*>/g)].map(match => match[0]);
  assert.equal(tags.length, variants.length);
  const at = first.map.cameraStops.find(stop => stop.id === item.zone).at;
  tags.forEach((tag, index) => {
    assert.ok(tag.includes(`data-akari-item-start="${at + (variants[index].delay ?? 0)}"`));
    assert.equal(tag.includes('data-akari-role="background"'), index >= 2);
  });
});

test("world item clock: 対応 stop がない zone は delay があっても開始 0", async () => {
  const map = JSON.parse(await readFile(fixture, "utf8"));
  map.cameraStops = map.cameraStops.filter(stop => stop.id !== item.zone);
  const html = renderWorldHtml(map, [{ ...item, delay: 2 }], new Map([[item.id, "<b>frame</b>"]]), { width: 320, height: 180 });
  assert.match(html, /data-item="frame" data-akari-item-start="0"/);
});

test("world item clock: delay は 0 以上の有限数、role は background のみ", () => {
  const validate = extra => validateWorldItems({ schemaVersion: 1, items: [{ ...item, ...extra }] });
  for (const delay of [-0.1, NaN, Infinity, -Infinity, "1", null]) assert.throws(() => validate({ delay }), /delay は 0 以上の有限数/);
  for (const role of ["foreground", "", null, 1]) assert.throws(() => validate({ role }), /role は background/);
  for (const extra of [{}, { delay: 0 }, { delay: 0.5, role: "background" }]) assert.doesNotThrow(() => validate(extra));
});
