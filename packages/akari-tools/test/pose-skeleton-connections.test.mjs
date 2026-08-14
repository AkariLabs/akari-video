import assert from "node:assert/strict";
import test from "node:test";

import { BONES, JOINT_NAMES } from "../bin/pose-skeleton/skeleton.mjs";

test("3D body pose の 17 関節を Vision 親子関係の 16 本で結ぶ", () => {
  assert.equal(JOINT_NAMES.length, 17);
  assert.equal(new Set(JOINT_NAMES).size, 17);
  assert.deepEqual(BONES, [
    ["root", "spine"], ["spine", "center_shoulder"],
    ["center_shoulder", "center_head"], ["center_head", "top_head"],
    ["center_shoulder", "left_shoulder"], ["left_shoulder", "left_elbow"],
    ["left_elbow", "left_wrist"], ["center_shoulder", "right_shoulder"],
    ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"],
    ["root", "left_hip"], ["left_hip", "left_knee"], ["left_knee", "left_ankle"],
    ["root", "right_hip"], ["right_hip", "right_knee"], ["right_knee", "right_ankle"],
  ]);
  for (const bone of BONES) for (const joint of bone) assert.ok(JOINT_NAMES.includes(joint));
});
