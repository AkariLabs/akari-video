import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateTimelineTrackHeight,
  timelineTreeRowOffset,
} from '../lib/browser/timeline/timeline-track-height.js';

test('木の行があるトラックだけトラック行ぶんのオフセットを返す', () => {
  assert.equal(timelineTreeRowOffset(0), 0);
  assert.equal(timelineTreeRowOffset(1), 1);
  assert.equal(timelineTreeRowOffset(12), 1);
});

test('トラック高さは畳んだ既定高と展開行を同じ式で合成し、展開分を 240px で切らない', () => {
  assert.equal(calculateTimelineTrackHeight({
    baseHeight: 56, treeRowCount: 0, subrowStride: 24
  }), 56);
  assert.equal(calculateTimelineTrackHeight({
    baseHeight: 56, treeRowCount: 1, subrowStride: 24
  }), 56);
  assert.equal(calculateTimelineTrackHeight({
    baseHeight: 48, treeRowCount: 3, propertyRowCount: 2, subrowStride: 24
  }), 144);
  assert.equal(calculateTimelineTrackHeight({
    baseHeight: 240, treeRowCount: 12, subrowStride: 24
  }), 312);
  assert.equal(calculateTimelineTrackHeight({
    baseHeight: 72, treeRowCount: 2, subrowStride: 24
  }), 72);
});
