import assert from "node:assert/strict";
import test from "node:test";

import { buildSkeletonPlan } from "../bin/pose-skeleton/plan.mjs";
import { JOINT_NAMES } from "../bin/pose-skeleton/skeleton.mjs";

function joints(x, confidence = 0.9) {
  return Object.fromEntries(JOINT_NAMES.map((name, index) => [name, {
    position: [0, 0, 0],
    projection: [x + (index % 3) * 0.01, 0.2 + index * 0.03],
    conf: confidence,
  }]));
}

function planFor(track, cuts, smoothing = 5) {
  return buildSkeletonPlan({
    track, cuts, sourceWidth: 1280, sourceHeight: 720,
    canvasWidth: 1280, canvasHeight: 720, fps: 30, smoothing,
    outPathFor: (index) => `/tmp/skeleton-${index}.mov`,
  });
}

test("検出欠落は別 baked clip/layer へ分割して空白を hold しない", () => {
  const track = { kind: "body-pose-3d", sample_fps: 4, samples: [
    { t: 0, detections: [{ joints: joints(0.2) }] },
    { t: 0.25, detections: [{ joints: joints(0.22) }] },
    { t: 0.5, detections: [] },
    { t: 0.75, detections: [{ joints: joints(0.7) }] },
    { t: 1, detections: [{ joints: joints(0.72) }] },
  ] };
  const plan = planFor(track, [{ in: 0, out: 1.25 }]);
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(plan.layers.length, 2);
  assert.ok(plan.layers.every((layer) => layer.kind === "baked"));
  assert.ok(plan.layers[0].t + plan.layers[0].duration <= plan.layers[1].t);
});

test("cut 境界で slice 後に平滑化し、隣接シーンの座標を混ぜない", () => {
  const track = {
    kind: "body-pose-3d", sample_fps: 4,
    samples: Array.from({ length: 9 }, (_, index) => ({
      t: index / 4,
      detections: [{ joints: joints(index < 4 ? 0.1 : 0.9) }],
    })),
  };
  const plan = planFor(track, [{ in: 0, out: 1 }, { in: 1, out: 2 }], 5);
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(plan.jobs.length, 2);
  assert.ok(plan.jobs[0].points.at(-1).joints.root.projection[0] < 0.5);
  assert.ok(plan.jobs[1].points[0].joints.root.projection[0] > 0.5);
});
