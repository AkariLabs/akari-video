import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResolvedTimelinePlan } from '../dist/index.js';

test('HTML-only compositions retain their declared duration without synthetic media', () => {
  const plan = buildResolvedTimelinePlan([], { fps: 30, overlays: [
    { start: 0, duration: 8 }, { start: 8, duration: 4 }
  ] });
  assert.equal(plan.totalDuration, 12);
  assert.equal(plan.cuts.length, 0);
  assert.equal(plan.layers.length, 0);
});
test('an overlay tail extends a video timeline and responds to edits', () => {
  const cuts = [{ src: 'clip', in: 0, out: 5 }];
  assert.equal(buildResolvedTimelinePlan(cuts, { overlays: [{ start: 4, duration: 4 }] }).totalDuration, 8);
  assert.equal(buildResolvedTimelinePlan(cuts, { overlays: [{ start: 4, duration: 1 }] }).totalDuration, 5);
});
test('absent and invalid overlay spans do not corrupt media duration', () => {
  const cuts = [{ src: 'clip', in: 0, out: 5 }];
  assert.equal(buildResolvedTimelinePlan(cuts).totalDuration, 5);
  assert.equal(buildResolvedTimelinePlan(cuts, { overlays: [
    { start: NaN, duration: 2 }, { start: 1, duration: Infinity }, { start: 20, duration: 0 }
  ] }).totalDuration, 5);
});
