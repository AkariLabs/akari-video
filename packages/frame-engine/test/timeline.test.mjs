import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { buildTimelineMap } from '@akari-video/edit-store';
import { TRANSITION_VOCABULARY } from '@akari-video/edit-store';
import {
  buildResolvedTimelinePlan,
  computeLayerKeyframesVisual,
  cutLayerStyleBox,
  cutLayerStyleSourceUv,
  evaluationPlanFromResolvedTimeline,
  evaluationPlanFromTimelineMap,
  hasCutLayerStyleVisual,
  KNOWN_CUT_KEYS,
  KNOWN_KEYFRAME_KEYS,
  KNOWN_LAYER_KEYS,
  parseCube
} from '../dist/index.js';

const transitionFixture = JSON.parse(readFileSync(
  path.resolve(import.meta.dirname, 'golden/transitions.edit.json'),
  'utf8',
));

test('evaluation plans consume edit-store hard-cut boundary resolution', () => {
  const source = { decode: async () => { throw new Error('not used'); } };
  const sources = new Map([['fixture.mp4', source]]);
  const map = buildTimelineMap([
    { src: 'fixture.mp4', in: 0, out: 1 },
    { src: 'fixture.mp4', in: 2, out: 3 }
  ]);
  const plan = evaluationPlanFromTimelineMap(map, 1_500_000, sources, {
    width: 320,
    height: 180,
    colorSpace: 'bt709-limited'
  });
  assert.equal(plan.base.length, 1);
  assert.equal(plan.base[0].source, source);
  assert.equal(plan.base[0].sourceTimeUs, 2_500_000);
  assert.deepEqual(plan.transition, { type: 'hard-cut', progress: 0 });
});

test('resolved timeline accepts the complete shared transition vocabulary', () => {
  const source = { decode: async () => { throw new Error('not used'); } };
  const sources = new Map([['fixture.mp4', source]]);
  for (const definition of TRANSITION_VOCABULARY) {
    const timeline = buildResolvedTimelinePlan([
      { src: 'fixture.mp4', in: 0, out: 1,
        transition_out: { type: definition.id, duration: 0.3 } },
      { src: 'fixture.mp4', in: 1, out: 2 },
    ]);
    const plan = evaluationPlanFromResolvedTimeline(timeline, 850_000, sources, {
      width: 320, height: 180, colorSpace: 'bt709-limited'
    });
    assert.equal(plan.transition?.type, definition.id);
    assert.ok(Math.abs(plan.transition.progress - 0.5) < 1e-9);
  }
});

test('resolved timeline rejects an unknown transition instead of silently hard-cutting', () => {
  const source = { decode: async () => { throw new Error('not used'); } };
  const sources = new Map([['fixture.mp4', source]]);
  const timeline = buildResolvedTimelinePlan([
    { src: 'fixture.mp4', in: 0, out: 1,
      transition_out: { type: 'unknown-transition', duration: 0.3 } },
    { src: 'fixture.mp4', in: 1, out: 2 },
  ]);
  assert.throws(() => evaluationPlanFromResolvedTimeline(timeline, 850_000, sources, {
    width: 320, height: 180, colorSpace: 'bt709-limited'
  }), /unsupported transition type: unknown-transition/u);
});

test('transition golden fixture resolves every comparison sample to its declared cut sources', () => {
  assert.equal(transitionFixture.cuts.length, 30);
  assert.equal(transitionFixture.cuts.every(cut => cut.in === 0 && cut.out === 1), true);
  assert.equal(transitionFixture.cuts.filter(cut => cut.transition_out).length, 29);
  assert.equal(transitionFixture.cuts.filter(cut => cut.transition_out)
    .every(cut => cut.transition_out.duration === 0.4), true);
  const source = { decode: async () => { throw new Error('not used'); } };
  const sourceId = 'frame-engine://fixture/source.mp4';
  const sources = new Map([[sourceId, source]]);
  const timeline = buildResolvedTimelinePlan(transitionFixture.cuts, { fps: 30 });
  assert.ok(Math.abs(timeline.totalDuration - 18.4) < 1e-9);
  for (const [transitionIndex, definition] of TRANSITION_VOCABULARY.entries()) {
    for (const u of [0.25, 0.5, 0.75]) {
      const timeUs = Math.round((0.6 * (transitionIndex + 1) + 0.4 * u) * 1e6);
      assert.ok(Math.abs(timeUs * 30 / 1e6 - Math.round(timeUs * 30 / 1e6)) < 1e-9);
      const plan = evaluationPlanFromResolvedTimeline(timeline, timeUs, sources, {
        width: 320, height: 180, colorSpace: 'bt709-limited'
      });
      assert.equal(plan.transition?.type, definition.id);
      assert.ok(Math.abs(plan.transition.progress - u) < 1e-6);
      assert.equal(plan.base.length, 2);
      assert.deepEqual(plan.base.map(layer => layer.sourceTimeUs), [
        Math.round((0.6 + 0.4 * u) * 1e6),
        Math.round(0.4 * u * 1e6),
      ]);
      for (const layer of plan.base) {
        const frameNumber = Math.round(layer.sourceTimeUs * 30 / 1e6);
        assert.notEqual(frameNumber % 30, 29, `${definition.id} u=${u}`);
      }
    }
  }
});

