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

test("hand-written v2 fixture accepts four visual source kinds, audio media items, captions content, and z-order", () => {
  const value = fixture("edit-v2-valid");
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2));
  assert.deepEqual(
    value.tracks.map((track) => track.id),
    ["a-sfx", "a-narration", "a-bgm", "v-main", "captions", "v-filter", "v-html", "v-telop"],
  );
  assert.deepEqual(value.tracks.slice(0, 3).map((track) => track.items[0].role ?? "sfx"), ["sfx", "narration", "bgm"]);
  assert.deepEqual(
    value.tracks.flatMap((track) => (track.items ?? []).map((item) => item.source.kind)),
    ["media", "media", "media", "media", "filter", "html", "telop"],
  );
  assert.deepEqual(value.tracks[4].content, { from: "captions.json" });
});

test("audio lane accepts itemV2AudioMedia", () => {
  const valid = fixture("edit-v2-audio-track-valid");
  assert.equal(validate(valid), true, JSON.stringify(validate.errors, null, 2));
});

test("audio lane rejects visual-only item fields", () => {
  const value = fixture("edit-v2-audio-track-valid");
  value.tracks[0].items[0].transform = { scale: 1 };
  assert.equal(validate(value), false);
  assert.ok(validate.errors?.some(error => error.instancePath === "/tracks/0/items/0"
    && error.keyword === "additionalProperties"), JSON.stringify(validate.errors, null, 2));
});

test("visual lane rejects audio-only item fields", () => {
  const value = fixture("edit-v2-valid");
  value.tracks[3].items[0].gain_db = -6;
  assert.equal(validate(value), false);
  assert.ok(validate.errors?.some(error => error.instancePath === "/tracks/3/items/0"
    && error.keyword === "additionalProperties"), JSON.stringify(validate.errors, null, 2));
});

test("audio mix fields belong to the item, not its media source", () => {
  const valid = fixture("edit-v2-audio-track-valid");
  const value = structuredClone(valid);
  value.tracks[0].items[0].source.gain_db = value.tracks[0].items[0].gain_db;
  delete value.tracks[0].items[0].gain_db;
  assert.equal(validate(value), false);
  assert.ok(validate.errors?.some(error => error.instancePath === "/tracks/0/items/0/source"
    && error.keyword === "additionalProperties"), JSON.stringify(validate.errors, null, 2));
});

test("audio lane accepts duration: 0 as the unresolved-duration sentinel", () => {
  const value = fixture("edit-v2-audio-track-valid");
  assert.equal(value.tracks[0].items[0].duration, 0);
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2));
});

test("audio lane accepts an omitted role (runtime default: sfx)", () => {
  const value = fixture("edit-v2-audio-track-valid");
  assert.equal("role" in value.tracks[0].items[0], false);
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2));
});

test("v2 audio item fields are typed and closed", () => {
  const valid = fixture("edit-v2-audio-track-valid");
  for (const [mutate, expectedPath] of [
    [(value) => { value.tracks[1].items[0].role = "dialogue"; }, "/tracks/1/items/0/role"],
    [(value) => { value.tracks[2].items[0].fade_in = -1; }, "/tracks/2/items/0/fade_in"],
    [(value) => { value.tracks[2].items[0].ducking = "yes"; }, "/tracks/2/items/0/ducking"],
    [(value) => { value.tracks[0].items[0].source.framing = {}; }, "/tracks/0/items/0/source"],
  ]) {
    const value = structuredClone(valid);
    mutate(value);
    assert.equal(validate(value), false, expectedPath);
    assert.ok(validate.errors?.some(error => error.instancePath === expectedPath), JSON.stringify(validate.errors, null, 2));
  }
});

test("v2 narration audio item accepts script, reading, and provenance with optional credit", () => {
  const withCredit = fixture("edit-v2-audio-track-valid");
  Object.assign(withCredit.tracks[1].items[0], {
    script: "表示原稿",
    reading: "よみげんこう",
    provenance: {
      provider: "voicevox", engine: "voicevox-0.25.2", voice: "speaker:13",
      credit: "VOICEVOX:青山龍星", generated_at: "2026-08-03T08:37:37.627Z",
    },
  });
  assert.equal(validate(withCredit), true, JSON.stringify(validate.errors, null, 2));

  const withoutCredit = structuredClone(withCredit);
  withoutCredit.tracks[1].items[0].provenance = {
    provider: "human", engine: "studio", voice: "owner", generated_at: "2026-08-04T00:00:00Z",
  };
  assert.equal(validate(withoutCredit), true, JSON.stringify(validate.errors, null, 2));

  const invalid = structuredClone(withCredit);
  invalid.tracks[1].items[0].provenance.provider = 13;
  assert.equal(validate(invalid), false);
  assert.ok(validate.errors?.some(error => error.instancePath.endsWith("/provenance/provider")));
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
  value.tracks[3].items[0].keyframes = [{ t: 0 }, { t: 1.5 }];
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
