import assert from 'node:assert/strict';
import test from 'node:test';
import { contentEndWithTimelineGroups, timelineGroupEndSeconds } from '../lib/common/timeline-group-end.js';

const group = (at, duration, children = []) => ({ source: { kind: 'group' }, at, duration, children });

test('empty planned groups extend a cut-free timeline to 45 seconds', () => {
  const tracks = [{ items: [group(0, 3), group(3, 33), group(36, 9)] }];
  assert.equal(contentEndWithTimelineGroups(10, tracks, false), 45);
});

test('nested group ends are counted without changing the cuts branch', () => {
  const tracks = [{ items: [group(0, 2, [group(20, 25)])] }];
  assert.equal(timelineGroupEndSeconds(tracks), 45);
  assert.equal(contentEndWithTimelineGroups(12, tracks, true), 12);
});
