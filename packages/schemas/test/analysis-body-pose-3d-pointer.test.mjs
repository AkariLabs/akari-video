import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(root, "analysis.schema.json"), "utf8"));

test("body_pose_3d は additive な optional visionTrackPointer", () => {
  const tracks = schema.$defs.tracks;
  assert.ok(!tracks.required.includes("body_pose_3d"));
  assert.deepEqual(tracks.properties.body_pose_3d, { $ref: "#/$defs/visionTrackPointer" });
});
