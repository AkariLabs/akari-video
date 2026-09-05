import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildResolvedTimelinePlan,
  createPreviewScheduler,
} from '../dist/index.js';

const output = { width: 640, height: 360, colorSpace: 'bt709-limited' };
const videoSource = { decode: async () => { throw new Error('unit scheduler must not decode'); } };
const imageSource = { load: async () => { throw new Error('unit scheduler must not load images'); } };

function timelineFixture({ cuts, layers = [] }) {
  return buildResolvedTimelinePlan(cuts, { fps: 30, layers });
}

function sourceRegistry(ids) {
  return new Map(ids.map(id => [id, /\.png$/u.test(id) ? imageSource : videoSource]));
}

function fakeRuntime(ids, { pendingWarmups = false, headers = false, releaseResult = true } = {}) {
  const started = [];
  const released = [];
  const prefetched = [];
  const warmupResolvers = [];
  const headerResolvers = [];
  const headerCalls = [];
  let getSessionCalls = 0;
  const pools = new Map(ids.filter(id => !/\.png$/u.test(id)).map(sourceId => [sourceId, {
    async getSession(streamId = 'default') {
      getSessionCalls += 1;
      return {
        id: `${sourceId}:${streamId}`,
        warmup(sourceTimeUs) {
          started.push({ sourceId, streamId, sourceTimeUs });
          if (!pendingWarmups) return Promise.resolve(12);
          return new Promise(resolve => warmupResolvers.push(() => resolve(12)));
        },
      };
    },
    releaseSession(streamId) {
      released.push({ sourceId, streamId });
      return releaseResult;
    },
    ...(headers ? {
      prepareHeader() {
        headerCalls.push(sourceId);
        return new Promise(resolve => headerResolvers.push(resolve));
      },
    } : {}),
  }]));
  const lookahead = new Map([...pools.keys()].map(sourceId => [sourceId, {
    async prefetch(sourceTimeUs, request) {
      prefetched.push({ sourceId, streamId: request?.streamId, sourceTimeUs });
    },
  }]));
  return {
    pools, lookahead, started, released, prefetched, warmupResolvers,
    headerResolvers, headerCalls, getSessionCalls: () => getSessionCalls,
  };
}

