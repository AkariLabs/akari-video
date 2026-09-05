import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const compiled = readFileSync(
  path.resolve(import.meta.dirname, '../lib/browser/akari-preview-open-handler.js'),
  'utf8',
);

test('shell frame-engine state and bootstrap include capability-based source selection', () => {
  for (const token of [
    'videoSourceOriginals',
    'frameEngineSourceMode',
    'needsCodecProbe',
    'chooseSource',
    'parseSourceSelectionMode',
    'declared',
    'probeSourceCodec',
    'setForceSoftwareDecode',
    'akariFrameEngineSources',
  ]) {
    assert.match(compiled, new RegExp(token));
  }
  assert.match(compiled, /frame-engine-notice/u);
  assert.match(compiled, /AKARI_FRAME_ENGINE_SOURCE/u);
  assert.match(compiled, /AKARI_FRAME_ENGINE_FORCE_SW/u);
  assert.match(compiled, /cutSourceIds/u);
  assert.match(compiled, /not-a-cut-source/u);
});

function helper(name) {
  const start = compiled.indexOf(`const ${name} = `, compiled.lastIndexOf('frameEngineBootstrapScript()'));
  assert.ok(start >= 0, name);
  if (name === 'sameCodecSupport') return compiled.slice(start, compiled.indexOf(';', start) + 1);
  const end = compiled.indexOf('\n                };', start);
  assert.ok(end > start, name);
  return compiled.slice(start, end + '\n                };'.length);
}