test('resolved cuts apply speed, freeze extension, and shift every following segment', () => {
  const source = { decode: async () => { throw new Error('not used'); } };
  const sources = new Map([['fixture.mp4', source]]);
  const timeline = buildResolvedTimelinePlan([
    {
      src: 'fixture.mp4', in: 1, out: 5, speed: 2,
      freeze: { at_sec: 0.5, duration_sec: 0.75 }
    },
    { src: 'fixture.mp4', in: 6, out: 7 }
  ]);
  const output = { width: 320, height: 180, colorSpace: 'bt709-limited' };
  assert.equal(timeline.totalDuration, 3.75);
  assert.equal(evaluationPlanFromResolvedTimeline(timeline, 250_000, sources, output).base[0].sourceTimeUs, 1_500_000);
  assert.equal(evaluationPlanFromResolvedTimeline(timeline, 900_000, sources, output).base[0].sourceTimeUs, 2_000_000);
  assert.equal(evaluationPlanFromResolvedTimeline(timeline, 1_400_000, sources, output).base[0].sourceTimeUs, 2_300_000);
  assert.equal(evaluationPlanFromResolvedTimeline(timeline, 3_000_000, sources, output).base[0].sourceTimeUs, 6_250_000);
});

test('resolved cuts interpolate framing, preserve transform, and resolve two transition inputs', () => {
  const source = { decode: async () => { throw new Error('not used'); } };
  const sources = new Map([['fixture.mp4', source]]);
  const timeline = buildResolvedTimelinePlan([
    {
      src: 'fixture.mp4', in: 0, out: 2,
      transition_out: { type: 'reveal-down', duration: 0.5 },
      framing: { keyframes: [{ t: 0, scale: 1 }, { t: 2, scale: 2, cx: 0.75, cy: 0.25 }] },
      transform: { x: 12, y: -8, scale: 0.8, rotate: 15 }, opacity: 0.6
    },
    { src: 'fixture.mp4', in: 3, out: 5 }
  ]);
  assert.equal(timeline.totalDuration, 3.5);
  const plan = evaluationPlanFromResolvedTimeline(timeline, 1_750_000, sources, {
    width: 320, height: 180, colorSpace: 'bt709-limited'
  });
  assert.equal(plan.base.length, 2);
  assert.equal(plan.transition?.type, 'reveal-down');
  assert.equal(plan.transition?.progress, 0.5);
  assert.equal(plan.base[0].visual.framing.scale, 1.875);
  assert.deepEqual(plan.base[0].visual.transform, { x: 12, y: -8, scale: 0.8, rotateDegrees: 15 });
  assert.equal(plan.base[0].visual.opacity, 0.6);
  assert.equal(plan.base[1].sourceTimeUs, 3_250_000);
});

const stillOutput = { width: 320, height: 180, colorSpace: 'bt709-limited' };

test('still image sources on the cuts timeline become image base layers (issue #30)', () => {
  const image = { load: async () => { throw new Error('not used'); }, destroy() {} };
  const video = { decode: async () => { throw new Error('not used'); } };
  const sources = new Map([['still.png', image], ['clip.mp4', video]]);
  const timeline = buildResolvedTimelinePlan([
    { src: 'still.png', in: 0, out: 2, transform: { x: 10, scale: 1.5 } },
    { src: 'clip.mp4', in: 5, out: 6 },
  ], { fps: 30 });
  assert.equal(timeline.totalDuration, 3);
  const still = evaluationPlanFromResolvedTimeline(timeline, 1_000_000, sources, stillOutput);
  assert.equal(still.base.length, 1);
  assert.equal(still.base[0].kind, 'image');
  assert.equal(still.base[0].id, 'cut-0');
  assert.equal(still.base[0].image, image);
  assert.equal(still.base[0].sourceTimeUs, 0);
  assert.deepEqual(still.base[0].visual.transform, { x: 10, y: 0, scale: 1.5, rotateDegrees: 0 });
  const clip = evaluationPlanFromResolvedTimeline(timeline, 2_500_000, sources, stillOutput);
  assert.equal(clip.base[0].kind, undefined);
  assert.equal(clip.base[0].source, video);
  assert.equal(clip.base[0].sourceTimeUs, 5_500_000);
  const legacy = evaluationPlanFromTimelineMap(buildTimelineMap([{ src: 'still.png', in: 0, out: 2 }]), 500_000, sources, stillOutput);
  assert.equal(legacy.base[0].kind, 'image');
  assert.equal(legacy.base[0].image, image);
});

test('a still image dissolving into a video cut pairs both on the base (issue #30)', () => {
  const image = { load: async () => { throw new Error('not used'); }, destroy() {} };
  const video = { decode: async () => { throw new Error('not used'); } };
  const sources = new Map([['still.png', image], ['clip.mp4', video]]);
  const timeline = buildResolvedTimelinePlan([
    { src: 'still.png', in: 0, out: 2, transition_out: { type: 'dissolve', duration: 0.5 } },
    { src: 'clip.mp4', in: 0, out: 1 },
  ], { fps: 30 });
  const plan = evaluationPlanFromResolvedTimeline(timeline, 1_750_000, sources, stillOutput);
  assert.equal(plan.transition?.type, 'dissolve');
  assert.equal(plan.base.length, 2);
  assert.equal(plan.base[0].kind, 'image');
  assert.equal(plan.base[1].source, video);
});