function createScheduler(timeline, ids, runtime, metrics = { warmupMs: [] }, options = {}) {
  return createPreviewScheduler({
    timeline,
    sources: sourceRegistry(ids),
    output,
    fps: 30,
    pools: runtime.pools,
    lookahead: runtime.lookahead,
    metrics,
    options,
  });
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('cut and layer starts both schedule base, layer color, and mask while excluding still images', async () => {
  const ids = ['base-a', 'base-b', 'color', 'mask', 'still.png'];
  const timeline = timelineFixture({
    cuts: [
      { src: 'base-a', in: 0, out: 1 },
      { src: 'base-b', in: 2, out: 3 },
    ],
    layers: [
      { id: 'person', t: 0.5, duration: 1.5, kind: 'matte', src: 'color', mask: 'mask' },
      { id: 'poster', t: 0.5, duration: 1.5, kind: 'video', src: 'still.png' },
    ],
  });
  const runtime = fakeRuntime(ids, { pendingWarmups: true });
  const scheduler = createScheduler(timeline, ids, runtime);

  scheduler.notePresented(0);
  await flushMicrotasks();

  assert.deepEqual(
    runtime.started.map(item => `${item.sourceId}:${item.streamId}`).sort(),
    ['base-a:cut-0', 'base-b:cut-1', 'color:layer-person', 'mask:layer-person-mask'],
  );
  assert.equal(runtime.started.some(item => item.sourceId === 'still.png'), false);
  assert.deepEqual(scheduler.state().coverage, { warmed: 0, needed: 3, boundarySeconds: 0.5 });

  for (const resolve of runtime.warmupResolvers) resolve();
  await flushMicrotasks();
  assert.deepEqual(scheduler.state().coverage, { warmed: 3, needed: 3, boundarySeconds: 0.5 });

  scheduler.notePresented(450_000);
  await flushMicrotasks();
  assert.ok(runtime.prefetched.some(item => item.streamId === 'layer-person'));
  assert.ok(runtime.prefetched.some(item => item.streamId === 'layer-person-mask'));
});

test('all clips for one boundary begin warming in parallel', async () => {
  const ids = ['base-a', 'base-b', 'color', 'mask'];
  const timeline = timelineFixture({
    cuts: [
      { src: 'base-a', in: 0, out: 1 },
      { src: 'base-b', in: 1, out: 2 },
    ],
    layers: [{ id: 'matte', t: 1, duration: 1, kind: 'matte', src: 'color', mask: 'mask' }],
  });
  const runtime = fakeRuntime(ids, { pendingWarmups: true });
  const scheduler = createScheduler(timeline, ids, runtime);

  scheduler.notePresented(0);
  await flushMicrotasks();
  assert.equal(runtime.started.length, 3);
  assert.equal(runtime.warmupResolvers.length, 3);
  assert.equal(scheduler.state().coverage.warmed, 0);

  for (const resolve of runtime.warmupResolvers) resolve();
  await flushMicrotasks();
  assert.equal(scheduler.state().coverage.warmed, 3);
});

test('seek presentation keeps live prefetch but skips boundary warmup', async () => {
  const ids = ['base-a', 'base-b', 'color', 'mask'];
  const timeline = timelineFixture({
    cuts: [
      { src: 'base-a', in: 0, out: 1 },
      { src: 'base-b', in: 1, out: 2 },
    ],
    layers: [{ id: 'matte', t: 1, duration: 1, kind: 'matte', src: 'color', mask: 'mask' }],
  });
  const seekRuntime = fakeRuntime(ids, { pendingWarmups: true });
  const seekScheduler = createScheduler(timeline, ids, seekRuntime);

  seekScheduler.notePresented(0, { reason: 'seek' });
  await flushMicrotasks();
  assert.equal(seekRuntime.started.length, 0);
  assert.ok(seekRuntime.prefetched.length > 0);

  seekScheduler.notePresented(0, { reason: 'playback' });
  await flushMicrotasks();
  assert.equal(seekRuntime.started.length, 3);

  const defaultRuntime = fakeRuntime(ids, { pendingWarmups: true });
  const defaultScheduler = createScheduler(timeline, ids, defaultRuntime);
  defaultScheduler.notePresented(0);
  await flushMicrotasks();
  assert.equal(defaultRuntime.started.length, 3);
});

test('seek prefetches only base while playback also prefetches layer color and mask', async () => {
  const ids = ['base', 'color', 'mask'];
  const timeline = timelineFixture({
    cuts: [{ src: 'base', in: 0, out: 2 }],
    layers: [{ id: 'matte', t: 0, duration: 1, kind: 'matte', src: 'color', mask: 'mask' }],
  });
  const seekRuntime = fakeRuntime(ids);
  const seekScheduler = createScheduler(timeline, ids, seekRuntime);
  seekScheduler.notePresented(0, { reason: 'seek' });
  await flushMicrotasks();
  assert.ok(seekRuntime.prefetched.length > 0);
  assert.deepEqual(new Set(seekRuntime.prefetched.map(item => item.streamId)), new Set(['cut-0']));

  const playbackRuntime = fakeRuntime(ids);
  const playbackScheduler = createScheduler(timeline, ids, playbackRuntime);
  playbackScheduler.notePresented(0, { reason: 'playback' });
  await flushMicrotasks();
  assert.deepEqual(
    new Set(playbackRuntime.prefetched.map(item => item.streamId)),
    new Set(['cut-0', 'layer-matte', 'layer-matte-mask']),
  );
});

test('lead-in starts at 2.5 seconds and clamps adaptive p90 to 1.5 through 4.0 seconds', () => {
  const ids = ['base'];
  const timeline = timelineFixture({ cuts: [{ src: 'base', in: 0, out: 5 }] });
  const runtime = fakeRuntime(ids);
  const metrics = { warmupMs: [] };
  const scheduler = createScheduler(timeline, ids, runtime, metrics);

  assert.equal(scheduler.state().leadInSeconds, 2.5);
  metrics.warmupMs.push(3_000);
  assert.equal(scheduler.state().leadInSeconds, 4);
  metrics.warmupMs.splice(0, metrics.warmupMs.length, 10);
  assert.equal(scheduler.state().leadInSeconds, 1.5);
});

test('decoder pressure evicts the farthest next use and never releases the current stream', async () => {
  const ids = ['base'];
  const timeline = timelineFixture({
    cuts: [
      { src: 'base', in: 0, out: 0.5 },
      { src: 'base', in: 1, out: 1.5 },
      { src: 'base', in: 2, out: 2.5 },
      { src: 'base', in: 3, out: 3.5 },
    ],
  });
  const runtime = fakeRuntime(ids, { pendingWarmups: true });
  const scheduler = createScheduler(timeline, ids, runtime, { warmupMs: [] }, {
    maxLiveDecoders: 3,
  });

  scheduler.notePresented(0);
  await flushMicrotasks();

  assert.deepEqual(runtime.released, [{ sourceId: 'base', streamId: 'cut-2' }]);
  assert.equal(runtime.released.some(item => item.streamId === 'cut-0'), false);
  assert.equal(scheduler.state().evictions, 1);
  assert.equal(scheduler.state().decoderLimitHits, 1);
  assert.equal(scheduler.state().liveDecoders, 3);
});

test('a stale pool lane self-heals the live ledger without counting an eviction', async () => {
  const ids = ['base'];
  const timeline = timelineFixture({
    cuts: [
      { src: 'base', in: 0, out: 0.5 },
      { src: 'base', in: 1, out: 1.5 },
      { src: 'base', in: 2, out: 2.5 },
      { src: 'base', in: 3, out: 3.5 },
    ],
  });
  const runtime = fakeRuntime(ids, { pendingWarmups: true, releaseResult: false });
  const scheduler = createScheduler(timeline, ids, runtime, { warmupMs: [] }, {
    maxLiveDecoders: 3,
  });

  scheduler.notePresented(0);
  await flushMicrotasks();

  assert.deepEqual(runtime.released, [{ sourceId: 'base', streamId: 'cut-2' }]);
  assert.equal(scheduler.state().evictions, 0);
  assert.equal(scheduler.state().decoderLimitHits, 1);
  assert.equal(scheduler.state().liveDecoders, 3);
});

test('primeHeaders defers until first presentation and prepares only referenced sources in first-use order', async () => {
  const ids = ['unused', 'a', 'b', 'c'];
  const timeline = timelineFixture({
    cuts: [
      { src: 'c', in: 0, out: 10 },
      { src: 'a', in: 0, out: 1 },
    ],
    layers: [{ id: 'later-layer', t: 5, duration: 1, kind: 'video', src: 'b' }],
  });
  const runtime = fakeRuntime(ids, { headers: true });
  const scheduler = createScheduler(timeline, ids, runtime, { warmupMs: [] }, {
    headerConcurrency: 2,
  });

  let returned = false;
  scheduler.primeHeaders();
  returned = true;
  scheduler.primeHeaders();
  assert.equal(returned, true);
  assert.deepEqual(runtime.headerCalls, []);
  assert.equal(runtime.getSessionCalls(), 0);

  scheduler.notePresented(0);
  assert.deepEqual(runtime.headerCalls, []);
  await flushMicrotasks();
  assert.deepEqual(runtime.headerCalls, ['c', 'b']);
  assert.equal(runtime.getSessionCalls(), 0);

  runtime.headerResolvers.shift()?.();
  await flushMicrotasks();
  assert.deepEqual(runtime.headerCalls, ['c', 'b', 'a']);
  for (const resolve of runtime.headerResolvers.splice(0)) resolve();
  await flushMicrotasks();
  assert.deepEqual(runtime.headerCalls, ['c', 'b', 'a']);
  assert.equal(runtime.headerCalls.includes('unused'), false);
  assert.equal(runtime.getSessionCalls(), 0);
});

test('warmupNextBoundary warms only the next distant boundary once, in flight and after completion', async () => {
  const ids = ['a', 'b', 'c'];
  const timeline = timelineFixture({ cuts: [
    { src: 'a', in: 0, out: 10 },
    { src: 'b', in: 0, out: 10 },
    { src: 'c', in: 0, out: 10 },
  ] });
  const runtime = fakeRuntime(ids, { pendingWarmups: true });
  const scheduler = createScheduler(timeline, ids, runtime);
  scheduler.notePresented(2_000_000, { reason: 'seek' });
  assert.ok(10 - 2 > scheduler.state().leadInSeconds);
  scheduler.warmupNextBoundary();
  scheduler.warmupNextBoundary();
  await flushMicrotasks();
  assert.deepEqual(runtime.started.map(item => item.sourceId), ['b']);
  for (const resolve of runtime.warmupResolvers) resolve();
  await flushMicrotasks();
  scheduler.warmupNextBoundary();
  await flushMicrotasks();
  assert.equal(runtime.started.length, 1);
  assert.equal(scheduler.state().coverage.warmed, 1);
  scheduler.warmupNextBoundary(30);
  scheduler.dispose();
  scheduler.warmupNextBoundary(10);
  await flushMicrotasks();
  assert.equal(runtime.started.length, 1);
});

test('warmupNextBoundary respects the live decoder limit and protects the current stream', async () => {
  const ids = ['a', 'b'];
  const timeline = timelineFixture({ cuts: [
    { src: 'a', in: 0, out: 10 },
    { src: 'b', in: 0, out: 10 },
  ] });
  const runtime = fakeRuntime(ids, { pendingWarmups: true });
  const scheduler = createScheduler(timeline, ids, runtime, { warmupMs: [] }, { maxLiveDecoders: 1 });
  scheduler.notePresented(0, { reason: 'seek' });
  scheduler.warmupNextBoundary(0);
  await flushMicrotasks();
  assert.equal(scheduler.state().liveDecoders, 1);
  assert.equal(scheduler.state().decoderLimitHits, 1);
  assert.deepEqual(runtime.started, []);
  assert.deepEqual(runtime.released, []);
});
