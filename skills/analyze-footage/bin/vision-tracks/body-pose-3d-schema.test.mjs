import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  readFileSync(resolve(here, "../../references/vision-tracks.schema.json"), "utf8"),
);
const jointNames = [
  "root", "right_hip", "right_knee", "right_ankle", "left_hip", "left_knee", "left_ankle",
  "spine", "center_shoulder", "center_head", "top_head", "left_shoulder", "left_elbow",
  "left_wrist", "right_shoulder", "right_elbow", "right_wrist",
];

function fixture() {
  const joints = Object.fromEntries(jointNames.map((name, index) => [name, {
    position: [index * 0.01, index * -0.02, index * 0.03],
    projection: [0.25 + index * 0.01, 0.2 + index * 0.02],
    conf: 0.83,
  }]));
  return {
    version: 0,
    kind: "body-pose-3d",
    source: { path: "../../media/source.mov", duration: 1 },
    sample_fps: 24,
    provider: { name: "apple-vision", os: "macOS 26.2" },
    samples: [{ t: 0, detections: [{ conf: 0.83, joints }] }, { t: 1 / 24, detections: [] }],
  };
}

test("body-pose-3d の kind・detection・17 関節定義が additive に配線される", () => {
  assert.ok(schema.properties.kind.enum.includes("body-pose-3d"));
  assert.ok(schema.$defs.detection.anyOf.some((entry) => entry.$ref === "#/$defs/bodyPose3DDetection"));
  assert.deepEqual(schema.$defs.bodyPose3DJoints.required, jointNames);
  assert.deepEqual(Object.keys(schema.$defs.bodyPose3DJoints.properties), jointNames);
  assert.equal(fixture().samples[0].detections[0].joints.root.position.length, 3);
});

test("3D position は非正規化数値、2D projection は既存 point、confidence は既存 conf を再利用する", () => {
  assert.deepEqual(schema.$defs.bodyPose3DJoint.required, ["position", "projection", "conf"]);
  assert.deepEqual(schema.$defs.bodyPose3DJoint.properties.position, { $ref: "#/$defs/point3d" });
  assert.deepEqual(schema.$defs.bodyPose3DJoint.properties.projection, { $ref: "#/$defs/point" });
  assert.equal(schema.$defs.point3d.prefixItems.length, 3);
  assert.equal(schema.$defs.point3d.prefixItems[0].maximum, undefined);
});
