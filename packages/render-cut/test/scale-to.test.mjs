import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOutputScaleToPlan,
  parseArguments,
  parseScaleToValue,
  RefusalError,
} from "../src/render-cut.mjs";

test("--scale-to accepts both spellings and parses 1280x720", () => {
  assert.deepEqual(parseScaleToValue("1280x720"), { width: 1280, height: 720 });
  assert.deepEqual(parseArguments(["/project", "--scale-to", "1280x720"]).scaleTo, { width: 1280, height: 720 });
  assert.deepEqual(parseArguments(["/project", "--scale-to=1280x720"]).scaleTo, { width: 1280, height: 720 });
});

test("--scale-to rejects malformed and odd dimensions", () => {
  assert.throws(() => parseScaleToValue("1280-720"), /must be <width>x<height>/u);
  assert.throws(() => parseScaleToValue("1279x720"), /dimensions must be even/u);
  assert.throws(() => parseScaleToValue("1280x719"), /dimensions must be even/u);
});

test("16:9 output accepts 1280x720 and records preset plus down scale", () => {
  const plan = { preset: { width: 1920, height: 1080, fps: 30 } };
  applyOutputScaleToPlan(plan, { width: 1920, height: 1080 }, { width: 1280, height: 720 });
  assert.deepEqual(plan.preset, { width: 1280, height: 720, fps: 30 });
  assert.deepEqual(plan.output_scale, {
    from: [1920, 1080], to: [1280, 720], mode: "down",
  });
});

test("16:9 output refuses 1280x800", () => {
  assert.throws(
    () => applyOutputScaleToPlan(
      { preset: { width: 1920, height: 1080 } },
      { width: 1920, height: 1080 },
      { width: 1280, height: 800 },
    ),
    RefusalError,
  );
});

test("explicit native size records none without changing other preset fields", () => {
  const plan = { preset: { width: 1920, height: 1080, fps: 24, codec: "h264" } };
  applyOutputScaleToPlan(plan, { width: 1920, height: 1080 }, { width: 1920, height: 1080 });
  assert.deepEqual(plan.preset, { width: 1920, height: 1080, fps: 24, codec: "h264" });
  assert.equal(plan.output_scale.mode, "none");
});
