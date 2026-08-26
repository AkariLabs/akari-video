import assert from 'node:assert/strict';
import test from 'node:test';
import { LookaheadCache } from '../dist/index.js';

function fakeFrame(id) {
  return {
    id,
    closed: false,
    clone() { return fakeFrame(`${id}:clone`); },
    close() { this.closed = true; }
  };
}

test('LookaheadCache clones callers and closes evicted masters', () => {
  const cache = new LookaheadCache(1);
  const first = fakeFrame('first');
  const second = fakeFrame('second');
  cache.put(1, first, 1);
  assert.equal(cache.getClone(1).frame.id, 'first:clone');
  cache.put(2, second, 2);
  assert.equal(first.closed, true);
  assert.equal(cache.has(1), false);
  cache.clear();
  assert.equal(second.closed, true);
});