test('an unregistered cut source still fails closed with the original message', () => {
  const timeline = buildResolvedTimelinePlan([{ src: 'missing.png', in: 0, out: 1 }]);
  assert.throws(
    () => evaluationPlanFromResolvedTimeline(timeline, 0, new Map(), stillOutput),
    /no video frame source registered for missing\.png/u,
  );
});

test('later visual tracks win the base by default, matching the shell preview z order (issue #31)', () => {
  const base = { decode: async () => { throw new Error('not used'); } };
  const broll = { decode: async () => { throw new Error('not used'); } };
  const sources = new Map([['base.mp4', base], ['broll.mp4', broll]]);
  const cuts = [
    { src: 'base.mp4', in: 0, out: 20 },
    { src: 'broll.mp4', in: 0, out: 3, at: 5, track: 1 },
  ];
  const timeline = buildResolvedTimelinePlan(cuts, { fps: 30 });
  assert.equal(timeline.totalDuration, 20);
  const baseAt = seconds => evaluationPlanFromResolvedTimeline(timeline, seconds * 1e6, sources, stillOutput).base[0];
  assert.equal(baseAt(2).source, base);
  assert.equal(baseAt(6).source, broll);
  assert.equal(baseAt(6).sourceTimeUs, 1_000_000);
  assert.equal(baseAt(9).source, base);
  assert.equal(baseAt(9).sourceTimeUs, 9_000_000);
  const reversed = buildResolvedTimelinePlan(cuts, { fps: 30, trackZ: track => -track });
  assert.equal(evaluationPlanFromResolvedTimeline(reversed, 6e6, sources, stillOutput).base[0].source, base);
});

test('total duration covers layers that outlast or replace the cuts (issue #31)', () => {
  const video = { decode: async () => { throw new Error('not used'); } };
  const sources = new Map([['a.mp4', video]]);
  const layersOnly = buildResolvedTimelinePlan([], {
    fps: 30, layers: [{ id: 'l', t: 1, duration: 2, kind: 'video', src: 'a.mp4' }],
  });
  assert.equal(layersOnly.totalDuration, 3);
  const plan = evaluationPlanFromResolvedTimeline(layersOnly, 2e6, sources, stillOutput);
  assert.equal(plan.base.length, 0);
  assert.deepEqual(plan.layers.map(layer => layer.id), ['l']);
  const outlasting = buildResolvedTimelinePlan([{ src: 'a.mp4', in: 0, out: 1 }], {
    fps: 30, layers: [{ id: 'l', t: 0.5, duration: 2, kind: 'video', src: 'a.mp4' }],
  });
  assert.equal(outlasting.totalDuration, 2.5);
  const filterOnly = buildResolvedTimelinePlan([{ src: 'a.mp4', in: 0, out: 1 }], {
    fps: 30, layers: [{ id: 'f', t: 0, duration: 5, kind: 'filter', filter: { type: 'invert' } }],
  });
  assert.equal(filterOnly.totalDuration, 5);
});

// ---- issue #39: v2 media item (cuts) crop / transform / opacity keyframes on the base path ----------

const hd = { width: 1920, height: 1080, colorSpace: 'bt709-limited' };
const videoSource = () => ({ decode: async () => { throw new Error('not used'); } });
const baseAt = (timeline, seconds, sources, output = hd) =>
  evaluationPlanFromResolvedTimeline(timeline, Math.round(seconds * 1e6), sources, output).base;

test('layer-style cut (a): static crop + scale 2 draws the crop window at natural size × scale (issue #39)', () => {
  const sources = new Map([['fixture.mp4', videoSource()]]);
  const timeline = buildResolvedTimelinePlan([
    { id: 'c', src: 'fixture.mp4', in: 0, out: 10, crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, transform: { scale: 2 } }
  ], { fps: 30 });
  const [base] = baseAt(timeline, 1, sources);
  assert.equal(hasCutLayerStyleVisual(timeline.cuts[0].cut), true);
  assert.deepEqual(base.visual.layerStyle, { crop: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } });
  assert.deepEqual(base.visual.transform, { x: 0, y: 0, scale: 2, rotateDegrees: 0 });
  assert.equal(base.visual.opacity, 1);
  // box = crop.w × 1920 × 2 by crop.h × 1080 × 2 = the full 1920×1080 output, centred on the output centre
  assert.deepEqual(cutLayerStyleBox(base.visual, 1920, 1080), { width: 1920, height: 1080 });
  const uv = (px, py) => cutLayerStyleSourceUv(base.visual, 1920, 1080, 1920, 1080, px, py);
  assert.deepEqual(uv(960, 540), [0.75, 0.75]);
  assert.deepEqual(uv(0, 0), [0.5, 0.5]);
  assert.deepEqual(uv(1920, 1080), [1, 1]);
  assert.equal(uv(-1, 540), null);
  assert.equal(uv(960, 1081), null);
});

