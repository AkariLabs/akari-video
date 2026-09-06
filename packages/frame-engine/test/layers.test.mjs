import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { applyHomography as referenceApply, cornersToHomography as referenceHomography } from '../../render-cut/src/perspective-homography.mjs';
import { filterQuadCornersAt as legacyFilterQuadCornersAt } from '../../render-cut/src/filter-mask.mjs';
import { computeLayerKeyframesVisual as previewVisual } from '../../preview-server/public/layer-keyframes-visual.js';
import {
  applyHomography, buildResolvedTimelinePlan, computeLayerKeyframesVisual, cornersToHomography,
  evaluationPlanFromResolvedTimeline, filterQuadCornersAt, invertMat3, isLayerActiveAt
} from '../dist/index.js';

const keyframes = [
  { t: 0, transform: { x: 10, scale: 1 }, crop: { x: 0, y: 0, w: 1, h: 1 }, perspective: { corners: [[0,0],[1,0],[0,1],[1,1]] } },
  { t: 2, transform: { y: 20, rotate: 30 }, crop: { x: .2, y: .1, w: .6, h: .8 }, perspective: { corners: [[.1,.1],[.9,0],[0,1],[1,.8]] }, easing: 'ease-in-out' }
];

const fullCorners = [[0,0],[1,0],[0,1],[1,1]];
const movedCorners = [[.2,.1],[.9,.2],[.1,.8],[.8,.9]];

test('filter corners default to the full frame', () => {
  assert.deepEqual(filterQuadCornersAt({}, 0.5), fullCorners);
});

test('filter corners use static perspective without keyframes', () => {
  const layer = { perspective: { corners: movedCorners } };
  assert.deepEqual(filterQuadCornersAt(layer, 0.5), movedCorners);
  assert.deepEqual(filterQuadCornersAt(layer, 0.5), legacyFilterQuadCornersAt(layer, 0.5));
});

test('one usable filter corner keyframe holds its value', () => {
  const layer = { perspective: { corners: fullCorners }, keyframes: [{ t: 2, perspective: { corners: movedCorners } }] };
  assert.deepEqual(filterQuadCornersAt(layer, -1), movedCorners);
  assert.deepEqual(filterQuadCornersAt(layer, 99), legacyFilterQuadCornersAt(layer, 99));
});

test('two filter corner keyframes interpolate linearly and ignore easing', () => {
  const layer = { keyframes: [
    { t: 1, perspective: { corners: fullCorners }, easing: 'ease-in' },
    { t: 3, perspective: { corners: movedCorners }, easing: 'ease-out' },
  ] };
  assert.deepEqual(filterQuadCornersAt(layer, 2), legacyFilterQuadCornersAt(layer, 2));
  assert.deepEqual(filterQuadCornersAt(layer, 2), [[.1,.05],[.95,.1],[.05,.9],[.9,.95]]);
});

test('filter corner keyframes hold both endpoints', () => {
  const layer = { keyframes: [
    { t: 1, perspective: { corners: fullCorners } },
    { t: 3, perspective: { corners: movedCorners } },
  ] };
  assert.deepEqual(filterQuadCornersAt(layer, 0), fullCorners);
  assert.deepEqual(filterQuadCornersAt(layer, 4), movedCorners);
});

test('filter layers resolve in z order without a source', () => {
  const base = { decode: async () => { throw new Error('unused'); } };
  const timeline = buildResolvedTimelinePlan([{ src:'base', in:0, out:2 }], { layers: [
    { id:'invert', kind:'filter', t:0, duration:2, filter:{ type:'invert' }, perspective:{ corners:movedCorners }, opacity:.4 },
    { id:'media', kind:'video', t:0, duration:2, src:'base' },
  ] });
  const plan = evaluationPlanFromResolvedTimeline(timeline, 1e6, new Map([['base', base]]), { width:320,height:180,colorSpace:'bt709-limited' });
  assert.deepEqual(plan.layers.map(layer => layer.kind), ['filter', 'video']);
  assert.deepEqual(plan.layers[0].corners, movedCorners);
  assert.equal(plan.layers[0].opacity, .4);
});

