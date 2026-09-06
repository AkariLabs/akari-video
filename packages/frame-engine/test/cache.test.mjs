import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DecodedFrameCoverageCache,
  frameCoversTimestamp,
  LookaheadCache,
  LookaheadFrameSource,
} from '../dist/index.js';

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

test('LookaheadFrameSource puts prefetched frames on the evaluateFrame source path', async () => {
  let decodes = 0;
  const accesses = [];
  const source = new LookaheadFrameSource({
    async decode(timeUs) {
      decodes += 1;
      return fakeFrame(`decoded-${timeUs}`);
    },
  }, { fps: 30, onAccess: access => accesses.push(access) });

  await source.prefetch(1_000_000, { streamId: 'cut-1' });
  const frame = await source.decode(1_000_000, undefined, { streamId: 'cut-1' });
  assert.equal(decodes, 1);
  assert.equal(frame.id, 'decoded-1000000:clone');
  assert.deepEqual(accesses.map(access => access.hit), [true]);
  frame.close();
  source.clear();
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

// issue #28: cached frames are decoder-backed clones that pin the decoder's output surface.
// The cache-miss path must release the oldest entry *before* the next decode is awaited, not
// only after it resolves, or a full cache can starve the decoder and stall the export.
function trackedFrame(id, clones) {
  return {
    id,
    closed: false,
    clone() {
      const clone = trackedFrame(`${id}:clone`, clones);
      clones.push(clone);
      return clone;
    },
    close() { this.closed = true; }
  };
}

test('LookaheadCache.makeRoom evicts the oldest master until one slot is free', () => {
  const cache = new LookaheadCache(2);
  const first = { id: 'first', closed: false, clone() { return this; }, close() { this.closed = true; } };
  const second = { id: 'second', closed: false, clone() { return this; }, close() { this.closed = true; } };
  cache.put(1, first, 1);
  cache.put(2, second, 1);
  assert.equal(cache.size, 2);
  cache.makeRoom();
  assert.equal(first.closed, true);
  assert.equal(second.closed, false);
  assert.equal(cache.has(1), false);
  assert.equal(cache.size, 1);
  cache.makeRoom();
  assert.equal(second.closed, false, 'makeRoom is a no-op while a slot is already free');
  assert.equal(cache.size, 1);
  cache.clear();
});

test('LookaheadFrameSource.decode closes the cached clone before the next decode resolves', async () => {
  const clones = [];
  const closedAtDecodeCall = [];
  let resolveSecond;
  const deferredSecond = new Promise(resolve => { resolveSecond = resolve; });
  const source = new LookaheadFrameSource({
    decode(timeUs) {
      closedAtDecodeCall.push(clones.map(clone => clone.closed));
      if (timeUs === 0) return Promise.resolve(trackedFrame('A', clones));
      return deferredSecond;
    },
  }, { fps: 30, capacity: 1 });

  const first = await source.decode(0, undefined, { streamId: 'cut-1' });
  assert.equal(first.id, 'A');
  assert.equal(clones.length, 1, 'the cache holds exactly one clone of A');
  const cachedA = clones[0];
  assert.equal(cachedA.closed, false);

  const pendingSecond = source.decode(33_333, undefined, { streamId: 'cut-1' });
  // B's decode is still deferred, yet A's cached clone is already closed.
  assert.equal(cachedA.closed, true, 'A must be released before B resolves');
  assert.deepEqual(closedAtDecodeCall, [[], [true]], 'A was already closed when the decode for B was invoked');

  resolveSecond(trackedFrame('B', clones));
  const second = await pendingSecond;
  assert.equal(second.id, 'B');
  assert.equal(clones.length, 2);
  assert.equal(clones[1].closed, false, 'the cache now holds B');
  first.close();
  second.close();
  source.clear();
  assert.equal(clones[1].closed, true);
});

test('LookaheadFrameSource.prefetch closes the cached clone before the deferred decode resolves', async () => {
  const clones = [];
  const closedAtDecodeCall = [];
  let resolveSecond;
  const deferredSecond = new Promise(resolve => { resolveSecond = resolve; });
  const source = new LookaheadFrameSource({
    decode(timeUs) {
      closedAtDecodeCall.push(clones.map(clone => clone.closed));
      if (timeUs === 0) return Promise.resolve(trackedFrame('A', clones));
      return deferredSecond;
    },
  }, { fps: 30, capacity: 1 });

  const first = await source.decode(0, undefined, { streamId: 'cut-1' });
  const cachedA = clones[0];
  assert.equal(cachedA.closed, false);

  const pending = source.prefetch(33_333, { streamId: 'cut-1' });
  assert.equal(cachedA.closed, true, 'A must be released before the prefetched decode resolves');
  assert.deepEqual(closedAtDecodeCall, [[], [true]]);

  const second = trackedFrame('B', clones);
  resolveSecond(second);
  await pending;
  assert.equal(second.closed, false, 'the prefetched master is now the only cached frame');
  const hit = await source.decode(33_333, undefined, { streamId: 'cut-1' });
  assert.equal(hit.id, 'B:clone');
  assert.equal(closedAtDecodeCall.length, 2, 'the prefetched frame is served from cache');
  hit.close();
  first.close();
  source.clear();
  assert.equal(second.closed, true);
});

test('LookaheadCache keeps its pin within capacity through makeRoom and put eviction', () => {
  const cache = new LookaheadCache(6);
  const boundary = fakeFrame('boundary');
  const frames = [boundary];
  cache.put(0, boundary, 1);
  cache.pin(0);
  for (let index = 1; index < 6; index += 1) {
    const frame = fakeFrame(index);
    frames.push(frame);
    cache.put(index, frame, 1);
  }
  cache.makeRoom();
  assert.equal(cache.size, 5);
  assert.equal(frames[1].closed, true, 'oldest unpinned frame is released before decode');
  for (let index = 6; index < 20; index += 1) {
    cache.put(index, fakeFrame(index), 1);
    assert.ok(cache.size <= 6);
    assert.equal(cache.has(0), true);
    assert.equal(boundary.closed, false);
  }
  cache.clear();
  assert.equal(boundary.closed, true);
  assert.equal(cache.size, 0);
  // clear also removes the pin, including when the same frame number is reused.
  cache.put(0, fakeFrame('replacement'), 1);
  for (let index = 1; index <= 6; index += 1) cache.put(index, fakeFrame(index), 1);
  assert.equal(cache.has(0), false);
  cache.clear();
});

test('LookaheadCache presentation and a second pin restore ordinary LRU eviction', () => {
  for (const release of ['presentation', 'second pin', 'explicit unpin']) {
    const cache = new LookaheadCache(2);
    const first = fakeFrame('first');
    const second = fakeFrame('second');
    cache.put(1, first, 1);
    cache.put(2, second, 1);
    cache.pin(1);
    if (release === 'presentation') {
      cache.getClone(1).frame.close();
      cache.getClone(2).frame.close(); // Make frame 1 oldest again.
    } else if (release === 'second pin') {
      cache.pin(2);
    } else {
      cache.unpin(1);
    }
    cache.makeRoom();
    assert.equal(first.closed, true, release);
    assert.equal(second.closed, false, release);
    cache.clear();
    assert.equal(second.closed, true);
  }
});

test('LookaheadCache with all slots pinned terminates makeRoom and never exceeds capacity', () => {
  const cache = new LookaheadCache(1);
  const pinned = fakeFrame('pinned');
  const incoming = fakeFrame('incoming');
  cache.put(0, pinned, 1);
  cache.pin(0);
  cache.makeRoom();
  assert.equal(cache.size, 1);
  assert.equal(pinned.closed, false);
  cache.put(1, incoming, 1);
  assert.equal(cache.size, 1);
  assert.equal(incoming.closed, true);
  cache.clear();
  assert.equal(pinned.closed, true);
});

test('LookaheadFrameSource pins new, cached, and shared in-flight prefetches until presentation', async () => {
  for (const mode of ['new', 'cached', 'in-flight']) {
    const frames = [];
    const accesses = [];
    let resolveBoundary;
    let decodes = 0;
    const request = { streamId: 'cut:1' };
    const source = new LookaheadFrameSource({
      async decode(timeUs) {
        decodes += 1;
        if (timeUs === 0 && mode === 'in-flight') {
          await new Promise(resolve => { resolveBoundary = resolve; });
        }
        // With capacity 2 the old unpinned frame must be closed before the next decode.
        if (timeUs >= 2e6) assert.equal(frames.at(-1).closed, true, mode);
        const frame = fakeFrame(timeUs);
        frames.push(frame);
        return frame;
      },
    }, { fps: 30, capacity: 2, onAccess: access => accesses.push(access) });
    assert.equal(source.has(0, request), false);
    assert.deepEqual(source.liveStreamIds(), [], 'has must not allocate a cache');
    let pending;
    if (mode === 'cached') await source.prefetch(0, request);
    if (mode === 'in-flight') pending = source.prefetch(0, request);
    const pinned = source.prefetch(0, { ...request, pin: true });
    if (mode === 'in-flight') {
      assert.equal(source.prefetch(0, request), pending, 'ordinary callers share the existing promise');
      resolveBoundary();
    }
    await pinned;
    assert.equal(decodes, 1, mode);
    assert.equal(source.has(1, request), true, 'has uses the same rounded frame number');
    assert.equal(source.has(0, { streamId: 'cut:2' }), false);
    for (let index = 1; index <= 5; index += 1) {
      await source.prefetch(index * 1e6, request);
      assert.equal(source.has(0, request), true, mode);
      assert.ok(frames.filter(frame => !frame.closed).length <= 2, mode);
    }
    const presented = await source.decode(0, undefined, request);
    assert.deepEqual(accesses.map(access => access.hit), [true], mode);
    assert.equal(source.has(0, request), true, 'presentation unpins without removing the entry');
    presented.close();
    (await source.decode(5e6, undefined, request)).close(); // Move the other frame to MRU.
    // The following decode must evict the now-unpinned boundary instead of the other frame.
    await source.prefetch(1e6, request);
    assert.equal(source.has(0, request), false, mode);
    assert.equal(frames[0].closed, true, mode);
    source.clear();
    assert.ok(frames.every(frame => frame.closed), mode);
  }
});

test('LookaheadFrameSource releaseStream and clear close pinned frames per stream', async () => {
  const frames = [];
  const source = new LookaheadFrameSource({
    async decode() {
      const frame = fakeFrame(frames.length);
      frames.push(frame);
      return frame;
    },
  }, { fps: 30, capacity: 6 });
  for (const streamId of ['a', 'b']) await source.prefetch(0, { streamId, pin: true });
  assert.equal(source.releaseStream('a'), true);
  assert.equal(source.has(0, { streamId: 'a' }), false);
  assert.equal(source.has(0, { streamId: 'b' }), true);
  assert.equal(frames[0].closed, true);
  assert.equal(frames[1].closed, false);
  source.clear();
  assert.equal(frames[1].closed, true);
  assert.deepEqual(source.liveStreamIds(), []);
});

test('a pin joining in-flight prefetch is applied before an already-waiting presentation unpins it', async () => {
  let resolveFrame;
  const accesses = [];
  let decodes = 0;
  const source = new LookaheadFrameSource({
    decode(timeUs) {
      decodes += 1;
      return timeUs === 0
        ? new Promise(resolve => { resolveFrame = resolve; })
        : Promise.resolve(fakeFrame(timeUs));
    },
  }, { fps: 30, capacity: 1, onAccess: access => accesses.push(access) });
  const request = { streamId: 'cut-1' };
  const prefetch = source.prefetch(0, request);
  const presentation = source.decode(0, undefined, request);
  const pin = source.prefetch(0, { ...request, pin: true });
  assert.equal(pin, prefetch, 'pinned and ordinary callers share the original in-flight promise');
  resolveFrame(fakeFrame('boundary'));
  await pin;
  (await presentation).close();
  assert.equal(decodes, 1);
  assert.equal(accesses[0].hit, true);
  await source.prefetch(1e6, request);
  assert.equal(source.has(0, request), false, 'completed presentation must not leave a late pin behind');
  assert.equal(source.has(1e6, request), true);
  source.clear();
});

test('failed pinned prefetch does not pin a later ordinary retry', async () => {
  let fail = true;
  const source = new LookaheadFrameSource({
    async decode(timeUs) {
      if (fail) throw new Error('decode failed');
      return fakeFrame(timeUs);
    },
  }, { fps: 30, capacity: 1 });
  const request = { streamId: 'cut-1' };
  await assert.rejects(source.prefetch(0, { ...request, pin: true }), /decode failed/u);
  fail = false;
  await source.prefetch(0, request);
  await source.prefetch(1e6, request);
  assert.equal(source.has(0, request), false);
  assert.equal(source.has(1e6, request), true);
  source.clear();
});
