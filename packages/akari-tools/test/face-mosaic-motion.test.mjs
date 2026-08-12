import assert from "node:assert/strict";
import test from "node:test";

import { decimateMotionPoints, extractVisibleSegments } from "../bin/face-mosaic/motion.mjs";

function point(t, cx, side = 0.2) {
  return { t, cx, cy: 0.5, side, polygon: [] };
}

test("間引きは小移動を捨て、移動・scale・強制間隔・終点を残す", () => {
  const points = [
    point(0, 0.1), point(0.2, 0.102), point(0.4, 0.13),
    point(0.6, 0.131, 0.22), point(2.2, 0.132, 0.22), point(2.4, 0.133, 0.22),
  ];
  const kept = decimateMotionPoints(points, { sourceWidth: 1000, sourceHeight: 1000 });
  assert.deepEqual(kept.map((item) => item.t), [0, 0.4, 0.6, 2.2, 2.4]);
});

test("検出欠落は visible segment を分割し、顔外への hold を作らない", () => {
  const landmarks = {
    left_eye: [[0.3, 0.35]], right_eye: [[0.5, 0.35]],
    face_contour: [[0.22, 0.35], [0.25, 0.6], [0.4, 0.72], [0.55, 0.6], [0.58, 0.35]],
  };
  const detection = { box: [0.2, 0.15, 0.4, 0.6], landmarks };
  const track = { kind: "face-landmarks", samples: [
    { t: 0, detections: [detection] }, { t: 1 / 24, detections: [] }, { t: 2 / 24, detections: [detection] },
  ] };
  assert.deepEqual(extractVisibleSegments(track).map((segment) => segment.length), [1, 1]);
});