test('missing filter warns once and skips instead of throwing', () => {
  const warnings = [];
  const base = { decode: async () => { throw new Error('unused'); } };
  const timeline = buildResolvedTimelinePlan([{ src:'base', in:0, out:2 }], {
    layers:[{ id:'missing', kind:'filter', t:0, duration:2 }], onWarning:value => warnings.push(value),
  });
  const plan = evaluationPlanFromResolvedTimeline(timeline, 1e6, new Map([['base',base]]), { width:320,height:180,colorSpace:'bt709-limited' });
  assert.deepEqual(plan.layers, []);
  assert.deepEqual(warnings, ['filter layer missing has no supported filter; skipping']);
});

test('unknown filter type warns and skips', () => {
  const warnings = [];
  const base = { decode: async () => { throw new Error('unused'); } };
  const timeline = buildResolvedTimelinePlan([{ src:'base', in:0, out:2 }], {
    layers:[{ id:'future', kind:'filter', t:0, duration:2, filter:{type:'blur'} }], onWarning:value => warnings.push(value),
  });
  const plan = evaluationPlanFromResolvedTimeline(timeline, 1e6, new Map([['base',base]]), { width:320,height:180,colorSpace:'bt709-limited' });
  assert.deepEqual(plan.layers, []);
  assert.equal(warnings.length, 1);
});

test('layer window uses render-cut half-open frame quantization', () => {
  const layer = { t: 0.101, duration: 0.099 };
  assert.equal(isLayerActiveAt(layer, 3 / 30 * 1e6, 30), false);
  assert.equal(isLayerActiveAt(layer, 4 / 30 * 1e6, 30), true);
  assert.equal(isLayerActiveAt(layer, 5 / 30 * 1e6, 30), true);
  assert.equal(isLayerActiveAt(layer, 6 / 30 * 1e6, 30), false);
});

test('layer keyframes numerically match the Web preview reference', () => {
  for (const seconds of [-1, 0, .5, 1, 1.5, 2, 3]) {
    const actual = computeLayerKeyframesVisual(keyframes, seconds);
    const expected = previewVisual(keyframes, seconds);
    const { rotate, ...transform } = expected.transform;
    assert.deepEqual(JSON.parse(JSON.stringify(actual)).transform, { ...transform, rotateDegrees: rotate });
    assert.deepEqual(actual.crop, { x: expected.crop.x, y: expected.crop.y, width: expected.crop.w, height: expected.crop.h });
    assert.deepEqual(actual.perspective, expected.perspective);
  }
});

test('Heckbert matrix matches render-cut and its inverse round-trips', () => {
  const corners = [[.12,.04],[.91,.12],[.02,.88],[.82,.96]];
  const actual = cornersToHomography(corners);
  const reference = referenceHomography(corners);
  for (const [u,v] of [[0,0],[1,0],[0,1],[1,1],[.37,.61]]) {
    const mapped = applyHomography(actual, u, v);
    assert.deepEqual(mapped.map(value => Number(value.toFixed(12))), referenceApply(reference, u, v).map(value => Number(value.toFixed(12))));
    const roundTrip = applyHomography(invertMat3(actual), mapped[0], mapped[1]);
    assert.ok(Math.abs(roundTrip[0]-u)<1e-10 && Math.abs(roundTrip[1]-v)<1e-10);
  }
});

