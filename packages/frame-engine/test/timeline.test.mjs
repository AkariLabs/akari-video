import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTimelineMap } from '@akari-video/edit-store';
import { evaluationPlanFromTimelineMap } from '../dist/index.js';

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
  assert.equal(plan.layers.length, 1);
  assert.equal(plan.layers[0].source, source);
  assert.equal(plan.layers[0].sourceTimeUs, 2_500_000);
  assert.deepEqual(plan.transition, { type: 'hard-cut' });
});
