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
  assert.equal(schema.$id, "urn:akari-video:schema:edit:v1");
  assert.match(schema.title, /v0\/v1\/v2/);
  assert.match(schema.description, /整数フレーム/);
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

test("hand-written v2 fixture accepts four source kinds, three audio roles, captions content, and z-order", () => {
  const value = fixture("edit-v2-valid");
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2));
  assert.deepEqual(
    value.tracks.map((track) => track.id),
    ["a-sfx", "a-narration", "a-bgm", "v-main", "captions", "v-filter", "v-html", "v-telop"],
  );
  assert.deepEqual(value.tracks.slice(0, 3).map((track) => track.role), ["sfx", "narration", "bgm"]);
  assert.deepEqual(
    value.tracks.flatMap((track) => (track.items ?? []).map((item) => item.source.kind)),
    ["media", "media", "media", "media", "filter", "html", "telop"],
  );
  assert.equal(value.tracks[1].items[0].script, "AKARI Videoへようこそ");
  assert.deepEqual(value.tracks[4].content, { from: "captions.json" });
});

test("v2 audio fields are typed and BGM role cardinality is closed", () => {
  const valid = fixture("edit-v2-valid");
  assert.equal(validate(valid), true, JSON.stringify(validate.errors, null, 2));

  for (const [mutate, expectedPath] of [
    [(value) => { value.tracks[0].role = "dialogue"; }, "/tracks/0/role"],
    [(value) => { value.tracks[1].items[0].script = 42; }, "/tracks/1/items/0/script"],
    [(value) => { value.tracks[2].items[0].source.fade_in = -1; }, "/tracks/2/items/0/source/fade_in"],
    [(value) => { value.tracks[2].items[0].source.ducking = "yes"; }, "/tracks/2/items/0/source/ducking"],
  ]) {
    const value = structuredClone(valid);
    mutate(value);
    assert.equal(validate(value), false, expectedPath);
    assert.ok(validate.errors?.some(error => error.instancePath === expectedPath), JSON.stringify(validate.errors, null, 2));
  }

  const tooManyItems = structuredClone(valid);
  tooManyItems.tracks[2].items.push({
    ...structuredClone(tooManyItems.tracks[2].items[0]), id: "music-2", at: 300,
  });
  assert.equal(validate(tooManyItems), false);
  assert.ok(validate.errors?.some(error => error.keyword === "maxItems"));

  const tooManyTracks = structuredClone(valid);
  tooManyTracks.tracks.push({ id: "a-bgm-2", lane: "audio", role: "bgm", items: [] });
  assert.equal(validate(tooManyTracks), false);
  assert.ok(validate.errors?.some(error => error.keyword === "contains"));
});

test("minimum v2 fixture is valid", () => {
  assert.equal(validate(fixture("edit-v2-minimal-valid")), true, JSON.stringify(validate.errors, null, 2));
});

test("editV2 rejects removed top-level vocabulary as additional properties", () => {
  for (const [key, extension] of [
    ["beats", []],
    ["emphasis_words", []],
    ["direction", {}],
  ]) {
    const value = { ...fixture("edit-v2-valid"), [key]: extension };
    assert.equal(validate(value), false, key);
    assert.ok(
      validate.errors?.some(
        (error) => error.keyword === "additionalProperties"
          && error.params.additionalProperty === key,
      ),
      JSON.stringify(validate.errors, null, 2),
    );
  }
});

test("v2 keyframe t is an integer frame while legacy layerKeyframe stays in seconds", () => {
  assert.deepEqual(schema.$defs.layerKeyframe.properties.t, { $ref: "#/$defs/seconds" });
  assert.deepEqual(schema.$defs.keyframeV2.properties.t, { $ref: "#/$defs/frames" });
  for (const definition of ["itemV2Media", "itemV2Html", "itemV2Telop", "itemV2Filter"]) {
    assert.deepEqual(schema.$defs[definition].properties.keyframes.items, { $ref: "#/$defs/keyframeV2" });
  }

  const value = fixture("edit-v2-valid");
  value.tracks[1].items[0].keyframes = [{ t: 0 }, { t: 1.5 }];
  assert.equal(validate(value), false);
  assert.ok(validate.errors?.some(error => error.instancePath.endsWith("/keyframes/1/t")));
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
