import assert from "node:assert/strict";
import test from "node:test";

import { extractPoseSegments, smoothPoseSegment } from "../bin/pose-skeleton/motion.mjs";
import { JOINT_NAMES } from "../bin/pose-skeleton/skeleton.mjs";

function joints(x, confidence = 0.9) {
  return Object.fromEntries(JOINT_NAMES.map((name, index) => [name, {
    position: [index / 10, 0, 0],
    projection: [x + index / 1000, 0.5],
    conf: confidence,
  }]));
}

test("移動平均は同一入力・同一 window で決定論的かつ位置だけを平滑化する", () => {
  const points = [0, 1, 0, 1, 0].map((x, index) => ({ t: index / 24, joints: joints(x) }));
  const first = smoothPoseSegment(points, 3);
  const second = smoothPoseSegment(points, 3);
  assert.deepEqual(first, second);
  assert.equal(first[2].joints.root.projection[0], 2 / 3);
  assert.equal(first[2].joints.root.conf, points[2].joints.root.conf);
  assert.deepEqual(first[2].joints.root.position, points[2].joints.root.position);
});

test("検出欠落は区間を分割し、後続区間の平滑化へ前区間を混ぜない", () => {
  const track = { kind: "body-pose-3d", samples: [
    { t: 0, detections: [{ joints: joints(0) }] },
    { t: 1 / 24, detections: [{ joints: joints(0.2) }] },
    { t: 2 / 24, detections: [] },
    { t: 3 / 24, detections: [{ joints: joints(0.8) }] },
    { t: 4 / 24, detections: [{ joints: joints(1) }] },
  ] };
  const segments = extractPoseSegments(track);
  assert.deepEqual(segments.map((segment) => segment.length), [2, 2]);
  assert.equal(smoothPoseSegment(segments[1], 5)[0].joints.root.projection[0], 0.9);
});
