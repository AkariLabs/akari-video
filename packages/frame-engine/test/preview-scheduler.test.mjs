import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildResolvedTimelinePlan,
  createPreviewScheduler,
  evaluationPlanFromResolvedTimeline,
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
      prefetched.push({ sourceId, streamId: request?.streamId, sourceTimeUs, pin: request?.pin });
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
  // Drain getSession -> warmup -> pinned prefetch -> coverage completion.
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

test('cut and layer starts both schedule base, layer color, and mask while excluding still images', async () => {
  const ids = ['base-a', 'base-b', 'color', 'mask', 'still.png'];
  const timeline = timelineFixture({
    cuts: [
      { src: 'base-a', in: 0, out: 0.99 },
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
      { src: 'base', in: 0, out: 0.49 },
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
      { src: 'base', in: 0, out: 0.49 },
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
    { src: 'a', in: 0, out: 9.99 },
    { src: 'b', in: 0, out: 10 },
    { src: 'c', in: 0, out: 10 },
  ] });
  const runtime = fakeRuntime(ids, { pendingWarmups: true });
  const scheduler = createScheduler(timeline, ids, runtime);
  scheduler.notePresented(2_000_000, { reason: 'seek' });
  assert.ok(9.99 - 2 > scheduler.state().leadInSeconds);
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
  assert.deepEqual(runtime.prefetched.filter(item => item.pin), [
    { sourceId: 'b', streamId: 'cut-1', sourceTimeUs: 10_000, pin: true },
  ]);
  scheduler.warmupNextBoundary(30);
  scheduler.dispose();
  scheduler.warmupNextBoundary(10);
  await flushMicrotasks();
  assert.equal(runtime.started.length, 1);
});

