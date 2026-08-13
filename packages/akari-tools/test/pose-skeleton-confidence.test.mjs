import assert from "node:assert/strict";
import test from "node:test";

import { JOINT_NAMES, renderSkeletonFrame, visibleSkeleton } from "../bin/pose-skeleton/skeleton.mjs";

function joints() {
  return Object.fromEntries(JOINT_NAMES.map((name) => [name, {
    projection: [0.5, 0.5], position: [0, 0, 0], conf: 0.9,
  }]));
}

test("低 confidence 関節を端点に持つ骨は骨ごと非表示", () => {
  const pose = joints();
  pose.left_elbow.conf = 0.2;
  const visible = visibleSkeleton(pose, 0.3);
  assert.ok(!visible.joints.includes("left_elbow"));
  assert.ok(!visible.bones.some((bone) => bone.includes("left_elbow")));
  assert.ok(visible.bones.some(([from, to]) => from === "right_shoulder" && to === "right_elbow"));
});

test("全関節が閾値未満なら RGBA フレームは完全透明", () => {
  const pose = joints();
  for (const joint of Object.values(pose)) joint.conf = 0.1;
  const pixels = renderSkeletonFrame({
    width: 32, height: 32, joints: pose, sourceWidth: 32, sourceHeight: 32,
    minConfidence: 0.3,
  });
  assert.ok(pixels.every((value) => value === 0));
});
