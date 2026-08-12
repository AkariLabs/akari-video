import assert from "node:assert/strict";
import test from "node:test";

import { completeFacePolygon, polygonBounds } from "../bin/face-mosaic/geometry.mjs";

const detection = {
  box: [0.2, 0.15, 0.4, 0.6],
  landmarks: {
    left_eye: [[0.28, 0.36], [0.36, 0.34]],
    right_eye: [[0.44, 0.34], [0.52, 0.36]],
    left_eyebrow: [[0.28, 0.3], [0.36, 0.28]],
    right_eyebrow: [[0.44, 0.28], [0.52, 0.3]],
    face_contour: [[0.22, 0.34], [0.24, 0.55], [0.32, 0.7], [0.4, 0.74], [0.48, 0.7], [0.56, 0.55], [0.58, 0.34]],
  },
};

test("faceContour + 額補完は固定点数の閉曲線になり、額が目より上へ出る", () => {
  const polygon = completeFacePolygon(detection);
  assert.equal(polygon.length, 33);
  assert.deepEqual(polygon[0], polygon[polygon.length - 1]);
  assert.ok(Math.min(...polygon.map((point) => point[1])) < 0.3);
  const bounds = polygonBounds(polygon);
  assert.ok(bounds.h > bounds.w, "矩形ではなく縦長の顔輪郭を保つ");
});

test("face_contour が無い既存検出は捏造せず空を返す", () => {
  assert.deepEqual(completeFacePolygon({ ...detection, landmarks: { left_eye: [], right_eye: [] } }), []);
});