test('layer-style cut (b): two crop keyframes interpolate linearly at the midpoint (issue #39)', () => {
  const sources = new Map([['fixture.mp4', videoSource()]]);
  const timeline = buildResolvedTimelinePlan([
    { id: 'c', src: 'fixture.mp4', in: 0, out: 10, keyframes: [
      { t: 0, crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, transform: { scale: 2 } },
      { t: 2, crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, transform: { scale: 2 } }
    ] }
  ], { fps: 30 });
  assert.deepEqual(baseAt(timeline, 1, sources)[0].visual.layerStyle.crop, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  assert.deepEqual(baseAt(timeline, 0, sources)[0].visual.layerStyle.crop, { x: 0, y: 0, width: 0.5, height: 0.5 });
  assert.deepEqual(baseAt(timeline, 5, sources)[0].visual.layerStyle.crop, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  assert.equal(baseAt(timeline, 1, sources)[0].visual.transform.scale, 2);
  // crop stays inside the source: x ∈ [0, 1 − w]
  const overflow = buildResolvedTimelinePlan([
    { id: 'o', src: 'fixture.mp4', in: 0, out: 10, crop: { x: 0.8, y: -0.5, w: 0.5, h: 0.5 } }
  ], { fps: 30 });
  assert.deepEqual(baseAt(overflow, 1, sources)[0].visual.layerStyle.crop, { x: 0.5, y: 0, width: 0.5, height: 0.5 });
});

test('layer-style cut (c): keyframe t is output-local seconds — at ≠ 0 and freeze keep the clock running (issue #39)', () => {
  const sources = new Map([['base.mp4', videoSource()], ['broll.mp4', videoSource()]]);
  const keyframes = [
    { t: 0, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } },
    { t: 4, crop: { x: 0.4, y: 0, w: 0.5, h: 0.5 } }
  ];
  const placed = buildResolvedTimelinePlan([
    { id: 'bg', src: 'base.mp4', in: 0, out: 20 },
    { id: 'b1', src: 'broll.mp4', in: 0, out: 4, at: 5, track: 1, keyframes }
  ], { fps: 30 });
  const [placedBase] = baseAt(placed, 7, sources);
  assert.equal(placedBase.source, sources.get('broll.mp4'));
  assert.equal(placedBase.sourceTimeUs, 2_000_000);
  assert.equal(placedBase.visual.layerStyle.crop.x, 0.2);
  const frozen = buildResolvedTimelinePlan([
    { id: 'f', src: 'base.mp4', in: 0, out: 4, freeze: { at_sec: 1, duration_sec: 2 }, keyframes }
  ], { fps: 30 });
  assert.equal(frozen.totalDuration, 6);
  const [held] = baseAt(frozen, 2.5, sources);
  assert.equal(held.sourceTimeUs, 1_000_000);
  assert.ok(Math.abs(held.visual.layerStyle.crop.x - 0.25) < 1e-12);
  const [afterHold] = baseAt(frozen, 4, sources);
  assert.equal(afterHold.sourceTimeUs, 2_000_000);
  assert.ok(Math.abs(afterHold.visual.layerStyle.crop.x - 0.4) < 1e-12);
});

test('layer-style cut (d): opacity keyframes interpolate and fall back to the static opacity (issue #39)', () => {
  const sources = new Map([['fixture.mp4', videoSource()]]);
  const animated = buildResolvedTimelinePlan([
    { id: 'a', src: 'fixture.mp4', in: 0, out: 10, opacity: 0.3, keyframes: [
      { t: 0, opacity: 0, crop: { x: 0, y: 0, w: 1, h: 1 } },
      { t: 2, opacity: 1 }
    ] }
  ], { fps: 30 });
  assert.equal(baseAt(animated, 1, sources)[0].visual.opacity, 0.5);
  assert.equal(baseAt(animated, 0, sources)[0].visual.opacity, 0);
  assert.equal(baseAt(animated, 3, sources)[0].visual.opacity, 1);
  const held = buildResolvedTimelinePlan([
    { id: 'h', src: 'fixture.mp4', in: 0, out: 10, opacity: 0.3, keyframes: [
      { t: 0, crop: { x: 0, y: 0, w: 1, h: 1 } },
      { t: 2, crop: { x: 0.5, y: 0, w: 0.5, h: 1 } }
    ] }
  ], { fps: 30 });
  assert.equal(baseAt(held, 1, sources)[0].visual.opacity, 0.3);
  assert.equal(computeLayerKeyframesVisual([{ t: 0, opacity: 1 }, { t: 1, opacity: 0, easing: 'ease-in-out' }], 0.25).opacity, 1 - 4 * 0.25 ** 3);
  assert.equal(computeLayerKeyframesVisual([{ t: 0, transform: { x: 1 } }, { t: 1, transform: { x: 2 } }], 0.5).opacity, null);
});

test('layer-style cut (e): perspective warns exactly once and everything else still applies (issue #39)', () => {
  const sources = new Map([['fixture.mp4', videoSource()]]);
  const warnings = [];
  const timeline = buildResolvedTimelinePlan([
    { id: 'v-885', src: 'fixture.mp4', in: 0, out: 10, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      perspective: { corners: [[0.1, 0.1], [0.9, 0], [0, 1], [1, 0.8]] } },
    { id: 'plain', src: 'fixture.mp4', in: 0, out: 1 }
  ], { fps: 30, onWarning: message => warnings.push(message) });
  for (const seconds of [0, 1, 2.5, 9]) baseAt(timeline, seconds, sources);
  assert.deepEqual(warnings, ['cut v-885: perspective is not applied by the frame-engine base path yet (issue #39)']);
  const [base] = baseAt(timeline, 1, sources);
  assert.deepEqual(base.visual.layerStyle, { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
  // keyframed perspective warns the same way, with the index-based fallback id
  const animatedWarnings = [];
  buildResolvedTimelinePlan([
    { src: 'fixture.mp4', in: 0, out: 10, keyframes: [
      { t: 0, perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] } },
      { t: 1, perspective: { corners: [[0.1, 0], [1, 0], [0, 1], [1, 1]] } }
    ] }
  ], { fps: 30, onWarning: message => animatedWarnings.push(message) });
  assert.deepEqual(animatedWarnings, ['cut cut-0: perspective is not applied by the frame-engine base path yet (issue #39)']);
});

test('layer-style cut (f): cuts without crop / keyframes / perspective keep the exact fit-basis visual (issue #39)', () => {
  const sources = new Map([['fixture.mp4', videoSource()], ['still.png', { load: async () => { throw new Error('not used'); }, destroy() {} }]]);
  const timeline = buildResolvedTimelinePlan([
    { id: 'plain', src: 'fixture.mp4', in: 0, out: 2 },
    { id: 'transform-only', src: 'fixture.mp4', in: 0, out: 2, transform: { x: 12, y: -8, scale: 0.8, rotate: 15 }, opacity: 0.6 },
    { id: 'framing', src: 'fixture.mp4', in: 0, out: 2, framing: { crop: { x: 0.2, y: 0.1, w: 0.6, h: 0.6 } } },
    { id: 'one-point', src: 'fixture.mp4', in: 0, out: 2, keyframes: [{ t: 0, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }] },
    { id: 'still', src: 'still.png', in: 0, out: 2, transform: { x: 10, scale: 1.5 } }
  ], { fps: 30 });
  const fullFraming = { x: 0, y: 0, width: 1, height: 1, scale: 1, centerX: 0.5, centerY: 0.5 };
  assert.deepEqual(baseAt(timeline, 1, sources)[0].visual, {
    framing: fullFraming, transform: { x: 0, y: 0, scale: 1, rotateDegrees: 0 }, opacity: 1
  });
  assert.deepEqual(baseAt(timeline, 3, sources)[0].visual, {
    framing: fullFraming, transform: { x: 12, y: -8, scale: 0.8, rotateDegrees: 15 }, opacity: 0.6
  });
  assert.deepEqual(baseAt(timeline, 5, sources)[0].visual, {
    framing: { x: 0.2, y: 0.1, width: 0.6, height: 0.6, scale: 1 / 0.6, centerX: 0.5, centerY: 0.4 },
    transform: { x: 0, y: 0, scale: 1, rotateDegrees: 0 }, opacity: 1
  });
  assert.deepEqual(baseAt(timeline, 7, sources)[0].visual, {
    framing: fullFraming, transform: { x: 0, y: 0, scale: 1, rotateDegrees: 0 }, opacity: 1
  });
  assert.deepEqual(baseAt(timeline, 9, sources)[0].visual, {
    framing: fullFraming, transform: { x: 10, y: 0, scale: 1.5, rotateDegrees: 0 }, opacity: 1
  });
  for (const placement of timeline.cuts) assert.equal(hasCutLayerStyleVisual(placement.cut), false, placement.cut.id);
});

test('layer-style cuts resolve independently inside a transition and on still image base layers (issue #39)', () => {
  const image = { load: async () => { throw new Error('not used'); }, destroy() {} };
  const sources = new Map([['fixture.mp4', videoSource()], ['still.png', image]]);
  const timeline = buildResolvedTimelinePlan([
    { id: 'out', src: 'fixture.mp4', in: 0, out: 2, transition_out: { type: 'dissolve', duration: 0.5 },
      crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, transform: { scale: 2 } },
    { id: 'in', src: 'still.png', in: 0, out: 2, keyframes: [
      { t: 0, crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, transform: { scale: 2, rotate: 0 } },
      { t: 2, crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, transform: { scale: 2, rotate: 90 } }
    ] }
  ], { fps: 30 });
  const plan = evaluationPlanFromResolvedTimeline(timeline, 1_750_000, sources, hd);
  assert.equal(plan.transition?.type, 'dissolve');
  assert.equal(plan.base.length, 2);
  assert.deepEqual(plan.base[0].visual.layerStyle.crop, { x: 0, y: 0, width: 0.5, height: 0.5 });
  assert.equal(plan.base[1].kind, 'image');
  assert.equal(plan.base[1].image, image);
  assert.deepEqual(plan.base[1].visual.layerStyle.crop, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  // incoming cut is 0.25 s into its own clock (1.75 − 1.5): rotate 90 × 0.125
  assert.ok(Math.abs(plan.base[1].visual.transform.rotateDegrees - 11.25) < 1e-9);
  assert.equal(plan.base[0].visual.transform.rotateDegrees, 0);
});

// gpu-export / osr-export の normalizedCuts が宣言を写し、adjust LUT を parse したうえで
// buildResolvedTimelinePlan まで落とさず届けることを確認する。
async function loadNormalizedCuts(url) {
  const source = readFileSync(url, 'utf8');
  const start = source.indexOf('  function resolvedItemAdjust(item, adjustLutCubeTexts) {');
  const normalizedStart = source.indexOf('  function normalizedCuts(edit, adjustLutCubeTexts = {}) {', start);
  assert.ok(start >= 0, `${url}: normalizedCuts not found`);
  assert.ok(normalizedStart >= start, `${url}: normalizedCuts not found`);
  const end = source.indexOf('\n  }\n', normalizedStart);
  assert.ok(end > start, `${url}: normalizedCuts end not found`);
  return vm.runInNewContext(`${source.slice(start, end + '\n  }\n'.length)}; normalizedCuts`, {
    FE: { parseCube: value => ({ parsed: value }) },
  });
}

for (const [name, url] of [
  ['gpu-export', new URL('../../gpu-export/src/page-runtime.js', import.meta.url)],
  ['osr-export', new URL('../../osr-export/src/page-runtime.js', import.meta.url)],
]) {
  test(`${name} normalizedCuts carries crop / keyframes / perspective / opacity into the resolved timeline (issue #39)`, async () => {
    const normalizedCuts = await loadNormalizedCuts(url);
    const keyframes = [
      { t: 0, crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, transform: { scale: 2 }, opacity: 0 },
      { t: 5, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, transform: { scale: 2 }, opacity: 1 },
      { t: 9.966666666666667, crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, transform: { scale: 2 } }
    ];
    const cuts = normalizedCuts({
      sources: [{ id: 'o885', path: 'assets/quadrants.mp4' }],
      cuts: [
        { id: 'v-885', src: 'o885', in: 0, out: 10, at: 0, track: 0, keyframes, opacity: 0.5 },
        { id: 'v-886', src: 'o885', in: 0, out: 10, at: 10, track: 0, crop: { x: 0.34, y: 0.165, w: 0.66, h: 0.66 },
          perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] } }
      ]
    });
    assert.deepEqual(cuts[0].keyframes, keyframes);
    assert.equal(cuts[0].opacity, 0.5);
    assert.deepEqual(cuts[1].crop, { x: 0.34, y: 0.165, w: 0.66, h: 0.66 });
    assert.deepEqual(cuts[1].perspective, { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] });
    const warnings = [];
    const sources = new Map([['o885', videoSource()]]);
    const timeline = buildResolvedTimelinePlan(cuts, { fps: 30, onWarning: message => warnings.push(message) });
    const [mid] = baseAt(timeline, 2.5, sources);
    assert.deepEqual(mid.visual.layerStyle.crop, { x: 0.125, y: 0.125, width: 0.5, height: 0.5 });
    assert.equal(mid.visual.transform.scale, 2);
    assert.equal(mid.visual.opacity, 0.5);
    const [second] = baseAt(timeline, 12, sources);
    // x + w = 1 exactly; the [0, 1 − w] clamp may move x by one ulp
    assert.ok(Math.abs(second.visual.layerStyle.crop.x - 0.34) < 1e-12);
    assert.deepEqual([second.visual.layerStyle.crop.y, second.visual.layerStyle.crop.width, second.visual.layerStyle.crop.height], [0.165, 0.66, 0.66]);
    assert.deepEqual(warnings, ['cut v-886: perspective is not applied by the frame-engine base path yet (issue #39)']);
  });

  test(`${name} normalizedCuts parses item adjust cube text and preserves basic settings`, async () => {
    const normalizedCuts = await loadNormalizedCuts(url);
    const cuts = normalizedCuts({
      sources: [{ id: 'main', path: 'assets/main.mp4' }],
      cuts: [{ id: 'adjusted', src: 'main', in: 0, out: 1,
        adjust: { basic: { exposure: 1 }, lut: { lut: 'mono', intensity: 0.5 },
          curves: { r: [{ in: 0, out: 0.1 }, { in: 1, out: 1 }] },
          wheels: { gain: { b: -0.2 } }, hue: { sat: [{ hue: 0, value: 0 }] },
          sections: { curves: true, wheels: false, hue: true } } }],
    }, { adjusted: 'LUT_3D_SIZE 2' });
    assert.deepEqual(cuts[0].adjust.basic, { exposure: 1 });
    assert.equal(cuts[0].adjust.lut.intensity, 0.5);
    assert.deepEqual(cuts[0].adjust.curves, { r: [{ in: 0, out: 0.1 }, { in: 1, out: 1 }] });
    assert.deepEqual(cuts[0].adjust.wheels, { gain: { b: -0.2 } });
    assert.deepEqual(cuts[0].adjust.hue, { sat: [{ hue: 0, value: 0 }] });
    assert.deepEqual(cuts[0].adjust.sections, { curves: true, wheels: false, hue: true });
    assert.equal(cuts[0].adjust.lut.lut.parsed, 'LUT_3D_SIZE 2');
  });
}

