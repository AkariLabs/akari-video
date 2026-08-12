import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "validate-edit.mjs");
const schema = JSON.parse(readFileSync(join(packageRoot, "edit.schema.json"), "utf8"));
const layerItem = schema.$defs.layerItem;
const layerFilter = schema.$defs.layerFilter;

function run(name) {
  return spawnSync(process.execPath, [cliPath, join(packageRoot, "examples", name, "edit.json")], {
    encoding: "utf8",
  });
}

test("layerItem exposes filter additively while preserving source-backed kinds", () => {
  assert.deepEqual(layerItem.properties.kind.enum, ["baked", "video", "filter"]);
  assert.equal(layerItem.required.includes("src"), false);
  assert.equal(layerItem.properties.filter.$ref, "#/$defs/layerFilter");
  assert.deepEqual(layerItem.allOf[0].then.required, ["filter"]);
  for (const field of ["src", "chroma_key", "blend", "crop", "transform"]) {
    assert.equal(layerItem.allOf[0].then.properties[field], false);
  }
  assert.deepEqual(layerItem.allOf[1].if.properties.kind.enum, ["baked", "video"]);
  assert.deepEqual(layerItem.allOf[1].then.required, ["src"]);
});

test("layerFilter is the frozen invert/lut/saturation closed union", () => {
  assert.deepEqual(layerFilter.oneOf.map((branch) => branch.properties.type.const), ["invert", "lut", "saturation"]);
  assert.ok(layerFilter.oneOf.every((branch) => branch.additionalProperties === false));
  assert.deepEqual(layerFilter.oneOf[1].required, ["type", "id"]);
  assert.deepEqual(layerFilter.oneOf[2].required, ["type", "value"]);
  assert.deepEqual(layerFilter.oneOf[1].properties.intensity, { type: "number", minimum: 0, maximum: 1 });
  assert.deepEqual(layerFilter.oneOf[2].properties.value, { type: "number", minimum: 0, maximum: 3 });
});

test("valid filter fixtures pass validate-edit CLI and source-backed fixtures stay valid", () => {
  for (const name of [
    "edit-layers-filter-invert-valid",
    "edit-layers-filter-lut-valid",
    "edit-layers-filter-saturation-valid",
    "edit-layers-valid",
  ]) {
    const executed = run(name);
    assert.equal(executed.status, 0, `${name}\n${executed.stderr}`);
    assert.match(executed.stdout, /^OK: /);
  }
});

test("invalid filter fixtures fail validate-edit CLI", () => {
  for (const name of [
    "edit-layers-filter-invalid-src-present",
    "edit-layers-filter-invalid-missing-filter",
    "edit-layers-filter-invalid-unknown-type",
    "edit-layers-filter-invalid-lut-missing-id",
  ]) {
    const executed = run(name);
    assert.equal(executed.status, 1, `${name}\n${executed.stdout}`);
    assert.match(executed.stderr, /^NG: /);
  }
});
