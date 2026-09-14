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
  assert.deepEqual(spatial.edges[1].transition, { kind: "dive", cover: 0.18 });

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

test("v4 方言の cover ラベルと pattern を表に従って v3 へ正規化する", () => {
  const source = v2FlatFixture();
  source.worlds[0].pattern = "rings";
  source.edges[1].transition.cover = "Chat handoff";
  source.edges[3].transition.cover = "Cut handoff";

  const { map, notes } = normalizeWorldMap(source);
  assert.equal(map.edges[1].transition.cover, 0.18);
  assert.equal(map.edges[3].transition.cover, 0.24);
  assert.equal(map.edges[1].via, source.edges[1].via);
  assert.equal(map.edges[3].via, source.edges[3].via);
  assert.equal(map.worlds[0].flat.pattern, "none");
  assert.ok(notes.includes('edge shelf-pond の cover のラベル "Chat handoff" は v3 に写せない（暫定値 0.18 を入れた。measure で実測する）'));
  assert.ok(notes.includes('edge arch-ladder の cover のラベル "Cut handoff" は v3 に写せない（暫定値 0.24 を入れた。measure で実測する）'));
  assert.ok(notes.includes('world atelier の pattern "rings" は v3 に無いので none にした'));
});

test("v2 の非有限 cover は type 別の有限暫定値へ落とす", () => {
  const source = v2FlatFixture();
  const cases = [
    { index: 0, type: "move", cover: null, expected: 0 },
    { index: 1, type: "portal", cover: undefined, expected: 0.18 },
    { index: 3, type: "cut", cover: Number.NaN, expected: 0.24 },
  ];
  for (const entry of cases) source.edges[entry.index].transition.cover = entry.cover;

  const { map, notes } = normalizeWorldMap(source);
  for (const entry of cases) {
    const edge = map.edges[entry.index];
    assert.equal(edge.type, entry.type);
    assert.equal(edge.transition.cover, entry.expected);
    assert.ok(notes.includes(`edge ${edge.id} の cover は未測定（暫定値 ${entry.expected} を入れた。measure で実測する）`));
  }
  assert.ok(map.edges.every((edge) => Number.isFinite(edge.transition.cover)));
});

test("transition が無い非 move 辺にも type 別の有限暫定値を入れる", () => {
  const source = v2FlatFixture();
  delete source.edges[1].transition;
  delete source.edges[3].transition;
  const { map, notes } = normalizeWorldMap(source);
  assert.deepEqual(map.edges[1].transition, { kind: "dive", cover: 0.18 });
  assert.deepEqual(map.edges[3].transition, { kind: "mist", cover: 0.24 });
  assert.ok(notes.includes("edge shelf-pond の cover は未測定（暫定値 0.18 を入れた。measure で実測する）"));
  assert.ok(notes.includes("edge arch-ladder の cover は未測定（暫定値 0.24 を入れた。measure で実測する）"));
});

for (const cover of [0, 0.9]) {
  test(`v2 の有限 cover (${cover}) は変更しない`, () => {
    const source = v2FlatFixture();
    source.edges[3].transition.cover = cover;
    assert.equal(normalizeWorldMap(source).map.edges[3].transition.cover, cover);
  });
}

for (const transition of ["dive", ["dive"]]) {
  test(`object でない transition (${JSON.stringify(transition)}) は例外なくそのまま写す`, () => {
    const source = v2FlatFixture();
    source.edges[0].transition = transition;
    let result;
    assert.doesNotThrow(() => { result = normalizeWorldMap(source); });
    assert.deepEqual(result.map.edges[0].transition, transition);
    assert.ok(checkWorldMap(result.map, { strict: false }).errors.length > 0);
  });
}

test("null の transition は move の既定 object へ治す", () => {
  const source = v2FlatFixture();
  source.edges[0].transition = null;
  assert.deepEqual(normalizeWorldMap(source).map.edges[0].transition, { kind: "none", cover: 0 });
});

function fixture(name) {
  return JSON.parse(fs.readFileSync(join(examples, name, "planning", "world-map.json"), "utf8"));
}

function v2FlatFixture() {
  const source = fixture("world-map-v3-flat-valid");
  source.schemaVersion = 2;
  source.worlds = source.worlds.map((world) => ({ ...world, ...world.flat, flat: undefined }));
  return source;
}
