import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(root, "analysis.schema.json"), "utf8"));

test("face_landmarks pointer の features は additive な任意フィールド", () => {
  const pointer = schema.$defs.visionTrackPointer;
  assert.ok(!pointer.required.includes("features"), "既存 pointer は features 無しで valid のまま");
  assert.deepEqual(pointer.properties.features.items, { type: "string", minLength: 1 });
  assert.equal(pointer.properties.features.uniqueItems, true);
});

test("face_landmarks は従来どおり共通 pointer を参照する", () => {
  assert.deepEqual(schema.$defs.tracks.properties.face_landmarks, { $ref: "#/$defs/visionTrackPointer" });
});
