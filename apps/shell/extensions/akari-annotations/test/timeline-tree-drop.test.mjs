import assert from 'node:assert/strict';
import test from 'node:test';

import { hitTestTimelineTreeDrop } from '../lib/common/timeline-tree-drop.js';

test('上下 8px は line、中央は group/bag のみ inside', () => {
  const base = { rowTop: 100, rowHeight: 24, targetId: 'g', targetIndex: 3 };
  assert.deepEqual(hitTestTimelineTreeDrop({ ...base, localY: 106, canContain: true }), {
    mode: 'line', targetId: 'g', index: 3, edge: 'before'
  });
  assert.deepEqual(hitTestTimelineTreeDrop({ ...base, localY: 118, canContain: true }), {
    mode: 'line', targetId: 'g', index: 4, edge: 'after'
  });
  assert.deepEqual(hitTestTimelineTreeDrop({ ...base, localY: 112, canContain: true }), {
    mode: 'inside', targetId: 'g', index: Number.MAX_SAFE_INTEGER
  });
  assert.equal(hitTestTimelineTreeDrop({ ...base, localY: 112, canContain: false }).mode, 'line');
});