test('warmupNextBoundary respects the live decoder limit and protects the current stream', async () => {
  const ids = ['a', 'b'];
  const timeline = timelineFixture({ cuts: [
    { src: 'a', in: 0, out: 9.99 },
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
  assert.equal(runtime.prefetched.some(item => item.pin), false);
  assert.deepEqual(runtime.released, []);
});

test('coverage waits for pinned prefetch of the first boundary grid frame, including speed changes', async () => {
  for (const [boundary, sourceId, streamId, expectedSourceUs] of [
    [10.4, 'b', 'cut-1', 2_066_667],
    [10.41, 'b', 'cut-1', 2_046_667],
    [10.42, 'b', 'cut-1', 2_026_667],
  ]) {
    const ids = ['a', 'b'];
    const timeline = timelineFixture({ cuts: [
      { src: 'a', in: 0, out: boundary },
      { src: 'b', in: 2, out: 6, speed: 2 },
    ] });
    const runtime = fakeRuntime(ids, { pendingWarmups: true });
    const prefetched = [];
    let resolvePrefetch;
    runtime.lookahead.set(sourceId, {
      prefetch(timeUs, request) {
        prefetched.push({ timeUs, request });
        return new Promise(resolve => { resolvePrefetch = resolve; });
      },
    });
    const scheduler = createScheduler(timeline, ids, runtime);
    const firstFrameUs = 313 / 30 * 1e6;
    const plan = evaluationPlanFromResolvedTimeline(timeline, firstFrameUs, sourceRegistry(ids), output);
    assert.equal(plan.base[0].id, streamId);
    const sourceTimeUs = plan.base[0].sourceTimeUs;
    assert.equal(sourceTimeUs, expectedSourceUs);

    scheduler.warmupNextBoundary();
    await flushMicrotasks();
    assert.deepEqual(prefetched, []);
    assert.deepEqual(runtime.started.map(item => item.streamId), ['cut-1']);
    assert.equal(runtime.started[0].sourceTimeUs, sourceTimeUs + 1e6 / 30);
    runtime.warmupResolvers[0]();
    await flushMicrotasks();
    assert.deepEqual(prefetched, [{ timeUs: sourceTimeUs, request: { streamId, pin: true } }]);
    assert.deepEqual(scheduler.state().coverage, { warmed: 0, needed: 1, boundarySeconds: boundary });
    assert.equal(scheduler.isWarmed(streamId), false);
    scheduler.warmupNextBoundary();
    await flushMicrotasks();
    assert.equal(prefetched.length, 1, 'pending pin requests are shared');
    resolvePrefetch();
    await flushMicrotasks();
    assert.deepEqual(scheduler.state().coverage, { warmed: 1, needed: 1, boundarySeconds: boundary });
    assert.equal(scheduler.isWarmed(streamId), true);
    scheduler.dispose();
  }
});

for (const [name, boundary, expectedSourceUs] of [
  ['grid-aligned cut boundary at 10.4s pins cut-1 at frame 313', 10.4, 33_333],
  ['non-grid-aligned cut boundary at 10.41s pins cut-1 at frame 313', 10.41, 23_333],
]) {
  test(name, async () => {
    const ids = ['h264', 'hevc-4k'];
    const timeline = timelineFixture({ cuts: [
      { src: 'h264', in: 0, out: boundary },
      { src: 'hevc-4k', in: 0, out: 5 },
    ] });
    const runtime = fakeRuntime(ids);
    const scheduler = createScheduler(timeline, ids, runtime);
    const plan = evaluationPlanFromResolvedTimeline(timeline, 313 / 30 * 1e6, sourceRegistry(ids), output);
    assert.equal(plan.base[0].id, 'cut-1');
    assert.equal(plan.base[0].sourceTimeUs, expectedSourceUs);

    scheduler.warmupNextBoundary();
    await flushMicrotasks();
    assert.deepEqual(runtime.started, [{
      sourceId: 'hevc-4k', streamId: 'cut-1', sourceTimeUs: expectedSourceUs + 1e6 / 30,
    }]);
    assert.deepEqual(runtime.prefetched.filter(item => item.pin), [{
      sourceId: 'hevc-4k', streamId: 'cut-1', sourceTimeUs: plan.base[0].sourceTimeUs, pin: true,
    }]);
    scheduler.dispose();
  });
}

test('grid-aligned layer boundary at 2.0s pins layer and mask at frame 60, with base first', async () => {
  const ids = ['base', 'color', 'mask'];
  const timeline = timelineFixture({
    cuts: [
      { src: 'base', in: 0, out: 2 },
      { src: 'base', in: 4, out: 6 },
    ],
    layers: [{ id: 'matte', t: 2, duration: 1, kind: 'matte', src: 'color', mask: 'mask' }],
  });
  const runtime = fakeRuntime(ids);
  const scheduler = createScheduler(timeline, ids, runtime);
  const layerPlan = evaluationPlanFromResolvedTimeline(timeline, 60 / 30 * 1e6, sourceRegistry(ids), output);
  const basePlan = evaluationPlanFromResolvedTimeline(timeline, 61 / 30 * 1e6, sourceRegistry(ids), output);
  assert.equal(layerPlan.layers[0].sourceTimeUs, 0);
  assert.notEqual(layerPlan.layers[0].sourceTimeUs, basePlan.layers[0].sourceTimeUs);
  assert.equal(basePlan.base[0].id, 'cut-1');

  scheduler.warmupNextBoundary();
  await flushMicrotasks();
  assert.deepEqual(runtime.started.map(item => item.streamId), ['cut-1', 'layer-matte', 'layer-matte-mask']);
  assert.deepEqual(runtime.prefetched.filter(item => item.pin), [
    { sourceId: 'base', streamId: 'cut-1', sourceTimeUs: basePlan.base[0].sourceTimeUs, pin: true },
    { sourceId: 'color', streamId: 'layer-matte', sourceTimeUs: layerPlan.layers[0].sourceTimeUs, pin: true },
    { sourceId: 'mask', streamId: 'layer-matte-mask', sourceTimeUs: layerPlan.layers[0].mask.sourceTimeUs, pin: true },
  ]);
  assert.deepEqual(scheduler.state().coverage, { warmed: 3, needed: 3, boundarySeconds: 2 });
  scheduler.dispose();
});

test('a failed boundary prefetch warns, leaves coverage cold, and permits retry', async () => {
  const ids = ['a', 'b'];
  const timeline = timelineFixture({ cuts: [
    { src: 'a', in: 0, out: 9.99 }, { src: 'b', in: 0, out: 10 },
  ] });
  const runtime = fakeRuntime(ids);
  const warnings = [];
  let fail = true;
  let calls = 0;
  runtime.lookahead.set('b', {
    async prefetch() {
      calls += 1;
      if (fail) throw new Error('prefetch failed');
    },
  });
  const metrics = { warmupMs: [], onWarning: message => warnings.push(message) };
  const scheduler = createScheduler(timeline, ids, runtime, metrics);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    scheduler.warmupNextBoundary();
    await flushMicrotasks();
    assert.equal(scheduler.state().coverage.warmed, 0);
    assert.equal(scheduler.state().liveDecoders, 0);
    assert.equal(scheduler.isWarmed('cut-1'), false);
  }
  assert.deepEqual(warnings, ['warmup cut-1: prefetch failed']);
  assert.deepEqual(metrics.warmupMs, []);
  fail = false;
  scheduler.warmupNextBoundary();
  await flushMicrotasks();
  assert.equal(calls, 3);
  assert.equal(scheduler.state().coverage.warmed, 1);
  scheduler.dispose();
});

test('playback repins a missing warmed boundary while seek and legacy lookahead do not', async () => {
  const ids = ['a', 'b'];
  const timeline = timelineFixture({ cuts: [
    { src: 'a', in: 0, out: 9.99 }, { src: 'b', in: 0, out: 10 },
  ] });
  const runtime = fakeRuntime(ids);
  const cached = runtime.lookahead.get('b');
  let retained = true;
  cached.has = (timeUs, request) => {
    assert.equal(timeUs, 10_000);
    assert.deepEqual(request, { streamId: 'cut-1' });
    return retained;
  };
  const scheduler = createScheduler(timeline, ids, runtime);
  const pins = () => runtime.prefetched.filter(item => item.pin);
  scheduler.warmupNextBoundary();
  await flushMicrotasks();
  assert.equal(pins().length, 1);
  scheduler.notePresented(9e6, { reason: 'playback' });
  await flushMicrotasks();
  assert.equal(pins().length, 1, 'retained boundary needs no work');
  retained = false;
  scheduler.notePresented(9e6, { reason: 'seek' });
  await flushMicrotasks();
  assert.equal(pins().length, 1, 'seek never schedules a boundary pin');
  scheduler.notePresented(9e6, { reason: 'playback' });
  scheduler.notePresented(9e6, { reason: 'playback' });
  await flushMicrotasks();
  assert.equal(pins().length, 2, 'missing boundary is repinned once while in flight');
  assert.deepEqual(pins()[1], { sourceId: 'b', streamId: 'cut-1', sourceTimeUs: 10_000, pin: true });
  delete cached.has;
  scheduler.notePresented(9e6, { reason: 'playback' });
  await flushMicrotasks();
  assert.equal(pins().length, 2, 'legacy lookahead without has remains compatible');
  scheduler.reset();
  assert.equal(scheduler.isWarmed('cut-1'), false);
  scheduler.dispose();
});

test('warmup timing includes getSession, decoder warmup, and prefetch before adapting lead-in', async () => {
  const ids = ['a', 'b'];
  const timeline = timelineFixture({ cuts: [
    { src: 'a', in: 0, out: 9.99 }, { src: 'b', in: 0, out: 10 },
  ] });
  const runtime = fakeRuntime(ids);
  let clock = 100;
  let resolveSession;
  let resolveWarmup;
  let resolvePrefetch;
  runtime.pools.set('b', {
    getSession() { return new Promise(resolve => { resolveSession = resolve; }); },
  });
  runtime.lookahead.set('b', {
    prefetch() { return new Promise(resolve => { resolvePrefetch = resolve; }); },
  });
  const warmed = [];
  const metrics = { warmupMs: [], onWarmed: (...args) => warmed.push(args) };
  const scheduler = createScheduler(timeline, ids, runtime, metrics, { now: () => clock });
  scheduler.warmupNextBoundary();
  clock = 800;
  resolveSession({
    id: 'b:cut-1',
    warmup(nearStartUs, frameDurationUs) {
      assert.equal(nearStartUs, 10_000 + 1e6 / 30);
      assert.equal(frameDurationUs, 1e6 / 30);
      return new Promise(resolve => { resolveWarmup = resolve; });
    },
  });
  await flushMicrotasks();
  clock = 1300;
  resolveWarmup(500);
  await flushMicrotasks();
  assert.deepEqual(metrics.warmupMs, []);
  clock = 1500;
  resolvePrefetch();
  await flushMicrotasks();
  assert.deepEqual(metrics.warmupMs, [1400]);
  assert.deepEqual(warmed, [['cut-1', 1400]]);
  assert.equal(scheduler.state().leadInSeconds, 2.1);
  scheduler.dispose();
});

test('scheduler without lookahead still completes session warmup', async () => {
  const ids = ['a', 'b'];
  const timeline = timelineFixture({ cuts: [
    { src: 'a', in: 0, out: 10 }, { src: 'b', in: 0, out: 10 },
  ] });
  const runtime = fakeRuntime(ids);
  runtime.lookahead.clear();
  const scheduler = createScheduler(timeline, ids, runtime);
  scheduler.warmupNextBoundary();
  await flushMicrotasks();
  assert.equal(scheduler.state().coverage.warmed, 1);
  scheduler.dispose();
});

for (const staleResult of ['warmup resolve', 'prefetch resolve', 'warmup reject']) {
  test(`invalidateSource replaces pending work and ignores stale ${staleResult}`, async () => {
    const ids = ['a', 'b'];
    const timeline = timelineFixture({ cuts: [
      { src: 'a', in: 0, out: 10 }, { src: 'b', in: 0, out: 10 },
    ] });
    const runtime = fakeRuntime(ids);
    let finishOld;
    const oldPending = new Promise((resolve, reject) => {
      finishOld = () => staleResult === 'warmup reject'
        ? reject(new Error('old source unavailable')) : resolve(12);
    });
    runtime.pools.set('b', {
      async getSession() {
        return { id: 'old', warmup: () => staleResult === 'prefetch resolve' ? Promise.resolve(12) : oldPending };
      },
    });
    runtime.lookahead.set('b', { prefetch: () => oldPending });
    const warnings = [];
    let changed = 0;
    const metrics = { warmupMs: [], onWarning: message => warnings.push(message), onChanged: () => changed++ };
    const scheduler = createScheduler(timeline, ids, runtime, metrics);
    scheduler.notePresented(2e6, { reason: 'seek' });
    scheduler.warmupNextBoundary();
    await flushMicrotasks();

    const replacement = fakeRuntime(['b'], { pendingWarmups: true });
    let finishPin;
    replacement.lookahead.set('b', {
      prefetch(sourceTimeUs, request) {
        replacement.prefetched.push({ sourceTimeUs, request });
        return new Promise(resolve => { finishPin = resolve; });
      },
    });
    // The scheduler retains these same maps while the client replaces their entries.
    runtime.pools.set('b', replacement.pools.get('b'));
    runtime.lookahead.set('b', replacement.lookahead.get('b'));
    const beforeChanged = changed;
    scheduler.invalidateSource('b');
    assert.ok(changed > beforeChanged);
    assert.equal(replacement.getSessionCalls(), 1, 'retry starts immediately, even after seek outside lead-in');
    await flushMicrotasks();
    finishOld();
    await flushMicrotasks();
    assert.deepEqual(scheduler.state().coverage, { warmed: 0, needed: 1, boundarySeconds: 10 });
    assert.equal(scheduler.isWarmed('cut-1'), false);
    assert.deepEqual(metrics.warmupMs, []);
    assert.deepEqual(replacement.prefetched, [], 'stale work cannot prefetch into the new lookahead');
    scheduler.warmupNextBoundary();
    assert.equal(replacement.getSessionCalls(), 1, 'stale completion must preserve the new in-flight entry');
    replacement.warmupResolvers[0]();
    await flushMicrotasks();
    assert.deepEqual(replacement.prefetched, [{
      sourceTimeUs: 33_333, request: { streamId: 'cut-1', pin: true },
    }]);
    assert.equal(scheduler.state().coverage.warmed, 0);
    finishPin();
    await flushMicrotasks();
    assert.deepEqual(scheduler.state().coverage, { warmed: 1, needed: 1, boundarySeconds: 10 });
    assert.equal(metrics.warmupMs.length, 1);
    assert.deepEqual(warnings, []);
    scheduler.dispose();
  });
}

test('invalidateSource retries a rejected warmup after one warning without marking it warmed', async () => {
  const ids = ['a', 'b'];
  const timeline = timelineFixture({ cuts: [
    { src: 'a', in: 0, out: 10 }, { src: 'b', in: 0, out: 10 },
  ] });
  const runtime = fakeRuntime(ids);
  runtime.pools.set('b', {
    async getSession() {
      return { id: 'failed', async warmup() { throw new Error('source unavailable'); } };
    },
  });
  const warnings = [];
  const metrics = { warmupMs: [], onWarning: message => warnings.push(message) };
  const scheduler = createScheduler(timeline, ids, runtime, metrics);
  scheduler.warmupNextBoundary();
  await flushMicrotasks();
  assert.deepEqual(warnings, ['warmup cut-1: source unavailable']);
  assert.equal(scheduler.state().coverage.warmed, 0);
  assert.equal(scheduler.state().liveDecoders, 0);
  assert.equal(scheduler.isWarmed('cut-1'), false);
  assert.deepEqual(metrics.warmupMs, []);
  assert.deepEqual(runtime.prefetched, []);
  const replacement = fakeRuntime(['b']);
  runtime.pools.set('b', replacement.pools.get('b'));
  runtime.lookahead.set('b', replacement.lookahead.get('b'));
  scheduler.invalidateSource('b');
  await flushMicrotasks();
  assert.equal(replacement.getSessionCalls(), 1);
  assert.deepEqual(replacement.prefetched, [
    { sourceId: 'b', streamId: 'cut-1', sourceTimeUs: 33_333, pin: true },
  ]);
  assert.deepEqual(scheduler.state().coverage, { warmed: 1, needed: 1, boundarySeconds: 10 });
  assert.equal(warnings.length, 1);
  scheduler.dispose();
});

test('invalidateSource clears all matching streams while preserving other sources warmed, live, and in-flight', async () => {
  const ids = ['a', 'b', 'bb', 'b::variant'];
  const timeline = timelineFixture({
    cuts: [{ src: 'a', in: 0, out: 10 }, { src: 'b', in: 0, out: 10 }],
    layers: [
      { id: 'same', src: 'b', kind: 'video', t: 10, duration: 5 },
      { id: 'prefix', src: 'bb', kind: 'video', t: 10, duration: 5 },
      { id: 'separator', src: 'b::variant', kind: 'video', t: 10, duration: 5 },
    ],
  });
  const runtime = fakeRuntime(ids, { pendingWarmups: true });
  const scheduler = createScheduler(timeline, ids, runtime);
  scheduler.warmupNextBoundary();
  await flushMicrotasks();
  assert.equal(runtime.started.length, 4);
  runtime.started.forEach((item, index) => {
    if (item.sourceId !== 'b::variant') runtime.warmupResolvers[index]();
  });
  await flushMicrotasks();
  assert.equal(scheduler.state().coverage.warmed, 3);
  const replacement = fakeRuntime(['b'], { pendingWarmups: true });
  runtime.pools.set('b', replacement.pools.get('b'));
  runtime.lookahead.set('b', replacement.lookahead.get('b'));
  scheduler.invalidateSource('b');
  await flushMicrotasks();
  assert.equal(scheduler.state().coverage.warmed, 1);
  assert.equal(scheduler.state().liveDecoders, 4);
  assert.equal(scheduler.isWarmed('layer-prefix'), true);
  assert.equal(scheduler.isWarmed('cut-1'), false);
  assert.equal(scheduler.isWarmed('layer-same'), false);
  assert.deepEqual(replacement.started.map(item => item.streamId), ['cut-1', 'layer-same']);
  assert.equal(runtime.started.length, 4, 'other sources must not restart');
  runtime.warmupResolvers[runtime.started.findIndex(item => item.sourceId === 'b::variant')]();
  await flushMicrotasks();
  assert.equal(scheduler.state().coverage.warmed, 2, 'other source remains in flight');
  for (const resolve of replacement.warmupResolvers) resolve();
  await flushMicrotasks();
  assert.deepEqual(scheduler.state().coverage, { warmed: 4, needed: 4, boundarySeconds: 10 });
  assert.deepEqual(runtime.released, []);
  scheduler.dispose();
});

test('invalidateSource does not start warmup after dispose', async () => {
  const ids = ['a', 'b'];
  const timeline = timelineFixture({ cuts: [
    { src: 'a', in: 0, out: 10 }, { src: 'b', in: 0, out: 10 },
  ] });
  const runtime = fakeRuntime(ids, { pendingWarmups: true });
  const scheduler = createScheduler(timeline, ids, runtime);
  scheduler.warmupNextBoundary();
  await flushMicrotasks();
  scheduler.dispose();
  scheduler.invalidateSource('b');
  runtime.warmupResolvers[0]();
  await flushMicrotasks();
  assert.equal(runtime.getSessionCalls(), 1);
  assert.deepEqual(runtime.prefetched, []);
  assert.equal(scheduler.state().liveDecoders, 0);
  assert.equal(scheduler.state().coverage.warmed, 0);
});