test('unknown cut and keyframe fields warn once without changing the evaluation plan', () => {
  const warnings = [];
  const cut = {
    id: 'unknown-cut', src: 'fixture.mp4', in: 0, out: 1,
    frobnicate: 1,
    keyframes: [
      { t: 0, transform: { x: 0 }, animator: { letters: { offset: 0 } } },
      { t: 1, transform: { x: 10 } },
    ],
  };
  const source = videoSource();
  const sources = new Map([['fixture.mp4', source]]);
  const timeline = buildResolvedTimelinePlan([cut], { fps: 30, onWarning: message => warnings.push(message) });
  const actual = evaluationPlanFromResolvedTimeline(timeline, 500_000, sources, stillOutput);
  const { frobnicate: _frobnicate, ...knownCut } = cut;
  const baseline = evaluationPlanFromResolvedTimeline(
    buildResolvedTimelinePlan([{ ...knownCut, keyframes: cut.keyframes.map(({ animator: _animator, ...point }) => point) }]),
    500_000,
    sources,
    stillOutput,
  );
  assert.deepEqual(actual, baseline);
  assert.deepEqual(warnings, [
    'cut unknown-cut: field "frobnicate" is not consumed by the frame-engine (see packages/schemas/engine-capabilities.json)',
    'cut unknown-cut keyframe 0: field "animator" is not consumed by the frame-engine (see packages/schemas/engine-capabilities.json)',
  ]);
});

