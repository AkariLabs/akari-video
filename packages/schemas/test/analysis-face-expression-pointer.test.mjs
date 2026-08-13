import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(root, "analysis.schema.json"), "utf8"));

test("face_expression は additive な optional visionTrackPointer", () => {
  const tracks = schema.$defs.tracks;
  assert.ok(!tracks.required.includes("face_expression"));
  assert.deepEqual(tracks.properties.face_expression, { $ref: "#/$defs/visionTrackPointer" });
});
