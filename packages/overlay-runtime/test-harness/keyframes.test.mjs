import assert from "node:assert/strict";
import test from "node:test";

import { interpolateKeyframes } from "../src/keyframes.mjs";

const statics = { x: 10, y: 20, scale: 2, rotate: 30, opacity: 0.75 };
const xPoints = (easing) => [
  { t: 10, transform: { x: 0 } },
  { t: 20, transform: { x: 100 }, ...(easing === undefined ? {} : { easing }) },
];

test("linearly interpolates transform properties", () => {
  assert.equal(interpolateKeyframes(xPoints(), 15, { statics }).x, 50);
});

test("holds the first declared value before its first point", () => {
  assert.equal(interpolateKeyframes(xPoints(), 0, { statics }).x, 0);
});

test("holds the last declared value after its last point", () => {
  assert.equal(interpolateKeyframes(xPoints(), 99, { statics }).x, 100);
});

test("falls back to static values for undeclared properties", () => {
  assert.deepEqual(interpolateKeyframes(xPoints(), 15, { statics }), {
    x: 50, y: 20, scale: 2, rotate: 30, opacity: 0.75,
  });
});

test("uses the arriving point easing for a segment", () => {
  assert.equal(interpolateKeyframes(xPoints("ease-in-out"), 12.5, { statics }).x, 6.25);
});

test("supports property-specific easing maps", () => {
  const points = [
    { t: 0, transform: { x: 0, y: 0 } },
    { t: 10, transform: { x: 10, y: 10 }, easing: { x: "hold", y: "linear" } },
  ];
  const state = interpolateKeyframes(points, 5, { statics });
  assert.equal(state.x, 0);
  assert.equal(state.y, 5);
});

test("hold switches to the arriving value at the endpoint", () => {
  assert.equal(interpolateKeyframes(xPoints("hold"), 19.999, { statics }).x, 0);
  assert.equal(interpolateKeyframes(xPoints("hold"), 20, { statics }).x, 100);
});

test("solves cubic-bezier easing by its x coordinate", () => {
  assert.equal(interpolateKeyframes(xPoints("cubic-bezier(0,0,1,1)"), 15, { statics }).x, 50);
});

test("supports in-quad", () => {
  assert.equal(interpolateKeyframes(xPoints("in-quad"), 15, { statics }).x, 25);
});

test("supports out-cubic", () => {
  assert.equal(interpolateKeyframes(xPoints("out-cubic"), 15, { statics }).x, 87.5);
});

test("supports in-out-quart", () => {
  assert.equal(interpolateKeyframes(xPoints("in-out-quart"), 12.5, { statics }).x, 3.125);
});

test("interpolates and clamps opacity", () => {
  const points = [{ t: 0, opacity: -1 }, { t: 10, opacity: 2 }];
  assert.equal(interpolateKeyframes(points, 5, { statics }).opacity, 0.5);
  assert.equal(interpolateKeyframes(points, 10, { statics }).opacity, 1);
});

test("invalid keyframe input returns static state", () => {
  assert.deepEqual(interpolateKeyframes([{ t: "bad", transform: { x: 99 } }], NaN, { statics }), statics);
});

test("a single usable point does not replace static state", () => {
  assert.deepEqual(interpolateKeyframes([{ t: 0, transform: { x: 99 } }], 0, { statics }), statics);
});

test("one property declaration in a usable array is held at both ends", () => {
  const points = [{ t: 0, transform: { x: 25 } }, { t: 10, opacity: 1 }];
  assert.equal(interpolateKeyframes(points, 5, { statics }).x, 25);
});

test("duplicate evaluations are byte-stable", () => {
  const points = xPoints("out-elastic");
  assert.equal(
    JSON.stringify(interpolateKeyframes(points, 14.25, { statics })),
    JSON.stringify(interpolateKeyframes(points, 14.25, { statics })),
  );
});
