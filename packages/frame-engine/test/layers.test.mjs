import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { applyHomography as referenceApply, cornersToHomography as referenceHomography } from '../../render-cut/src/perspective-homography.mjs';
import { computeLayerKeyframesVisual as previewVisual } from '../../preview-server/public/layer-keyframes-visual.js';
import {
  applyHomography, buildResolvedTimelinePlan, computeLayerKeyframesVisual, cornersToHomography,
  evaluationPlanFromResolvedTimeline, invertMat3, isLayerActiveAt
} from '../dist/index.js';

const keyframes = [
  { t: 0, transform: { x: 10, scale: 1 }, crop: { x: 0, y: 0, w: 1, h: 1 }, perspective: { corners: [[0,0],[1,0],[0,1],[1,1]] } },
  { t: 2, transform: { y: 20, rotate: 30 }, crop: { x: .2, y: .1, w: .6, h: .8 }, perspective: { corners: [[.1,.1],[.9,0],[0,1],[1,.8]] }, easing: 'ease-in-out' }
];

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