test('unknown layer fields warn at resolved timeline construction', () => {
  const warnings = [];
  buildResolvedTimelinePlan([], {
    layers: [{ id: 'layer-unknown', t: 0, duration: 1, src: 'fixture.mp4', speed: 2 }],
    onWarning: message => warnings.push(message),
  });
  assert.deepEqual(warnings, [
    'layer layer-unknown: field "speed" is not consumed by the frame-engine (see packages/schemas/engine-capabilities.json)',
  ]);
});

test('known cut, layer, and keyframe fields produce no generic capability warnings', () => {
  const warnings = [];
  buildResolvedTimelinePlan([
    { id: 'known-cut', src: 'fixture.mp4', in: 0, out: 1, crop: { x: 0, y: 0, w: 1, h: 1 },
      keyframes: [{ t: 0, opacity: 0 }, { t: 1, opacity: 1, easing: 'ease-in-out' }] },
  ], {
    layers: [{ id: 'known-layer', t: 0, duration: 1, kind: 'video', src: 'fixture.mp4', opacity: 0.5 }],
    onWarning: message => warnings.push(message),
  });
  assert.deepEqual(warnings, []);
});

test('active non-filter layer without src warns before preserving the existing skip', () => {
  const warnings = [];
  const timeline = buildResolvedTimelinePlan([{ src: 'fixture.mp4', in: 0, out: 1 }], {
    layers: [{ id: 'missing-src', t: 0, duration: 1, kind: 'video' }],
    onWarning: message => warnings.push(message),
  });
  const sources = new Map([['fixture.mp4', videoSource()]]);
  const evaluated = evaluationPlanFromResolvedTimeline(timeline, 0, sources, stillOutput);
  assert.equal(evaluated.layers.length, 0);
  assert.deepEqual(warnings, ['layer missing-src: src is missing; skipping']);
});