test('timeline resolves z order, local source time, static and animated visuals', () => {
  const video = { decode: async () => { throw new Error('unused'); } };
  const timeline = buildResolvedTimelinePlan([{ src:'base', in:0, out:3 }], { fps:30, layers:[
    { id:'back', t:0, duration:2, kind:'video', src:'video', crop:{x:.1,y:.2,w:.5,h:.6}, blend:'multiply' },
    { id:'front', t:1, duration:1, kind:'video', src:'video', keyframes, opacity:.5 }
  ]});
  const plan = evaluationPlanFromResolvedTimeline(timeline, 1_500_000, new Map([['base',video],['video',video]]), { width:320,height:180,colorSpace:'bt709-limited' });
  assert.deepEqual(plan.layers.map(layer => layer.id), ['back','front']);
  assert.deepEqual(plan.layers.map(layer => layer.sourceTimeUs), [1_500_000,500_000]);
  assert.deepEqual(plan.layers[0].visual.crop, { x:.1,y:.2,width:.5,height:.6 });
  assert.equal(plan.layers[1].visual.transform.x, 9.375);
  assert.equal(plan.layers[1].opacity, .5);
});

test('layer motion composes with keyframes at output-local seconds and timeline fps', () => {
  const source = { decode: async () => { throw new Error('unused'); } };
  const layer = {
    id: 'moving', t: 2, duration: 2, src: 'video',
    keyframes: [
      { t: 0, transform: { x: 10, y: 20, scale: 2, rotate: 15 }, opacity: 0.4 },
      { t: 2, transform: { x: 30, y: 40, scale: 4, rotate: 35 }, opacity: 0.8 },
    ],
    motion: { in: { preset: 'slide-up', duration: 24 }, out: { preset: 'fade', duration: 24 },
      loop: { preset: 'pulse', period: 48 } },
  };
  const timeline = buildResolvedTimelinePlan([], { fps: 24, layers: [layer] });
  const at = seconds => evaluationPlanFromResolvedTimeline(timeline, seconds * 1e6,
    new Map([['video', source]]), { width: 320, height: 180, colorSpace: 'bt709-limited' }).layers[0];
  assert.deepEqual(at(2.5).visual.transform, { x: 15, y: 45, scale: 2.625, rotateDegrees: 20 });
  assert.equal(at(2.5).opacity, 0.5);
  const { scale, ...transform } = at(3.5).visual.transform;
  assert.deepEqual(transform, { x: 25, y: 35, rotateDegrees: 30 });
  assert.ok(Math.abs(scale - 3.325) < 1e-12);
  assert.ok(Math.abs(at(3.5).opacity - 0.35) < 1e-12);
  assert.equal(at(2.5).sourceTimeUs, 500_000);
});

test('layers without motion retain the serialized static and keyframed evaluation', () => {
  const source = { decode: async () => { throw new Error('unused'); } };
  const layers = [
    { id: 'static', t: 1, duration: 2, src: 'video', crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
      transform: { x: 12, y: -4, scale: 0.5, rotate: 30 }, opacity: 0.6, blend: 'multiply' },
    { id: 'animated', t: 1, duration: 2, src: 'video', keyframes: [
      { t: 0, transform: { x: 10, scale: 1 }, opacity: 0.2 },
      { t: 2, transform: { x: 30, scale: 2 }, opacity: 0.6 },
    ] },
  ];
  const at = declarations => evaluationPlanFromResolvedTimeline(
    buildResolvedTimelinePlan([], { layers: declarations }), 2e6, new Map([['video', source]]),
    { width: 320, height: 180, colorSpace: 'bt709-limited' });
  const expected = [
    { id: 'static', visual: { crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 }, perspective: null,
      transform: { x: 12, y: -4, scale: 0.5, rotateDegrees: 30 } }, blend: 'multiply', opacity: 0.6,
      kind: 'video', source, sourceTimeUs: 1e6, mask: null },
    { id: 'animated', visual: { crop: { x: 0, y: 0, width: 1, height: 1 }, perspective: null,
      transform: { x: 20, y: 0, scale: 1.5, rotateDegrees: 0 } }, blend: 'normal', opacity: 0.4,
      kind: 'video', source, sourceTimeUs: 1e6, mask: null },
  ];
  assert.equal(JSON.stringify(at(layers).layers), JSON.stringify(expected));
  assert.equal(JSON.stringify(at(layers)), JSON.stringify(at(layers.map(layer => ({ ...layer, motion: undefined })))));
});