test('source selection waits only for initial targets and keeps scheduler Maps and evidence references', () => {
  assert.match(compiled, /reason: 'pending-probe'/u);
  assert.doesNotMatch(compiled, /await Promise\.all\(probeTargets\.map\(/u);
  assert.match(compiled, /await Promise\.all\(initialTargets\.map\(/u);
  assert.match(helper('prepareSources'), /firstUses\.get\(left\.id\)[\s\S]*firstUses\.get\(right\.id\)/u);
  assert.equal([...helper('startBackgroundSources').matchAll(/void worker\(\)/gu)].length, 2);
  assert.match(helper('applySourceChoice'), /await waitForRender\(\)/u);
  assert.match(helper('applySourceChoice'), /lookahead\.get\(id\)\.clear\(\);\s*pools\.get\(id\)\.destroy\(\)/u);
  assert.match(helper('applySourceChoice'), /sources\.set\(id, createVideoSource\(id, choice\.url\)\)/u);
  assert.doesNotMatch(helper('applySourceChoice'), /new Map/u);
  assert.match(helper('recordSourceSelection'), /sourceSelections\[index\] = selection/u);
  assert.match(helper('applyEngineSummary'), /sourceGeneration \+= 1/u);
  assert.match(helper('applyEngineSummary'), /await prepareSources\(nextTimeline,/u);
  assert.match(helper('applyEngineSummary'), /audioSupply\.seek\(position, false\);\s*scheduler\.primeHeaders\(\);\s*audioSupply\.prime\(\);\s*scheduler\.warmupNextBoundary\(position\)/u);
  assert.match(compiled, /disposed = true;\s*sourceGeneration \+= 1/u);
});

test('initial source requirements use resolved cut placement, active layers and masks, and earliest use', () => {
  const requirements = vm.runInNewContext(`${helper('sourceRequirements')} sourceRequirements;`);
  const timeline = {
    fps: 30,
    cuts: [
      { cut: { src: 'a' }, at: 0, end: 6 },
      { cut: { src: 'b' }, at: 5, end: 10 },
      { cut: { src: 'a' }, at: 12, end: 15 }
    ],
    layers: [
      { src: 'early', mask: 'mask', t: 0, duration: 5 },
      { src: 'late', mask: 'mask', t: 5, duration: 3 },
      { kind: 'filter', src: 'ignored', t: 0, duration: 20 }
    ]
  };
  assert.deepEqual([...requirements(timeline, 0).initialIds], ['a', 'early', 'mask']);
  assert.deepEqual([...requirements(timeline, 5.5).initialIds], ['a', 'b', 'late', 'mask']);
  assert.deepEqual([...requirements(timeline, 6).initialIds], ['b', 'late', 'mask']);
  assert.equal(requirements(timeline, 6).firstUses.get('a'), 0);
  assert.equal(requirements(timeline, 6).firstUses.get('mask'), 0);
  assert.equal(requirements({ ...timeline, cuts: [] }, 6).initialIds.has('late'), true);
  assert.equal(requirements(timeline, 15).initialIds.size, 0);
});

test('background workers cap probes at two and discard the old queue after generation changes', async () => {
  const pending = [];
  const started = [];
  const context = vm.createContext({
    backgroundSources: { generation: 1, started: false, remaining: ['a', 'b', 'c', 'd'] },
    sourceGeneration: 1,
    disposed: false,
    resolveSource: target => new Promise(resolve => { started.push(target); pending.push(resolve); }),
    showError: reason => { throw reason; }
  });
  vm.runInContext(`${helper('startBackgroundSources')} startBackgroundSources();`, context);
  assert.deepEqual(started, ['a', 'b']);
  pending.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['a', 'b', 'c']);
  context.sourceGeneration = 2;
  for (const finish of pending) finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['a', 'b', 'c']);
});

test('first stage probes only the restored frame and rebuild retains completed choices', async () => {
  const probed = [];
  const context = vm.createContext({
    disposed: false, sourceGeneration: 1, backgroundSources: null,
    sourceUrls: new Map([['late', '/late.mp4'], ['now', '/now.mp4'], ['early', '/early.mp4']]),
    declaredSourceUrls: new Map(), sourceOriginals: new Map(), sourceSupports: new Map(),
    sourceSelections: [], images: new Map(), pools: new Map(), sources: new Map(), window: {},
    createVideoSource: (id, url) => { context.pools.set(id, {}); return url; },
    resolveSource: async target => {
      probed.push(target.id);
      context.sourceSelections.find(entry => entry.id === target.id).reason = 'hardware-ok';
    }
  });
  const prepare = vm.runInContext(
    `${helper('sourceRequirements')} ${helper('recordSourceSelection')} ${helper('prepareSources')} prepareSources;`,
    context
  );
  const timeline = { fps: 30, layers: [{ src: 'layer', mask: 'mask', t: 5, duration: 5 }], cuts: [
    { cut: { src: 'early' }, at: 0, end: 5 },
    { cut: { src: 'now' }, at: 5, end: 10 },
    { cut: { src: 'late' }, at: 10, end: 15 }
  ] };
  await prepare(timeline, 6, 1);
  assert.deepEqual(probed, ['now', 'layer', 'mask']);
  assert.deepEqual(Array.from(context.backgroundSources.remaining, target => target.id), ['early', 'late']);
  assert.equal(context.sourceSelections.find(entry => entry.id === 'late').reason, 'pending-probe');
  assert.equal(context.sourceSupports.has('late'), false);
  assert.equal(context.sources.get('late'), '/late.mp4');
  context.sourceGeneration = 2;
  await prepare(timeline, 12, 2);
  assert.deepEqual(probed, ['now', 'layer', 'mask', 'late']);
  assert.deepEqual(Array.from(context.backgroundSources.remaining, target => target.id), ['early']);
});

test('auto-proxy requests never block source resolution and stale probes cannot publish choices', async () => {
  const events = [];
  let finishProbe;
  const context = vm.createContext({
    disposed: false, sourceGeneration: 1, mode: 'auto', sourceSelections: [],
    initial: { videoSourceUris: { a: 'asset:a' } },
    engine: {
      needsCodecProbe: () => true,
      probeSourceCodec: () => new Promise(resolve => { finishProbe = resolve; }),
      chooseSource: () => ({ chosen: 'auto-proxy', reason: 'auto-proxy' })
    },
    window: { akari: { engine: { resolveHevcFallback: () => {
      events.push('proxy requested');
      return new Promise(() => {});
    } } } },
    applySourceChoice: async (id, choice) => events.push(choice),
    showNotice: message => events.push(message), clearNotice() {}, console
  });
  const resolve = vm.runInContext(`${helper('resolveSource')} resolveSource;`, context);
  const target = { id: 'a', originalUrl: '/a.mp4', hasProxy: false, cutSource: true };
  const pending = resolve(target, 1);
  finishProbe({ support: { hw: false, any: false }, info: { codec: 'hevc' } });
  await pending;
  assert.equal(events[0].url, '/a.mp4');
  assert.equal(events[0].selection.chosen, 'auto-proxy');
  assert.match(events[1], /プロキシ生成中/u);
  assert.equal(events[2], 'proxy requested');
  const stale = resolve(target, 1);
  context.sourceGeneration = 2;
  finishProbe({ support: {} });
  await stale;
  assert.equal(events.length, 3);
});

test('source replacement waits for rendering, preserves Maps, and keeps equal learned support alive', async () => {
  const support = { codec: 'avc1', hw: true, sw: true, any: true };
  const events = [];
  let finish;
  const context = vm.createContext({
    disposed: false, sourceGeneration: 1,
    pools: new Map([['a', { codecSupport: () => support, destroy: () => events.push('destroy') }]]),
    lookahead: new Map([['a', { clear: () => events.push('clear') }]]),
    sources: new Map([['a', 'old']]), sourceUrls: new Map([['a', '/a.mp4']]),
    sourceSupports: new Map(),
    recordSourceSelection: selection => events.push(selection.reason),
    createVideoSource: (id, url) => { events.push(url); return 'new'; },
    rendering: null,
    waitForRender: () => new Promise(resolve => { finish = () => { context.rendering = null; resolve(); }; })
  });
  const apply = vm.runInContext(`${helper('sameCodecSupport')} ${helper('applySourceChoice')} applySourceChoice;`, context);
  const maps = [context.pools, context.lookahead, context.sources];
  await apply('a', { url: '/a.mp4', support: { ...support }, selection: { reason: 'hardware' } }, 1);
  assert.deepEqual(events, ['hardware']);
  assert.equal(context.sourceSupports.get('a').hw, true);
  context.rendering = true;
  const pending = apply('a', { url: '/proxy.mp4', support: null, selection: { reason: 'proxy' } }, 1);
  assert.deepEqual(events, ['hardware']);
  finish();
  await pending;
  assert.deepEqual(events, ['hardware', 'clear', 'destroy', 'proxy', '/proxy.mp4']);
  assert.equal(context.pools, maps[0]);
  assert.equal(context.lookahead, maps[1]);
  assert.equal(context.sources, maps[2]);
  assert.equal(context.sources.get('a'), 'new');
  const count = events.length;
  await apply('a', {}, 0);
  context.disposed = true;
  await apply('a', {}, 1);
  assert.equal(events.length, count);
});
