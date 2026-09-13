import assert from "node:assert/strict";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCamera } from "../src/world/camera.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const examples = join(packageRoot, "..", "schemas", "examples");
const maps = [fixture("world-map-v3-flat-valid"), fixture("world-map-v3-spatial-valid")];

for (const map of maps) {
  test(`${map.kind}: 停留所の窓内は静止する`, () => {
    const camera = createCamera(map);
    for (const stop of map.cameraStops) {
      assert.deepEqual(camera(stop.at), camera((stop.at + stop.leave) / 2));
      assert.deepEqual(camera(stop.at), camera(stop.leave));
      assert.equal(camera(stop.at).phase, "stop");
    }
  });

  test(`${map.kind}: 全停留所の at / leave 境界は連続する`, () => {
    const camera = createCamera(map);
    for (const stop of map.cameraStops) {
      close(camera(stop.leave), camera(stop.leave + 1e-4), map.kind, 1e-3);
      close(camera(stop.at - 1e-4), camera(stop.at), map.kind, 1e-3);
    }
  });

  test(`${map.kind}: 非 move は switchTime ちょうどで world を替える`, () => {
    const camera = createCamera(map);
    for (const edge of map.edges.filter((item) => item.type !== "move")) {
      const from = map.cameraStops.find((stop) => stop.id === edge.from);
      const to = map.cameraStops.find((stop) => stop.id === edge.to);
      assert.equal(camera(edge.switchTime - 1e-6).world, from.world);
      assert.equal(camera(edge.switchTime - 1e-6).phase, "approach");
      assert.equal(camera(edge.switchTime).world, to.world);
      assert.equal(camera(edge.switchTime).phase, "escape");
      assert.equal(camera(edge.switchTime + 1e-6).world, to.world);
    }
  });

  test(`${map.kind}: 範囲外と反復呼び出しが決定論的`, () => {
    const camera = createCamera(map);
    assert.equal(camera(-5).stop, map.cameraStops[0].id);
    assert.equal(camera(999).stop, map.cameraStops.at(-1).id);
    for (const t of [0, 3, 5, 10.2, 20]) assert.deepEqual(camera(t), camera(t));
  });

  test(`${map.kind}: move 中点は両端の間にある`, () => {
    const camera = createCamera(map);
    const edge = map.edges.find((item) => item.type === "move");
    const before = camera(edge.t0);
    const middle = camera((edge.t0 + edge.t1) / 2);
    const after = camera(edge.t1);
    const keys = map.kind === "flat" ? ["x", "y", "scale"] : [];
    for (const key of keys) assert.ok(between(middle[key], before[key], after[key]));
    if (map.kind === "spatial") for (const key of ["eye", "target"]) middle[key].forEach((value, index) => assert.ok(between(value, before[key][index], after[key][index])));
  });
}

test("flat の linear 辺の中点は幾何的中点", () => {
  const map = maps[0];
  const camera = createCamera(map);
  const edge = map.edges.find((item) => item.easing === "linear");
  const from = map.cameraStops.find((stop) => stop.id === edge.from).c;
  const to = map.cameraStops.find((stop) => stop.id === edge.to).c;
  const value = camera((edge.t0 + edge.t1) / 2);
  [value.x, value.y, value.scale].forEach((item, index) => assert.ok(Math.abs(item - (from[index] + to[index]) / 2) < 1e-9));
});

test("camera.mjs は外部依存と非決定要因を含まない", () => {
  const source = fs.readFileSync(join(packageRoot, "src", "world", "camera.mjs"), "utf8");
  for (const pattern of [/\bimport\b/, /\brequire\b/, /\bprocess\b/, /Date/, /Math\.random/]) assert.doesNotMatch(source, pattern);
});

function close(a, b, kind, epsilon) {
  if (kind === "flat") for (const key of ["x", "y", "scale"]) assert.ok(Math.abs(a[key] - b[key]) <= epsilon, `${key}: ${a[key]} / ${b[key]}`);
  else for (const key of ["eye", "target"]) a[key].forEach((value, index) => assert.ok(Math.abs(value - b[key][index]) <= epsilon, `${key}[${index}]`));
}
function between(value, a, b) { return value >= Math.min(a, b) && value <= Math.max(a, b); }
function fixture(name) { return JSON.parse(fs.readFileSync(join(examples, name, "planning", "world-map.json"), "utf8")); }
