import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = join(packageRoot, "examples");
const schema = JSON.parse(readFileSync(join(packageRoot, "edit.schema.json"), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

function fixture(name) {
  return JSON.parse(readFileSync(join(examplesRoot, name, "edit.json"), "utf8"));
}

test("editV2 is the third root branch and keeps v2 timing/output definitions separate", () => {
  assert.deepEqual(schema.oneOf, [
    { $ref: "#/$defs/editV0" },
    { $ref: "#/$defs/editV1" },
    { $ref: "#/$defs/editV2" },
  ]);
  assert.deepEqual(schema.$defs.frames.type, "integer");
  assert.equal(schema.$defs.frames.minimum, 0);
  assert.deepEqual(schema.$defs.output.properties.fps, { $ref: "#/$defs/positiveNumber" });
  assert.deepEqual(schema.$defs.outputV2.properties.fps, { type: "integer", minimum: 1 });
  assert.equal(schema.$defs.itemV2.oneOf.length, 4);
  assert.match(schema.$defs.itemV2.$comment, /sequence/);
  assert.match(schema.$defs.itemAtV2.$comment, /oneOf/);
});

test("hand-written v2 fixture accepts four source kinds, captions content, audio lane, and z-order", () => {
  const value = fixture("edit-v2-valid");
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2));
  assert.deepEqual(
    value.tracks.map((track) => track.id),
    ["a1", "v-main", "captions", "v-filter", "v-html", "v-telop"],
  );
  assert.deepEqual(
    value.tracks.flatMap((track) => (track.items ?? []).map((item) => item.source.kind)),
    ["media", "media", "filter", "html", "telop"],
  );
  assert.deepEqual(value.tracks[2].content, { from: "captions.json" });
});

test("minimum v2 fixture is valid", () => {
  assert.equal(validate(fixture("edit-v2-minimal-valid")), true, JSON.stringify(validate.errors, null, 2));
});

for (const name of [
  "edit-v2-html-in-out-invalid",
  "edit-v2-telop-in-out-invalid",
  "edit-v2-item-kind-field-invalid",
  "edit-v2-fractional-fps-invalid",
  "edit-v2-items-content-invalid",
]) {
  test(`${name} is rejected by the v2 schema`, () => {
    assert.equal(validate(fixture(name)), false, name);
    assert.ok(validate.errors?.length > 0);
  });
}
