import assert from 'node:assert/strict';
import test from 'node:test';
import * as audio from '../dist/index.js';
import { metadata, rangeServer } from './pcm-window-fixture.mjs';
const { createPreviewAudioSupply, createPreviewAudioSharedCache } = audio;

class Param {
  value = 1;
  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
}
class Source {
  playbackRate = new Param();
  connect() {}
  disconnect() {}
  start() {}
  stop() {}
}
class Context {
  currentTime = 0;
  state = 'suspended';
  destination = {};
  decodeCalls = 0;
  createGain() { return { gain: new Param(), connect() {}, disconnect() {} }; }
  createAnalyser() { return { connect() {}, disconnect() {} }; }
  createBufferSource() { return new Source(); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
      getChannelData: index => data[index] };
  }
  async decodeAudioData() { this.decodeCalls++; return { duration: 20, length: 20, numberOfChannels: 1 }; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}
const tick = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const item = (id, url, t, durationSec = 10, extra = {}) => ({
  kind: 'bgm', id, url, spec: { id, t, durationSec, ...extra },
});

test('BGM gate and required follow each clip interval, including a later clip and an ended clip', async t => {
  const context = new Context();
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 200, contextFactory: () => context,
    declarations: [item('early', '/early.mp3', 0),
      item('late', '/late.mp3', 100, 0, { duration: 20, in: 40 })],
    fetchImpl: async () => ({ ok: true, headers: { get: () => '1' }, arrayBuffer: async () => Uint8Array.of(1).buffer }),
  });
  t.after(() => supply.dispose());
  assert.deepEqual(supply.debug().supply.required, ['bgm:early']);
  supply.playFrom(40);
  await tick();
  assert.equal(supply.debug().supply.gate.holding, false);
  assert.deepEqual(supply.debug().supply.required, []);
  supply.pause();
  supply.seek(100, false);
  assert.deepEqual(supply.debug().supply.required, ['bgm:late']);
  supply.seek(125, false);
  assert.deepEqual(supply.debug().supply.required, []);
});

test('page cache survives supply replacement and counts bytes once; distinct version URLs decode separately', async t => {
  const cache = createPreviewAudioSharedCache();
  t.after(() => cache.dispose());
  const fetches = [];
  const fetchImpl = async url => {
    fetches.push(url);
    return { ok: true, headers: { get: () => '1' }, arrayBuffer: async () => Uint8Array.of(1).buffer };
  };
  const make = (url, context) => createPreviewAudioSupply({
    sharedCache: cache, timelineDurationSec: 20, contextFactory: () => context,
    declarations: [item('bed', url, 0)], fetchImpl, decodeCacheBytes: 10,
    onWarning() {},
  });
  const firstContext = new Context();
  const first = make('/sidecar/key-v1.flac', firstContext);
  first.prime();
  await tick();
  assert.deepEqual(fetches, ['/sidecar/key-v1.flac']);
  assert.equal(first.debug().prefetch.overBudget, true);
  const secondContext = new Context();
  const second = make('/sidecar/key-v1.flac', secondContext);
  t.after(() => second.dispose());
  second.prime();
  await tick();
  first.dispose();
  second.playFrom(0);
  await tick();
  assert.deepEqual(fetches, ['/sidecar/key-v1.flac']);
  assert.equal(secondContext.decodeCalls, 0);
  assert.equal(second.debug().playing, true);
  assert.equal(second.debug().prefetch.decodedBytes, 80);
  const third = make('/sidecar/key-v2.flac', new Context());
  t.after(() => third.dispose());
  third.prime();
  await tick();
  assert.deepEqual(fetches, ['/sidecar/key-v1.flac', '/sidecar/key-v2.flac']);
});

test('queued sidecar uses available original audio immediately', async t => {
  const context = new Context();
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 20, contextFactory: () => context,
    declarations: [{ ...item('bed', '/original.mp3', 0, 10, { sidecarState: 'generating' }),
      sourceUrl: '/original.mp3', fallbackWhileGenerating: true }],
    fetchImpl: async () => ({ ok: true, headers: { get: () => '1' }, arrayBuffer: async () => Uint8Array.of(1).buffer }),
  });
  t.after(() => supply.dispose());
  supply.playFrom(0);
  await tick();
  assert.equal(context.decodeCalls, 1);
  assert.equal(supply.debug().supply.gate.holding, false);
});

test('PCM window LRU survives supply replacement in the same page', async t => {
  const cache = createPreviewAudioSharedCache();
  t.after(() => cache.dispose());
  const server = rangeServer({ durationSec: 20, requireRange: true });
  const meta = metadata(20, '/versioned-key.pcm');
  const declaration = item('bed', meta.url, 0, 20, {
    sidecarState: 'ready', sidecar: { ...meta, path: meta.url, format: 'pcm-s16le',
      padBeforeSec: 0, padAfterSec: 0 },
  });
  const make = () => createPreviewAudioSupply({ sharedCache: cache, timelineDurationSec: 20,
    declarations: [declaration], contextFactory: () => new Context(), fetchImpl: server.fetchImpl });
  const first = make();
  first.playFrom(0);
  await tick();
  assert.ok(server.requests.length > 0);
  const fetched = server.requests.length;
  const second = make();
  t.after(() => second.dispose());
  second.playFrom(0);
  await tick();
  first.dispose();
  assert.equal(server.requests.length, fetched);
  assert.ok(second.debug().prefetch.windows.cacheBytes > 0);
  const nextMeta = metadata(20, '/next-key.pcm');
  const third = createPreviewAudioSupply({ sharedCache: cache, timelineDurationSec: 20,
    declarations: [item('bed', nextMeta.url, 0, 20, { sidecarState: 'ready',
      sidecar: { ...nextMeta, path: nextMeta.url, format: 'pcm-s16le', padBeforeSec: 0, padAfterSec: 0 } })],
    contextFactory: () => new Context(), fetchImpl: server.fetchImpl });
  assert.equal(cache.windowSources.size, 2, 'new PCM metadata resolves on supply creation');
  third.prime();
  await tick();
  assert.equal(cache.windowSources.size, 2);
  second.dispose();
  assert.equal(cache.windowSources.size, 1);
  third.dispose();
  assert.equal(cache.windowSources.size, 0);
});

