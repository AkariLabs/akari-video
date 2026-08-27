import assert from 'node:assert/strict';
import test from 'node:test';
import { DecodedFrameCoverageCache, frameCoversTimestamp, LookaheadCache } from '../dist/index.js';

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

test('decoded frame coverage is half-open and retains sub-frame requests', () => {
  const frame = { timestamp: 400_000, duration: 33_333 };
  assert.equal(frameCoversTimestamp(frame, 400_000), true);
  assert.equal(frameCoversTimestamp(frame, 416_667), true);
  assert.equal(frameCoversTimestamp(frame, 433_332), true);
  assert.equal(frameCoversTimestamp(frame, 433_333), false);
  assert.equal(frameCoversTimestamp({ timestamp: 400_000, duration: null }, 416_667), false);
});

test('prime coverage serves a long first frame, then advances to shorter frames', () => {
  const cache = new DecodedFrameCoverageCache();
  const first = {
    timestamp: 0,
    duration: 100_000,
    closed: false,
    clone() { return { ...this, closed: false, clone: this.clone, close: this.close }; },
    close() { this.closed = true; }
  };
  cache.adopt(first);
  for (const target of [16_667, 33_333, 50_000, 99_999]) {
    const frame = cache.cloneAt(target);
    assert.ok(frame, `expected prime frame to cover ${target}us`);
    assert.equal(frame.timestamp, 0);
    assert.equal(frame.duration, 100_000);
    frame.close();
  }
  const forkCache = new DecodedFrameCoverageCache();
  forkCache.adopt(cache.cloneStored());
  const forkFirstRequest = forkCache.cloneAt(16_667);
  assert.ok(forkFirstRequest);
  assert.equal(forkFirstRequest.duration, 100_000);
  forkFirstRequest.close();
  forkCache.clear();
  assert.equal(cache.cloneAt(100_000), null);

  const second = {
    timestamp: 100_000,
    duration: 33_333,
    closed: false,
    clone() { return { ...this, closed: false, clone: this.clone, close: this.close }; },
    close() { this.closed = true; }
  };
  cache.remember(second);
  assert.equal(first.closed, true);
  const withinSecond = cache.cloneAt(116_667);
  assert.ok(withinSecond);
  assert.equal(withinSecond.timestamp, 100_000);
  withinSecond.close();
  assert.equal(cache.cloneAt(133_333), null);
  cache.clear();
});
