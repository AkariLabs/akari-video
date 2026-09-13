import assert from "node:assert/strict";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkWorldMap } from "../src/world/invariants.mjs";
import { normalizeWorldMap } from "../src/world/normalize.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const examples = join(packageRoot, "..", "schemas", "examples");
const cases = [
  ["world-map-v2-flat-legacy", "flat"],
  ["world-map-v2-spatial-legacy", "spatial"],
  ["world-map-v1-no-worlds-legacy", "spatial"],
];

for (const [name, kind] of cases) {
  test(`${name} は値を保って v3 へ正規化される`, () => {
    const source = fixture(name);
    const { map, notes } = normalizeWorldMap(source);
    assert.equal(map.schemaVersion, 3);
    assert.equal(map.kind, kind);
    assert.ok(notes.length > 0);
    assert.deepEqual(checkWorldMap(map, { strict: true }).errors, []);
    source.zones.forEach((zone, index) => assert.deepEqual(map.zones[index].c, zone.c));
    source.cameraStops.forEach((stop, index) => {
      for (const key of ["at", "leave", "c", "eye", "target"]) if (stop[key] !== undefined) assert.deepEqual(map.cameraStops[index][key], stop[key]);
    });
    if (source.worlds) source.worlds.forEach((world, index) => {
      if (!world.palette) return;
      const actual = map.worlds[index].palette;
      const expected = kind === "spatial"
        ? { background: world.palette.floor, dots: world.palette.dots, accent: world.palette.paper, ...(world.palette.haze === undefined ? {} : { haze: world.palette.haze }) }
        : world.palette;
      assert.deepEqual(actual, expected);
    });
  });
}

test("legacy の既定値と導出規則を適用する", () => {
  const flat = normalizeWorldMap(fixture("world-map-v2-flat-legacy")).map;
  assert.deepEqual(flat.edges[0].transition, { kind: "none", cover: 0 });
  assert.equal(flat.zones[1].label, flat.zones[1].id);

  const spatial = normalizeWorldMap(fixture("world-map-v2-spatial-legacy")).map;
  assert.equal(spatial.edges[1].switchTime, (spatial.edges[1].t0 + spatial.edges[1].t1) / 2);
  assert.equal(spatial.edges[1].transition.kind, "dive");

  const wrapped = normalizeWorldMap(fixture("world-map-v1-no-worlds-legacy")).map;
  assert.deepEqual(wrapped.cameraStops.map((stop) => stop.id), wrapped.zones.map((zone) => zone.id));
  assert.deepEqual(wrapped.edges[0], {
    id: "cloud-start-cloud-end", from: "cloud-start", to: "cloud-end", type: "move",
    t0: wrapped.cameraStops[0].leave, t1: wrapped.cameraStops[1].at, transition: { kind: "none", cover: 0 },
  });
});

test("v3 は deep copy のまま返し notes は空", () => {
  const source = fixture("world-map-v3-flat-valid");
  const result = normalizeWorldMap(source);
  assert.deepEqual(result.map, source);
  assert.notEqual(result.map, source);
  assert.deepEqual(result.notes, []);
});

function fixture(name) {
  return JSON.parse(fs.readFileSync(join(examples, name, "planning", "world-map.json"), "utf8"));
}