test('rebuild retains unchanged buffers and releases obsolete versions with accurate bytes', async t => {
  const cache = createPreviewAudioSharedCache();
  t.after(() => cache.dispose());
  const fetches = [];
  const fetchImpl = async url => {
    fetches.push(url);
    return { ok: true, headers: { get: () => '1' }, arrayBuffer: async () => Uint8Array.of(1).buffer };
  };
  const make = declarations => createPreviewAudioSupply({ sharedCache: cache,
    timelineDurationSec: 30, declarations, contextFactory: () => new Context(), fetchImpl });
  const stable = item('stable', '/stable.flac', 0);
  const first = make([stable, item('edited', '/old-version.flac', 0)]);
  first.prime();
  await tick();
  assert.equal(cache.decodedBytes, 160);
  const second = make([stable, item('edited', '/new-version.flac', 0)]);
  second.prime();
  await tick();
  assert.equal(cache.decodedBytes, 240);
  first.dispose();
  assert.equal(cache.decodedBytes, 160);
  assert.equal(cache.decoded.has('audio:/old-version.flac'), false);
  assert.deepEqual(fetches, ['/stable.flac', '/old-version.flac', '/new-version.flac']);
  second.dispose();
  assert.equal(cache.decodedBytes, 0);
  assert.equal(cache.decoded.size, 0);
  cache.dispose();
  assert.equal(cache.windowSources.size, 0);
});

test('updateAudio releases replaced buffer and a late decode cannot rejoin shared cache', async t => {
  const cache = createPreviewAudioSharedCache();
  t.after(() => cache.dispose());
  let finishOld;
  const fetches = [];
  const fetchImpl = async url => {
    fetches.push(url);
    if (url === '/old.flac') await new Promise(resolve => { finishOld = resolve; });
    return { ok: true, headers: { get: () => '1' }, arrayBuffer: async () => Uint8Array.of(1).buffer };
  };
  const supply = createPreviewAudioSupply({ sharedCache: cache, timelineDurationSec: 20,
    declarations: [item('bed', '/old.flac', 0)], contextFactory: () => new Context(), fetchImpl });
  t.after(() => supply.dispose());
  supply.prime();
  await tick();
  assert.equal(typeof finishOld, 'function');
  supply.updateAudio({ declarations: [item('bed', '/new.flac', 0)] });
  assert.equal(cache.decoded.has('audio:/old.flac'), false);
  finishOld();
  await tick();
  assert.deepEqual(fetches, ['/old.flac', '/new.flac']);
  assert.equal(cache.decoded.has('audio:/old.flac'), false);
  assert.equal(cache.decodedBytes, 80);
  supply.dispose();
  assert.equal(cache.decodedBytes, 0);
});

test('playing update keeps old material until the replacement plan, then releases it', async t => {
  const cache = createPreviewAudioSharedCache();
  t.after(() => cache.dispose());
  const supply = createPreviewAudioSupply({ sharedCache: cache, timelineDurationSec: 20,
    declarations: [item('bed', '/old-playing.flac', 0)], contextFactory: () => new Context(),
    fetchImpl: async () => ({ ok: true, headers: { get: () => '1' },
      arrayBuffer: async () => Uint8Array.of(1).buffer }) });
  t.after(() => supply.dispose());
  supply.playFrom(0);
  await tick();
  assert.equal(supply.debug().playing, true);
  supply.updateAudio({ declarations: [item('bed', '/new-playing.flac', 0)] });
  assert.equal(cache.decoded.has('audio:/old-playing.flac'), true, 'active material is retained during replan');
  await tick();
  assert.equal(cache.decoded.has('audio:/old-playing.flac'), false);
  assert.equal(cache.decodedBytes, 80);
});

test('in-flight decode remains shared when a new supply takes the key before old disposal', async t => {
  const cache = createPreviewAudioSharedCache();
  t.after(() => cache.dispose());
  let finish;
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount++;
    await new Promise(resolve => { finish = resolve; });
    return { ok: true, headers: { get: () => '1' }, arrayBuffer: async () => Uint8Array.of(1).buffer };
  };
  const make = () => createPreviewAudioSupply({ sharedCache: cache, timelineDurationSec: 20,
    declarations: [item('bed', '/shared-pending.flac', 0)], contextFactory: () => new Context(), fetchImpl });
  const oldSupply = make();
  oldSupply.prime();
  await tick();
  const newSupply = make();
  t.after(() => newSupply.dispose());
  newSupply.prime();
  oldSupply.dispose();
  finish();
  await tick();
  assert.equal(fetchCount, 1);
  assert.equal(cache.decodedBytes, 80);
  assert.equal(cache.decodedRefs.get('audio:/shared-pending.flac'), 1);
});
