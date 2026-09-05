import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const [source, scheduler, app] = await Promise.all([
  readFile(path.join(root, 'src/frame-engine-client.ts'), 'utf8'),
  readFile(path.join(root, '../frame-engine/src/cache/preview-scheduler.ts'), 'utf8'),
  readFile(path.join(root, 'public/app.js'), 'utf8'),
]);

function extract(text, marker, indent = '') {
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `missing ${marker}`);
  const end = text.indexOf(`\n${indent}}`, start);
  assert.ok(end > start, `missing end of ${marker}`);
  return text.slice(start, end + indent.length + 2);
}

const initialSourceIds = runInNewContext(`(${stripTypeScriptTypes(
  extract(source, 'function initialSourceIds('),
)})`);
const cuts = [
  { id: 'cut-0', src: 'srcA', in: 0, out: 5 },
  { id: 'cut-1', src: 'srcB', in: 0, out: 5 },
];
const layers = [
  { t: 0, duration: 5, src: 'L0', mask: 'M0' },
  { t: 5, duration: 5, src: 'L1' },
];

test('initialSourceIds selects only the current cut, layer, and mask', () => {
  const initial = initialSourceIds({}, { fps: 30 }, cuts, layers, 0);
  assert.deepEqual([...initial].sort(), ['L0', 'M0', 'srcA']);
  assert.equal(initial.has('srcB'), false);
  assert.equal(initial.has('L1'), false);
  const later = initialSourceIds({}, { fps: 30 }, cuts, layers, 6);
  assert.equal(later.has('srcB'), true);
  assert.equal(later.has('srcA'), false);
  assert.doesNotThrow(() => initialSourceIds({}, {}, [], [], 0));
  for (const time of [-1, 10, Infinity, NaN]) {
    assert.equal(initialSourceIds({}, {}, cuts, layers, time).size, 0);
  }
});

test('initialSourceIds follows speed, freeze, transitions, and explicit track placement', () => {
  const overlapping = [
    { src: 'a', in: 0, out: 8, speed: 2, freeze: { at_sec: 1, duration_sec: 2 },
      transition_out: { type: 'crossfade', duration: 1 } },
    { src: 'b', in: 0, out: 5 },
  ];
  assert.deepEqual([...initialSourceIds({}, {}, overlapping, [], 4.5)], ['a']);
  assert.deepEqual([...initialSourceIds({}, {}, overlapping, [], 5.5)], ['a', 'b']);
  assert.deepEqual([...initialSourceIds({}, {}, overlapping, [], 6)], ['b']);
  const tracked = [...cuts, { src: 'upper', in: 0, out: 2, at: 6, track: 1 }];
  assert.deepEqual([...initialSourceIds({}, {}, tracked, [], 6)], ['srcB', 'upper']);
});

