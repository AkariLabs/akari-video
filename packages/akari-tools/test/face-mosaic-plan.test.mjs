import assert from "node:assert/strict";
import test from "node:test";

import { buildMosaicPlan } from "../bin/face-mosaic/plan.mjs";

function detection(x) {
  return {
    box: [x, 0.2, 0.24, 0.52],
    landmarks: {
      left_eye: [[x + 0.06, 0.35]], right_eye: [[x + 0.18, 0.35]],
      face_contour: [
        [x + 0.01, 0.35], [x + 0.03, 0.56], [x + 0.12, 0.7], [x + 0.21, 0.56], [x + 0.23, 0.35],
      ],
    },
  };
}

test("計画はフルフレームでなく顔近傍 crop を作り、位置 keyframes と baked layer を返す", () => {
  const track = {
    kind: "face-landmarks", sample_fps: 4,
    samples: Array.from({ length: 9 }, (_, index) => ({ t: index / 4, detections: [detection(0.2 + index * 0.01)] })),
  };
  const plan = buildMosaicPlan({
    track, cuts: [{ in: 0, out: 2 }], sourcePath: "/tmp/source.mov",
    sourceWidth: 1920, sourceHeight: 1080, canvasWidth: 1920, canvasHeight: 1080, fps: 30,
    outPathFor: (index) => `/tmp/face-${index}.mov`,
  });
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(plan.jobs.length, 1);
  assert.ok(plan.jobs[0].cropWidth < 1920 && plan.jobs[0].cropHeight < 1080);
  assert.equal(plan.layers[0].kind, "baked");
  assert.ok(plan.layers[0].keyframes.length >= 2);
  assert.equal(plan.layers[0].duration, 2);
});

test("検出欠落は別 clip/layer に分け、空白区間を hold しない", () => {
  const track = { kind: "face-landmarks", sample_fps: 4, samples: [
    { t: 0, detections: [detection(0.2)] }, { t: 0.25, detections: [detection(0.21)] },
    { t: 0.5, detections: [] }, { t: 0.75, detections: [detection(0.3)] }, { t: 1, detections: [detection(0.31)] },
  ] };
  const plan = buildMosaicPlan({
    track, cuts: [{ in: 0, out: 1.25 }], sourcePath: "/tmp/source.mov",
    sourceWidth: 1280, sourceHeight: 720, canvasWidth: 1280, canvasHeight: 720, fps: 30,
    outPathFor: (index) => `/tmp/face-${index}.mov`,
  });
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(plan.layers.length, 2);
  assert.ok(plan.layers[0].t + plan.layers[0].duration <= plan.layers[1].t);
});