test('item adjustments are baked once into base and composite plans while disabled sections bypass', () => {
  const lut = parseCube(`TITLE "identity"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1`);
  const source = videoSource();
  const sources = new Map([['fixture.mp4', source], ['layer.mp4', source]]);
  const timeline = buildResolvedTimelinePlan([
    { id: 'adjusted-cut', src: 'fixture.mp4', in: 0, out: 2,
      adjust: { basic: { exposure: 1, temperature: 0.5 }, lut: { lut, intensity: 0.5 } } },
  ], {
    layers: [
      { id: 'adjusted-layer', t: 0, duration: 2, src: 'layer.mp4',
        adjust: { basic: { saturation: 0.25 } } },
    ],
  });
  const first = evaluationPlanFromResolvedTimeline(timeline, 250_000, sources, hd);
  const second = evaluationPlanFromResolvedTimeline(timeline, 750_000, sources, hd);
  assert.ok(first.base[0].visual.adjustLut);
  assert.equal(first.base[0].visual.adjustLut, second.base[0].visual.adjustLut);
  assert.equal(first.base[0].visual.adjustLut, timeline.cuts[0].adjustLut);
  assert.ok(first.layers[0].adjustLut);
  assert.equal(first.layers[0].adjustLut, second.layers[0].adjustLut);
  assert.equal(first.layers[0].adjustLut, timeline.layerAdjustLuts[0]);

  const disabled = buildResolvedTimelinePlan([
    { id: 'off', src: 'fixture.mp4', in: 0, out: 1,
      adjust: { basic: { exposure: 1 }, lut: { lut, intensity: 1 }, sections: { basic: false, lut: false } } },
  ]);
  const disabledPlan = evaluationPlanFromResolvedTimeline(disabled, 0, sources, hd);
  const baselinePlan = evaluationPlanFromResolvedTimeline(
    buildResolvedTimelinePlan([{ id: 'off', src: 'fixture.mp4', in: 0, out: 1 }]),
    0, sources, hd,
  );
  assert.equal(disabledPlan.base[0].visual.adjustLut, undefined);
  assert.deepEqual(disabledPlan, baselinePlan);
});

