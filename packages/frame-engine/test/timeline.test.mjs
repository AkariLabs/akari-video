import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildTimelineMap } from '@akari-video/edit-store';
import { TRANSITION_VOCABULARY } from '@akari-video/edit-store';
import {
  buildResolvedTimelinePlan,
  evaluationPlanFromResolvedTimeline,
  evaluationPlanFromTimelineMap
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