test('prime awaits exactly one presentation, after audio prime and before ready and warmup', async () => {
  const primeSource = extract(source, 'async prime(', '  ');
  assert.equal([...primeSource.matchAll(/await this\.renderFrame\(/gu)].length, 1);
  const prime = runInNewContext(`(${stripTypeScriptTypes(
    primeSource.replace('async prime(', 'async function prime('),
  )})`, { performance: { now: () => 0 } });
  const events = [];
  let finish;
  const drawing = new Promise(resolve => { finish = resolve; });
  const ui = { root: { dataset: { frameEngineReady: 'false' } } };
  const pending = prime.call({
    ui,
    audio: { prime: () => events.push('audio') },
    renderFrame: async (time, reason) => {
      events.push([time, reason]);
      await drawing;
      events.push('presented');
    },
    scheduler: {
      primeHeaders: () => { assert.equal(ui.root.dataset.frameEngineReady, 'true'); events.push('headers'); },
      warmupNextBoundary: time => events.push(['warmup', time]),
    },
  }, 6);
  assert.deepEqual(events, ['audio', [6, 'seek']]);
  assert.equal(ui.root.dataset.frameEngineReady, 'false');
  finish();
  await pending;
  assert.deepEqual(events, ['audio', [6, 'seek'], 'presented', 'headers', ['warmup', 6]]);
});

test('scheduler declares and implements explicit boundary warmup', () => {
  assert.match(source, /this\.scheduler\.warmupNextBoundary\(start\)/u);
  assert.match(scheduler, /warmupNextBoundary\(fromSeconds\?: number\): void/u);
  assert.match(scheduler, /const warmupNextBoundary = \(fromSeconds = latestTimeSeconds\)/u);
  assert.match(scheduler, /startWarmup\(requirement, boundary, currentKeys\)/u);
});

test('bundle starts with fetches and fonts wait after runtime creation before either path draws captions', () => {
  const init = extract(app, 'async function init()');
  const fetchAt = init.indexOf('fetch(');
  const fontAwait = init.indexOf('await window.__akariCaptionFontReady');
  assert.ok(fetchAt >= 0 && fontAwait > fetchAt);
  const join = init.match(/await Promise\.all\(\[([\s\S]*?)\]\)/u);
  assert.ok(join);
  assert.match(join[1], /fetch\(api\.timeline\)/u);
  assert.match(join[1], /fetch\(api\.summary\)/u);
  assert.match(join[1], /fetch\(api\.captions\)/u);
  assert.doesNotMatch(join[1], /window\.__akariCaptionFontReady/u);
  assert.match(init, /const frameEngineModule = frameEngineEnabled\s*\? \(async \(\) => await import\('\/frame-engine\.bundle\.js'\)\)\(\) : null/u);
  assert.ok(init.indexOf("import('/frame-engine.bundle.js')") < init.indexOf(join[0]));
  assert.match(init, /frameEngineModule\?\.catch\(\(\) => \{\}\)/u);
  assert.match(init, /if \(frameEngineEnabled\) \{\s*const \{ createFrameEnginePreview \} = await frameEngineModule/u);
  assert.ok(init.indexOf('await frameEngineModule') > fetchAt);
  assert.ok(fontAwait > init.indexOf('await createFrameEnginePreview('));
  assert.ok(fontAwait < init.indexOf('updateCaption()'));
  assert.match(init, /\}\s*await window\.__akariCaptionFontReady;\s*captionFontsReady = true;\s*if \(frameEngineEnabled\)/u);
  assert.match(app, /function updateCaption\(\) \{\s*if \(!captionFontsReady\) return/u);
  assert.match(init, /catch \(e\) \{\s*showMessage\(e\.message\)/u);
});

test('remaining sources are provisional and auto-proxy generation never blocks startup', () => {
  assert.match(source, /reason: 'pending-probe'/u);
  assert.doesNotMatch(source, /await requestAutoProxy\(/u);
  assert.doesNotMatch(source,
    /for \(const candidate of candidates\.values\(\)\) \{[\s\S]*?await probeSourceCodec/u);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const supported = { codec: 'hvc1', hw: true, sw: false, any: true };
const probeResult = { info: { codec: 'hvc1' }, support: supported };

function resolverHarness(ids, globals = {}) {
  let current = true;
  const applied = [];
  const notices = [];
  const resolve = runInNewContext(`(${stripTypeScriptTypes(
    extract(source, 'async function resolveSourceChoices('),
  )})`, {
    console,
    needsCodecProbe: () => true,
    chooseSource: () => ({ chosen: 'original', reason: 'hardware-ok' }),
    probeSourceCodec: async () => probeResult,
    ...globals,
  });
  const candidates = new Map(ids.map(id => [id, { id, originalUrl: `/${id}`, proxyUrl: null }]));
  const context = {
    mode: 'auto',
    ui: { showNotice: message => notices.push(message), clearNotice: () => notices.push(null) },
    cutSourceIds: new Set(ids),
    initialIds: new Set(['a']),
    firstUses: new Map([['a', 0], ['b', 5], ['c', 10], ['d', 15]]),
    isCurrent: () => current,
  };
  return {
    resolve: () => resolve(candidates, context), context, applied, notices,
    runtime: { applySourceChoice: async (id, choice) => applied.push({ id, choice }) },
    invalidate: () => { current = false; },
  };
}

test('background probes start after presentation, in first-use order with at most two active', async () => {
  const calls = [];
  const pending = new Map(['b', 'c', 'd'].map(id => [id, deferred()]));
  let active = 0;
  let peak = 0;
  const harness = resolverHarness(['d', 'c', 'a', 'b', 'poster.png', 'unused'], {
    probeSourceCodec: async url => {
      const id = url.slice(1);
      calls.push(id);
      active += 1;
      peak = Math.max(peak, active);
      if (pending.has(id)) await pending.get(id).promise;
      active -= 1;
      return probeResult;
    },
  });
  harness.context.cutSourceIds.delete('unused');
  const resolution = await harness.resolve();
  assert.deepEqual(calls, ['a']);
  assert.equal(resolution.choices.get('b').reason, 'pending-probe');
  assert.equal(resolution.choices.get('b').support, null);
  assert.equal(resolution.choices.get('poster.png').reason, 'still-image');
  assert.equal(resolution.choices.get('unused').reason, 'not-a-cut-source');
  resolution.startBackground(harness.runtime);
  resolution.startBackground(harness.runtime);
  assert.deepEqual(calls, ['a', 'b', 'c']);
  pending.get('b').resolve();
  await flush();
  assert.deepEqual(calls, ['a', 'b', 'c', 'd']);
  pending.get('c').resolve();
  pending.get('d').resolve();
  await flush();
  assert.equal(peak, 2);
  assert.deepEqual(harness.applied.map(item => item.id).sort(), ['b', 'c', 'd']);
  assert.equal(resolution.choices.get('b').reason, 'hardware-ok');
});

test('generation changes prevent old background probes from applying or starting more work', async () => {
  const pending = deferred();
  const calls = [];
  const harness = resolverHarness(['a', 'b', 'c', 'd'], {
    probeSourceCodec: async url => {
      calls.push(url);
      if (url !== '/a') await pending.promise;
      return probeResult;
    },
  });
  const resolution = await harness.resolve();
  resolution.startBackground(harness.runtime);
  harness.invalidate();
  pending.resolve();
  await flush();
  assert.deepEqual(calls, ['/a', '/b', '/c']);
  assert.deepEqual(harness.applied, []);
});

test('auto-proxy remains provisional until completion and defers replacements until presentation', async () => {
  for (const completeBeforePresentation of [false, true]) {
    const pending = deferred();
    let requested = 0;
    const harness = resolverHarness(['a'], {
      chooseSource: () => ({ chosen: 'auto-proxy', reason: 'auto-proxy' }),
      requestAutoProxy: () => { requested += 1; return pending.promise; },
    });
    const resolution = await harness.resolve();
    assert.equal(requested, 1);
    assert.equal(resolution.choices.get('a').reason, 'auto-proxy-pending');
    assert.equal(resolution.choices.get('a').url, '/a');
    if (completeBeforePresentation) {
      pending.resolve('/proxy/a.mp4');
      await flush();
      assert.deepEqual(harness.applied, []);
    }
    resolution.startBackground(harness.runtime);
    pending.resolve('/proxy/a.mp4');
    await flush();
    assert.equal(harness.applied.length, 1);
    assert.equal(resolution.choices.get('a').chosen, 'auto-proxy');
    assert.equal(resolution.choices.get('a').url, '/proxy/a.mp4');
  }
});

test('failed proxies preserve the failure notice and stale proxy completions are ignored', async () => {
  for (const stale of [false, true]) {
    const pending = deferred();
    const harness = resolverHarness(['a'], {
      chooseSource: () => ({ chosen: 'auto-proxy', reason: 'auto-proxy' }),
      requestAutoProxy: () => pending.promise,
    });
    const resolution = await harness.resolve();
    resolution.startBackground(harness.runtime);
    if (stale) harness.invalidate();
    pending.resolve(null);
    await flush();
    if (stale) {
      assert.deepEqual(harness.applied, []);
      assert.deepEqual(harness.notices, []);
    } else {
      assert.equal(resolution.choices.get('a').reason, 'auto-proxy-failed');
      assert.equal(harness.notices.at(-1), 'プロキシを生成できませんでした（a）');
    }
  }
});

test('source replacement waits for rendering, preserves map identity, and skips equal support', async () => {
  const apply = runInNewContext(`(${stripTypeScriptTypes(
    extract(source, 'async applySourceChoice(', '  ').replace(
      'async applySourceChoice(', 'async function applySourceChoice(',
    ),
  )})`);
  const events = [];
  const original = { id: 'a', url: '/a', chosen: 'original', support: supported };
  const runtime = {
    sourceChoices: new Map([['a', original]]),
    lookahead: new Map([['a', { clear: () => events.push('clear') }]]),
    pools: new Map([['a', { destroy: () => events.push('destroy') }]]),
    sources: new Map([['a', {}]]), images: new Map(),
    waitForRender() { return this.rendering; },
    createVideoSource(id, url) {
      events.push(url);
      this.pools.set(id, {});
      this.lookahead.set(id, {});
      return { url };
    },
    updateMetrics: () => events.push('metrics'),
  };
  const maps = [runtime.pools, runtime.lookahead, runtime.sources];
  await apply.call(runtime, 'a', { ...original, support: { ...supported } });
  assert.deepEqual(events, []);
  const drawing = deferred();
  runtime.rendering = drawing.promise;
  const choice = { ...original, url: '/proxy/a.mp4', support: null };
  const replacing = apply.call(runtime, 'a', choice);
  await flush();
  assert.deepEqual(events, []);
  runtime.rendering = null;
  drawing.resolve();
  await replacing;
  assert.deepEqual(events, ['clear', 'destroy', '/proxy/a.mp4', 'metrics']);
  assert.equal(runtime.sourceChoices.get('a'), choice);
  assert.equal(runtime.sources.get('a').url, '/proxy/a.mp4');
  assert.equal(runtime.pools, maps[0]);
  assert.equal(runtime.lookahead, maps[1]);
  assert.equal(runtime.sources, maps[2]);
  runtime.disposed = true;
  await apply.call(runtime, 'a', original);
  assert.equal(events.length, 4);
});
