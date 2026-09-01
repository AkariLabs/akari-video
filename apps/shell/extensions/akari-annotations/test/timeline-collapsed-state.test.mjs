import assert from 'node:assert/strict';
import test from 'node:test';

import { TimelineCollapsedState } from '../lib/browser/timeline/timeline-collapsed-state.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

test('純グループは未設定なら畳みで、expanded.v1 の 1 だけを展開記憶として読む', () => {
  const storage = new MemoryStorage();
  const state = new TimelineCollapsedState('project', storage);
  storage.setItem('akari.timeline.collapsed.v1:project:g', '1');
  assert.equal(state.has('g'), false);
  assert.deepEqual([...state.snapshot(['g'])], []);
  state.set('g', true);
  assert.equal(state.key('g'), 'akari.timeline.expanded.v1:project:g');
  assert.equal(state.has('g'), true);
  assert.deepEqual([...state.snapshot(['g'])], ['g']);
  state.set('g', false);
  assert.equal(state.has('g'), false);
});