test('wipe alone routes cuts through layerStyle and preserves transparent nonzero crop endpoints', () => {
  const source = videoSource();
  const at = (motion, seconds) => evaluationPlanFromResolvedTimeline(buildResolvedTimelinePlan([
    { src: 'fixture.mp4', in: 0, out: 2, opacity: 0.8, motion },
  ], { fps: 24 }), seconds * 1e6, new Map([['fixture.mp4', source]]), stillOutput).base[0].visual;
  for (const seat of ['in', 'out']) assert.equal(hasCutLayerStyleVisual({ motion: { [seat]: { preset: 'wipe', duration: 24 } } }), true);
  assert.equal(hasCutLayerStyleVisual({ motion: { in: { preset: 'fade', duration: 24 } } }), false);
  const motion = { in: { preset: 'wipe', duration: 24 }, out: { preset: 'wipe', duration: 24 } };
  assert.deepEqual(at(motion, 0).layerStyle.crop, { x: 0, y: 0, width: Number.EPSILON, height: 1 });
  assert.equal(at(motion, 0).opacity, 0);
  for (const seconds of [0.5, 1.5]) {
    assert.deepEqual(at(motion, seconds).layerStyle.crop, { x: 0, y: 0, width: 0.5, height: 1 });
    assert.equal(at(motion, seconds).opacity, 0.8);
  }
});

test('cut motion uses output-local time and speed-adjusted duration in both visual paths', () => {
  const sources = new Map([['fixture.mp4', videoSource()]]);
  for (const extra of [{}, { crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } }]) {
    const cut = { src: 'fixture.mp4', in: 4, out: 8, speed: 2, at: 1,
      transform: { x: 10, y: 20, scale: 2, rotate: 15 }, opacity: 0.8, ...extra,
      motion: { in: { preset: 'slide-up', duration: 24 }, out: { preset: 'fade', duration: 24 },
        loop: { preset: 'spin', period: 48 } } };
    const timeline = buildResolvedTimelinePlan([cut], { fps: 24 });
    const at = seconds => evaluationPlanFromResolvedTimeline(timeline, seconds * 1e6, sources, stillOutput).base[0];
    assert.deepEqual(at(1.5).visual.transform, { x: 10, y: 40, scale: 2, rotateDegrees: 105 });
    assert.equal(at(1.5).visual.opacity, 0.8);
    assert.equal(at(1.5).sourceTimeUs, 5e6);
    assert.deepEqual(at(2.5).visual.transform, { x: 10, y: 20, scale: 2, rotateDegrees: 285 });
    assert.equal(at(2.5).visual.opacity, 0.4);
  }
});

test('cuts without motion retain serialized fit-basis and layerStyle visuals', () => {
  const sources = new Map([['fixture.mp4', videoSource()]]);
  for (const extra of [{}, { crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } }]) {
    const cut = { src: 'fixture.mp4', in: 0, out: 2,
      transform: { x: 12, y: -4, scale: 0.5, rotate: 30 }, opacity: 0.6, ...extra };
    const at = declaration => evaluationPlanFromResolvedTimeline(buildResolvedTimelinePlan([declaration]),
      500_000, sources, stillOutput);
    const expected = { framing: { x: 0, y: 0, width: 1, height: 1, scale: 1, centerX: 0.5, centerY: 0.5 },
      transform: { x: 12, y: -4, scale: 0.5, rotateDegrees: 30 }, opacity: 0.6,
      ...(extra.crop ? { layerStyle: { crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 } } } : {}) };
    assert.equal(JSON.stringify(at(cut).base[0].visual), JSON.stringify(expected));
    assert.equal(JSON.stringify(at(cut)), JSON.stringify(at({ ...cut, motion: undefined })));
  }
});

test('runtime known-key inventories exactly expose the declared frame-engine shapes', () => {
  assert.deepEqual([...KNOWN_CUT_KEYS].sort(), [
    'adjust', 'at', 'audio', 'crop', 'framing', 'freeze', 'id', 'in', 'keyframes', 'motion', 'mute', 'opacity', 'out', 'perspective',
    'speed', 'src', 'track', 'transform', 'transitionOut', 'transition_out',
  ]);
  assert.deepEqual([...KNOWN_LAYER_KEYS].sort(), [
    'adjust', 'blend', 'crop', 'duration', 'filter', 'id', 'keyframes', 'kind', 'mask', 'motion', 'opacity',
    'perspective', 'src', 't', 'transform',
  ]);
  assert.deepEqual([...KNOWN_KEYFRAME_KEYS].sort(), [
    'crop', 'easing', 'opacity', 'perspective', 't', 'transform',
  ]);
});
