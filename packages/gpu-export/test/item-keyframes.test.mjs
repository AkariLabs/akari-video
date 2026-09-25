import assert from "node:assert/strict";
import test from "node:test";

import { evaluateGpuEligibility } from "../src/eligibility.mjs";
import { buildGpuPage } from "../src/page-builder.mjs";
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { evaluateOverlayMotion } = require('../../overlay-runtime/src/item-motion.js');

const overlay = {
  id: "moving",
  start: 0,
  duration: 4,
  html: "<div style=\"width:40px;height:40px;background:red\"></div>",
  transform: { x: 10, y: 20, scale: 1, rotate: 0 },
  opacity: 0.5,
  keyframes: [
    { t: 0, transform: { x: 0 }, opacity: 0 },
    { t: 120, transform: { x: 400 }, opacity: 1 },
  ],
};

test("item keyframes force a DOM classification instead of a static sprite", () => {
  const result = evaluateGpuEligibility({
    edit: { output: { width: 640, height: 360 }, overlays: [overlay] },
  });
  assert.equal(result.eligible, true);
  assert.deepEqual(result.entries[0], {
    kind: "overlay",
    id: "moving",
    classification: "dom",
    reason: "item-keyframes",
    conditions: ["item-keyframes"],
  });
});

test("GPU page carries keyframes into its DOM run and injects the shared runtime", () => {
  const page = buildGpuPage({
    edit: { output: { width: 640, height: 360, fps: 30 }, cuts: [], sources: [] },
    overlays: [overlay],
    captions: [],
    projectRoot: "/project",
    fps: 30,
    width: 640,
    height: 360,
    duration: 4,
    frameEngineBundle: "window.AkariFrameEngine={};",
    pageRuntime: "/*PAGE-RUNTIME*/",
    slotParamsRuntime: "/*SLOT-RUNTIME*/",
  });
  assert.equal(page.spriteManifest.statics.length, 0);
  assert.equal(page.spriteManifest.dom.length, 1);
  assert.deepEqual(page.edit.overlays[0].keyframes, overlay.keyframes);
  assert.match(page.html, /function interpolateKeyframes/u);
  assert.match(page.html, /\/\*PAGE-RUNTIME\*\//u);
});

test("GPU page omits the keyframe runtime for keyframe-less overlays", () => {
  const { keyframes: _keyframes, ...still } = overlay;
  const page = buildGpuPage({
    edit: { output: { width: 640, height: 360, fps: 30 }, cuts: [], sources: [] },
    overlays: [still],
    captions: [],
    projectRoot: "/project",
    fps: 30,
    width: 640,
    height: 360,
    duration: 4,
    frameEngineBundle: "window.AkariFrameEngine={};",
    pageRuntime: "/*PAGE-RUNTIME*/",
    slotParamsRuntime: "/*SLOT-RUNTIME*/",
  });
  assert.equal(page.spriteManifest.statics.length, 1);
  assert.doesNotMatch(page.html, /function interpolateKeyframes/u);
});

test('GPU routes item motion to DOM and preserves preview values at the same frames', () => {
  const moving = { ...overlay, keyframes: undefined,
    motion: { in: { preset: 'pop', duration: 30 }, loop: { preset: 'blink', period: 30 } },
    motionSource: { at: 0, duration: 4, transform: { x: 10, y: 20, scale: 1 },
      opacity: .5, motion: { in: { preset: 'pop', duration: 30 }, loop: { preset: 'blink', period: 30 } } },
    motionParents: [{ at: 0, duration: 4, transform: { x: 5, scale: 2 } }],
  };
  const page = buildGpuPage({
    edit: { output: { width: 640, height: 360, fps: 30 }, cuts: [], sources: [] },
    overlays: [moving], captions: [], projectRoot: '/unused', duration: 4,
    frameEngineBundle: 'window.AkariFrameEngine={};', pageRuntime: '/*PAGE-RUNTIME*/',
  });
  assert.equal(page.spriteManifest.statics.length, 0);
  assert.equal(page.spriteManifest.dom.length, 1);
  assert.match(page.html, /function evaluateOverlayMotion/u);
  const payload = page.html.match(/window\.__AKARI_GPU_CONFIG__=([\s\S]*?);<\/script>/u)?.[1];
  assert.ok(payload);
  const declared = JSON.parse(payload).edit.overlays[0];
  for (const seconds of [0, .25, .5, 1, 2.75]) {
    const expected = evaluateOverlayMotion(moving, seconds, 30);
    const actual = evaluateOverlayMotion(declared, seconds, 30);
    for (const field of ['x', 'y', 'scale', 'opacity']) assert.equal(actual[field], expected[field]);
  }
});
