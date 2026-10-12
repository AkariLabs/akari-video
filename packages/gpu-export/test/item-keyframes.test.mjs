import assert from "node:assert/strict";
import test from "node:test";

import { evaluateGpuEligibility } from "../src/eligibility.mjs";
import { assertGpuEligibility } from "../../render-cut/src/cli-arguments.mjs";
import { buildGpuPage } from "../src/page-builder.mjs";
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRenderEdit } from '../../render-cut/src/internal-render.mjs';
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

test("3D のキーは three に分類し、通常 item は DOM に分類する", () => {
  const scene = '<canvas></canvas><script type="application/json" data-akari-3d-scene>{}</script>';
  const classify = (html, keyframes, forceDegraded = false) => evaluateGpuEligibility({
    edit: { overlays: [{ id: "scene", html, ...(keyframes ? { keyframes } : {}) }] },
    forceDegraded,
  });
  const points = [{ t: 0, vars: { "--akari-3d-rot-y": 0 } },
    { t: 60, vars: { "--akari-3d-rot-y": 90 }, transform: { x: 80 } }];
  for (const forced of [false, true]) {
    const keyed = classify(scene, points, forced);
    assert.equal(keyed.eligible, true);
    assert.equal(keyed.entries[0].classification, "three");
    assert.equal(keyed.entries[0].reason, "three-scene-canvas-direct");
    assert.equal(keyed.summary.three, 1);
    assert.doesNotThrow(() => assertGpuEligibility("gpu", keyed, { force: forced }));
  }
  const still = classify(scene);
  assert.equal(still.eligible, true);
  assert.equal(still.entries[0].classification, "three");
  const ordinary = classify('<div>通常の item</div>', points);
  assert.equal(ordinary.eligible, true);
  assert.equal(ordinary.entries[0].classification, "dom");
  assert.equal(ordinary.entries[0].reason, "item-keyframes");
});

test('キャンバス内の 3D は子キー・親キー・静的な子を GPU の three に分類する', t => {
  const root = mkdtempSync(join(tmpdir(), 'three-canvas-classification-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'overlays'));
  const html = '<canvas></canvas><script type="application/json" data-akari-3d-scene>{}</script>';
  writeFileSync(join(root, 'overlays', 'scene.html'), html);
  for (const keyed of ['child', 'parent', 'static']) {
    const points = [{ t: 0, transform: { x: -30 }, vars: { '--akari-3d-rot-y': 0 } },
      { t: 19, transform: { x: 30 }, vars: { '--akari-3d-rot-y': 90 } }];
    const parentPoints = [{ t: 0, transform: { x: -30 } },
      { t: 19, transform: { x: 30 } }];
    const edit = { version: 2, output: { width: 320, height: 180, fps: 10 }, sources: [],
      tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'canvas', at: 5, duration: 20,
        source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } },
        transform: { x: 30, scale: 0.8 },
        ...(keyed === 'parent' ? { keyframes: parentPoints } : {}),
        items: [{ id: 'scene', at: 0, duration: 20,
          source: { kind: 'html', path: 'overlays/scene.html' },
          ...(keyed === 'child' ? { keyframes: points } : {}) }] }] }] };
    const projected = readRenderEdit(JSON.stringify(edit), join(root, '.akari', 'render-tmp'),
      { projectRoot: root }).edit.overlays.find(item => item.id === 'scene');
    assert.ok(projected, keyed);
    if (keyed === 'child') assert.equal(projected.keyframes?.length, 2);
    else {
      assert.equal(projected.keyframes, undefined);
      assert.equal(projected.motionSource?.keyframes, undefined);
      if (keyed === 'parent') assert.equal(projected.motionParents?.[0]?.keyframes?.length, 2);
    }
    const result = evaluateGpuEligibility({ edit: { output: edit.output,
      overlays: [{ ...projected, html }] } });
    if (keyed === 'static') {
      assert.equal(projected.start, 0.5);
      assert.equal(projected.transform.x, 30);
      assert.equal(projected.transform.scale, 0.8);
      assert.equal(result.eligible, true);
      assert.equal(result.entries[0].classification, 'three');
      continue;
    }
    assert.equal(result.eligible, true, keyed);
    assert.equal(result.entries[0].classification, 'three', keyed);
  }
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