test('layer wipe reveals within its crop and keeps the closed endpoint transparent and nondegenerate', () => {
  const source = { decode: async () => { throw new Error('unused'); } };
  const timeline = buildResolvedTimelinePlan([], { fps: 30, layers: [
    { id: 'wipe', t: 1, duration: 2, src: 'video', crop: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 },
      opacity: 0.7, motion: { in: { preset: 'wipe', duration: 30 } } },
  ] });
  const at = seconds => evaluationPlanFromResolvedTimeline(timeline, seconds * 1e6,
    new Map([['video', source]]), { width: 320, height: 180, colorSpace: 'bt709-limited' }).layers[0];
  assert.deepEqual(at(1).visual.crop, { x: 0.2, y: 0.1, width: Number.EPSILON, height: 0.8 });
  assert.equal(at(1).opacity, 0);
  assert.deepEqual(at(1.5).visual.crop, { x: 0.2, y: 0.1, width: 0.3, height: 0.8 });
  assert.equal(at(1.5).opacity, 0.7);
  assert.equal(at(2).visual.crop.width, 0.6);
});

test('matte layers resolve masks once per source and degrade missing or failed masks to warnings', () => {
  const video = { decode: async () => { throw new Error('unused'); } };
  const mask = { decode: async () => { throw new Error('unused'); } };
  const warnings = [];
  let calls = 0;
  const timeline = buildResolvedTimelinePlan([{ src:'base', in:0, out:3 }], {
    fps:30,
    layers:[
      { id:'matte-a', t:0, duration:2, kind:'matte', src:'color' },
      { id:'matte-b', t:0, duration:2, kind:'matte', src:'color' }
    ],
    maskResolver(src) { calls += 1; return `${src}.mask.mp4`; },
    onWarning: warning => warnings.push(warning)
  });
  assert.equal(calls, 1);
  const plan = evaluationPlanFromResolvedTimeline(
    timeline,
    500_000,
    new Map([['base',video],['color',video],['color.mask.mp4',mask]]),
    { width:320,height:180,colorSpace:'bt709-limited' }
  );
  assert.deepEqual(plan.layers.map(layer => layer.kind), ['matte','matte']);
  assert.equal(plan.layers[0].mask.source, mask);
  assert.equal(plan.layers[0].mask.sourceTimeUs, plan.layers[0].sourceTimeUs);
  assert.equal(warnings.length, 0);

  const missing = evaluationPlanFromResolvedTimeline(
    timeline,
    500_000,
    new Map([['base',video],['color',video]]),
    { width:320,height:180,colorSpace:'bt709-limited' }
  );
  assert.deepEqual(missing.layers.map(layer => layer.kind), ['video','video']);
  assert.equal(missing.layers[0].mask, null);
  assert.equal(warnings.length, 2);

  const resolverWarnings = [];
  const failed = buildResolvedTimelinePlan([{ src:'base', in:0, out:1 }], {
    layers:[{ id:'failed', t:0, duration:1, kind:'matte', src:'color' }],
    maskResolver() { throw new Error('conversion failed'); },
    onWarning: warning => resolverWarnings.push(warning)
  });
  assert.equal(failed.maskSources.get('color'), null);
  assert.match(resolverWarnings[0], /conversion failed/u);
});

test('golden layer classes are isolated, with only the stack window overlapping', () => {
  const fixture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'golden/layers.edit.json'), 'utf8'));
  const activeAt = seconds => fixture.layers.filter(layer => seconds >= layer.t && seconds < layer.t + layer.duration);
  for (const seconds of [
    .5, 3.5, 6.5, 9.5, 12.5, 15.5, 18.5, 21.5, 24.5,
    33.5, 36.5, 39.5, 42.5, 45.5, 48.5, 51.5,
  ]) {
    assert.equal(activeAt(seconds).length, 1, `expected one isolated layer at ${seconds}s`);
  }
  assert.equal(activeAt(27.5).length, 3);
  assert.equal(activeAt(30.5).length, 0);
});
