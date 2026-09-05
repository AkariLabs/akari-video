import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreviewAudioSupply } from '../dist/index.js';

class FakeParam {
  value = 1;
  calls = [];
  cancelScheduledValues() {}
  setValueAtTime(value, at) { this.value = value; this.calls.push(['set', value, at]); }
  linearRampToValueAtTime(value, at) { this.value = value; this.calls.push(['linear', value, at]); }
  exponentialRampToValueAtTime(value, at) {
    this.value = value;
    this.calls.push(['exponential', value, at]);
  }
}

class FakeSource {
  playbackRate = new FakeParam();
  loop = false;
  buffer = null;
  onended = null;
  starts = [];
  connect() {}
  disconnect() {}
  stop() {}
  start(...args) { this.starts.push(args); }
}

class FakeGain {
  gain = new FakeParam();
  connections = [];
  disconnectCalls = 0;
  connect(target) { this.connections.push(target); }
  disconnect() { this.disconnectCalls += 1; this.connections = []; }
}

class FakeAnalyser {
  connections = [];
  connect(target) { this.connections.push(target); }
  disconnect() { this.connections = []; }
}

class FakeAudioWorkletNode {
  parameters = new Map([['ratio', new FakeParam()]]);
  connections = [];
  disconnectCalls = 0;
  constructor(context, name, options) {
    this.context = context;
    this.name = name;
    this.parameters.get('ratio').value = options?.parameterData?.ratio ?? 1;
    context.workletNodes.push(this);
  }
  connect(target) { this.connections.push(target); }
  disconnect() { this.disconnectCalls += 1; this.connections = []; }
}

class FakeBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(index) { return this.channels[index]; }
}

class FakeContext {
  currentTime = 0;
  state = 'suspended';
  destination = {};
  sources = [];
  gains = [];
  analysers = [];
  workletNodes = [];
  decodeCalls = 0;
  constructor(buffers) { this.buffers = buffers; }
  async decodeAudioData(data) {
    this.decodeCalls += 1;
    const key = new Uint8Array(data)[0];
    const value = this.buffers.get(key);
    if (value instanceof Error) throw value;
    return value;
  }
  createBuffer(numberOfChannels, length, sampleRate) {
    return new FakeBuffer(numberOfChannels, length, sampleRate);
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createAnalyser() { const analyser = new FakeAnalyser(); this.analysers.push(analyser); return analyser; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}

class FakeOfflineContext {
  decodeCalls = 0;
  constructor(sampleRate, produce) { this.sampleRate = sampleRate; this.produce = produce; }
  async decodeAudioData(data) {
    this.decodeCalls += 1;
    return this.produce(this.sampleRate, data);
  }
}

/** 16bit PCM の RIFF/WAVE ヘッダ + 無音 data。長さの見積もりだけに使う。 */
function wavBytes({ sampleRate = 48000, channels = 2, frames = 150, bits = 16 } = {}) {
  const blockAlign = channels * bits / 8;
  const dataBytes = frames * blockAlign;
  const bytes = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(bytes);
  const ascii = (offset, text) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true); view.setUint16(34, bits, true);
  ascii(36, 'data'); view.setUint32(40, dataBytes, true);
  return bytes;
}

const buffer = (duration, length = 10, numberOfChannels = 2) => ({
  duration, length, numberOfChannels,
});

function response(key) {
  return {
    ok: true,
    headers: { get: name => name.toLowerCase() === 'content-length' ? '1' : null },
    arrayBuffer: async () => Uint8Array.of(key).buffer,
  };
}

async function settle() {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
}

function speech(id, src, url, overrides = {}) {
  return {
    id, src, url, atSec: 0, durationSec: 1, inSec: 0, outSec: 1,
    speed: 1, materialDurationSec: 1, ...overrides,
  };
}

function scheduleBuilder({ timelineDurationSec, startAtSec, audio = {} }) {
  const items = [];
  const append = (kind, id, atSec, durationSec, sourceOffsetSec, playbackRate = 1) => {
    const elapsed = Math.max(0, startAtSec - atSec);
    const delaySec = Math.max(0, atSec - startAtSec);
    const available = Math.min(durationSec - elapsed,
      timelineDurationSec - startAtSec - delaySec);
    if (!(available > 0)) return;
    items.push({
      kind, id, track: 0, timelineStartSec: startAtSec + delaySec,
      timelineEndSec: startAtSec + delaySec + available, delaySec,
      sourceOffsetSec: sourceOffsetSec + elapsed * playbackRate,
      durationSec: available, playbackRate, sourceDurationSec: available * playbackRate,
      loop: kind === 'bgm', gainDb: 0,
      gainEvents: [{ offsetSec: 0, value: 1, method: 'set' }], envelopeEvents: [],
    });
  };
  if (audio.bgm) append('bgm', audio.bgm.id ?? 'bgm', 0, timelineDurationSec, 0);
  for (const item of audio.speech ?? []) {
    append('speech', item.id, item.atSec, item.durationSec,
      item.atempo ? 0 : item.inSec, item.atempo ? 1 : item.speed);
  }
  return { startAtSec, items, warnings: [] };
}

test('同一ソースの複数 cut は一度だけ decode し、cut ごとの速度と素材尺で start する', async () => {
  const context = new FakeContext(new Map([[1, buffer(4, 100, 2)]]));
  const fetches = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 3,
    scheduleBuilder,
    contextFactory: () => context,
    fetchImpl: async url => { fetches.push(url); return response(1); },
    speech: [
      speech('a-1', 'source-a', '/a.mp4', { durationSec: 1, outSec: 1 }),
      speech('a-2', 'source-a', '/a.mp4', {
        atSec: 1, durationSec: 1, inSec: 1, outSec: 2.15, speed: 1.15,
      }),
    ],
  });

  supply.playFrom(0);
  await settle();
  assert.deepEqual(fetches, ['/a.mp4']);
  assert.equal(context.decodeCalls, 1);
  assert.equal(context.sources.length, 2);
  assert.deepEqual(context.sources.map(source => source.playbackRate.value), [1, 1.15]);
  assert.deepEqual(context.sources.map(source => source.starts[0].slice(1)), [[0, 1], [1, 1.15]]);
  assert.equal(supply.debug().scheduled.speech, 2);
  supply.dispose();
});

test('atempo WAV は元ソースと別に decode し playbackRate 1・offset 0 で鳴らす', async () => {
  const context = new FakeContext(new Map([[1, buffer(4)], [2, buffer(1)]]));
  const fetches = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 1,
    scheduleBuilder,
    contextFactory: () => context,
    fetchImpl: async url => {
      fetches.push(url);
      return response(url === '/fast.wav' ? 2 : 1);
    },
    speech: [speech('fast', 'source-a', '/source.mp4', {
      speed: 1.2,
      atempo: { path: '/fast.wav', durationSec: 1, generatedMs: 12.5 },
    })],
  });

  supply.playFrom(0);
  await settle();
  assert.deepEqual(fetches, ['/fast.wav']);
  assert.equal(context.sources[0].playbackRate.value, 1);
  assert.deepEqual(context.sources[0].starts[0].slice(1), [0, 1]);
  assert.deepEqual(supply.debug().speech.atempo, { items: 1, generatedMs: 12.5 });
  supply.dispose();
});

test('atempo decode 失敗は警告一行で元ソースの playbackRate 経路へ退避する', async () => {
  const context = new FakeContext(new Map([[1, buffer(4)], [2, new Error('bad wav')]]));
  const warnings = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 1,
    scheduleBuilder,
    contextFactory: () => context,
    fetchImpl: async url => response(url === '/fast.wav' ? 2 : 1),
    onWarning: message => warnings.push(message),
    speech: [speech('fast', 'source-a', '/source.mp4', {
      speed: 1.2,
      outSec: 1.2,
      atempo: { path: '/fast.wav', durationSec: 1 },
    })],
  });

  supply.playFrom(0);
  await settle();
  assert.equal(warnings.filter(message => /speech sidecar fast unavailable/u.test(message)).length, 1);
  assert.equal(context.sources[0].playbackRate.value, 1.2);
  assert.deepEqual(supply.debug().speech.atempo, { items: 0, generatedMs: 0 });
  supply.dispose();
});

test('byte 予算を越えても buffer は捨てず、警告 1 行で全 item を鳴らし、次の再生で再 decode しない', async () => {
  const context = new FakeContext(new Map([
    [1, buffer(2, 10, 2)],
    [2, buffer(2, 10, 2)],
  ]));
  const counts = new Map();
  const warnings = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 2,
    scheduleBuilder,
    contextFactory: () => context,
    decodeCacheBytes: 100,
    onWarning: message => warnings.push(message),
    fetchImpl: async url => {
      counts.set(url, (counts.get(url) ?? 0) + 1);
      return response(url === '/a.mp4' ? 1 : 2);
    },
    speech: [
      speech('a', 'source-a', '/a.mp4'),
      speech('b', 'source-b', '/b.mp4', { atSec: 1 }),
    ],
  });
  supply.playFrom(0);
  await settle();
  // 80 + 80 = 160 bytes > 予算 100 でも両方鳴る（以前は後で使う方が黙って予定表から消えていた）
  assert.equal(context.sources.length, 2);
  assert.equal(supply.debug().prefetch.decodedBytes, 160);
  assert.equal(supply.debug().prefetch.overBudget, true);
  assert.equal(supply.debug().scheduled.skipped.length, 0);
  assert.equal(warnings.filter(message => /keeping every buffer/u.test(message)).length, 1);

  supply.pause();
  supply.playFrom(0);
  await settle();
  assert.equal([...counts.values()].reduce((sum, value) => sum + value, 0), 2, '再生ごとの再 fetch が無い');
  assert.equal(context.decodeCalls, 2, '再生ごとの再 decode が無い');
  assert.equal(context.sources.length, 4);
  supply.dispose();
});

test('展開後の見積もりが閾値を超える WAV は OfflineAudioContext で低レート・モノに落として保持する', async () => {
  const context = new FakeContext(new Map());
  const offlineContexts = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 2,
    scheduleBuilder,
    contextFactory: () => context,
    compactDecodeThresholdBytes: 1000,
    compactSampleRate: 24000,
    offlineContextFactory: sampleRate => {
      const offline = new FakeOfflineContext(sampleRate, rate => {
        const decoded = new FakeBuffer(2, 75, rate);
        decoded.channels[0].fill(0.5);
        decoded.channels[1].fill(-0.25);
        return decoded;
      });
      offlineContexts.push(offline);
      return offline;
    },
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      // 48 kHz ステレオ 150 frames → 1,200 bytes の見積もり > 閾値 1,000
      arrayBuffer: async () => wavBytes({ frames: 150 }),
    }),
    declarations: [{ kind: 'bgm', id: 'bgm', url: '/bgm.wav', spec: { path: 'bgm.wav' } }],
  });
  supply.playFrom(0);
  await settle();

  assert.equal(context.decodeCalls, 0, '等倍 decode は走らない');
  assert.equal(offlineContexts.length, 1);
  assert.equal(offlineContexts[0].sampleRate, 24000);
  const source = context.sources[0];
  assert.ok(source, 'bgm が予定される');
  assert.equal(source.buffer.numberOfChannels, 1);
  assert.equal(source.buffer.sampleRate, 24000);
  assert.ok(Math.abs(source.buffer.getChannelData(0)[0] - 0.125) < 1e-6, 'L/R の平均でモノ化');
  const debug = supply.debug();
  assert.equal(debug.prefetch.compact, 1);
  assert.equal(debug.prefetch.decodedBytes, 75 * 4);
  supply.dispose();
});

test('閾値未満の WAV は従来どおり context で等倍 decode する', async () => {
  const context = new FakeContext(new Map([[0x52, buffer(1, 10, 2)]]));
  let offlineCalls = 0;
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 2,
    scheduleBuilder,
    contextFactory: () => context,
    compactDecodeThresholdBytes: 1000,
    offlineContextFactory: () => { offlineCalls += 1; return null; },
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      // 100 frames → 800 bytes < 1,000
      arrayBuffer: async () => wavBytes({ frames: 100 }),
    }),
    declarations: [{ kind: 'bgm', id: 'bgm', url: '/bgm.wav', spec: { path: 'bgm.wav' } }],
  });
  supply.playFrom(0);
  await settle();
  assert.equal(offlineCalls, 0);
  assert.equal(context.decodeCalls, 1);
  assert.equal(supply.debug().prefetch.compact, 0);
  assert.equal(context.sources.length, 1);
  supply.dispose();
});

test('startFrom の例外は警告に落ち、starting が残らず次の playFrom で鳴る', async () => {
  const context = new FakeContext(new Map([[1, buffer(2, 10, 2)]]));
  let failOnce = true;
  const warnings = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 2,
    contextFactory: () => context,
    onWarning: message => warnings.push(message),
    scheduleBuilder: input => {
      if (failOnce) { failOnce = false; throw new Error('boom'); }
      return scheduleBuilder(input);
    },
    fetchImpl: async () => response(1),
    speech: [speech('a', 'source-a', '/a.mp4')],
  });
  supply.playFrom(0);
  await settle();
  assert.equal(supply.debug().playing, false);
  assert.ok(warnings.some(message => /audio start failed/u.test(message)));

  supply.playFrom(0);
  await settle();
  assert.equal(supply.debug().playing, true);
  assert.equal(context.sources.length, 1);
  supply.dispose();
});

test('playbackTime は空の予定表の直後は 500 ms 空けて再試行し、seek 後は即再開する', async () => {
  let clock = 0;
  let builds = 0;
  const context = new FakeContext(new Map([[1, buffer(1, 10, 2)]]));
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 10,
    contextFactory: () => context,
    nowImpl: () => clock,
    scheduleBuilder: input => {
      builds += 1;
      return input.startAtSec >= 5
        ? { startAtSec: input.startAtSec, items: [], warnings: [] }
        : scheduleBuilder(input);
    },
    fetchImpl: async () => response(1),
    speech: [speech('a', 'source-a', '/a.mp4')],
  });
  supply.playbackTime(6);
  await settle();
  assert.equal(builds, 1);
  assert.equal(supply.debug().playing, false);

  supply.playbackTime(6.1);
  await settle();
  assert.equal(builds, 1, '500 ms 以内は予定表を組み直さない');

  clock = 600;
  supply.playbackTime(6.2);
  await settle();
  assert.equal(builds, 2, '500 ms 空けば再試行する');

  supply.seek(0, false);
  supply.playbackTime(0);
  await settle();
  assert.equal(supply.debug().playing, true, 'seek 後は backoff を待たずに鳴る');
  supply.dispose();
});

test('decode 失敗は prefetch.failed に出て、5 秒空けた次の再生で再試行する', async () => {
  let clock = 0;
  let attempts = 0;
  const context = new FakeContext(new Map([[1, buffer(1, 10, 2)]]));
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 2,
    scheduleBuilder,
    contextFactory: () => context,
    nowImpl: () => clock,
    onWarning: () => {},
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? { ok: false, status: 404, headers: { get: () => null } }
        : response(1);
    },
    speech: [speech('a', 'source-a', '/a.mp4')],
  });
  supply.playFrom(0);
  await settle();
  assert.deepEqual(supply.debug().prefetch.failed, ['speech:a']);
  assert.equal(supply.debug().playing, false);

  supply.playFrom(0);
  await settle();
  assert.equal(attempts, 1, '5 秒以内は 404 を叩き直さない');

  clock = 5000;
  supply.playFrom(0);
  await settle();
  assert.equal(attempts, 2);
  assert.deepEqual(supply.debug().prefetch.failed, []);
  assert.equal(supply.debug().playing, true);
  supply.dispose();
});

test('音声なしソースは警告一行で全 cut を飛ばし、他ソースと BGM は継続する', async () => {
  const context = new FakeContext(new Map([
    [1, new Error('no audio track')],
    [2, buffer(2)],
    [3, buffer(2)],
  ]));
  const warnings = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 2,
    scheduleBuilder,
    contextFactory: () => context,
    fetchImpl: async url => response(url === '/silent.mp4' ? 1 : url === '/good.mp4' ? 2 : 3),
    onWarning: message => warnings.push(message),
    declarations: [{
      kind: 'bgm', id: 'bed', url: '/bgm.wav', spec: { id: 'bed', durationSec: 0 },
    }],
    speech: [
      speech('silent-1', 'silent', '/silent.mp4'),
      speech('silent-2', 'silent', '/silent.mp4', { atSec: 1 }),
      speech('good', 'good', '/good.mp4'),
    ],
  });
  supply.playFrom(0);
  await settle();
  supply.pause();
  supply.playFrom(0);
  await settle();

  const unavailable = warnings.filter(message => /speech silent unavailable/u.test(message));
  assert.equal(unavailable.length, 1);
  const debug = supply.debug();
  assert.equal(debug.scheduled.bgm, 1);
  assert.equal(debug.scheduled.speech, 1);
  assert.equal(debug.speechDecode.sources, 2);
  assert.equal(debug.speechDecode.okSources, 1);
  assert.equal(debug.speechDecode.skippedSources, 1);
  assert.ok(debug.speechDecode.totalMs >= 0);
  assert.deepEqual(debug.speechDecode.perSource.map(item => item.ok), [false, true]);
  supply.dispose();
});

test('debug は描画時に二時計を同時採取し speech decode の形を保つ', async () => {
  const context = new FakeContext(new Map([[1, buffer(2, 12, 2)]]));
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 2,
    scheduleBuilder,
    contextFactory: () => context,
    fetchImpl: async () => response(1),
    speech: [speech('a', 'source-a', '/a.mp4')],
  });
  supply.playFrom(0);
  await settle();
  context.currentTime = 0.52;
  supply.noteRendered(0.5);
  const debug = supply.debug();
  assert.ok(Number.isFinite(debug.driftMs));
  assert.deepEqual(Object.keys(debug.speechDecode), [
    'sources', 'okSources', 'skippedSources', 'totalMs', 'bytes', 'perSource',
  ]);
  assert.equal(debug.speechDecode.bytes, 96);
  assert.deepEqual(Object.keys(debug.speechDecode.perSource[0]), [
    'src', 'ms', 'durationSec', 'bytes', 'ok',
  ]);
  assert.deepEqual(debug.speech.atempo, { items: 0, generatedMs: 0 });
  supply.dispose();
});

test('prime は ready を待たせず全 item を同時 2 本以下で先読みし sidecar 集計を返す', async () => {
  const context = new FakeContext(new Map([[1, buffer(1)], [2, buffer(1)], [3, buffer(1)]]));
  let active = 0;
  let maxActive = 0;
  const resolvers = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 3,
    scheduleBuilder,
    contextFactory: () => context,
    fetchImpl: async url => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => resolvers.push(resolve));
      active -= 1;
      return response(url.endsWith('1.flac') ? 1 : url.endsWith('2.flac') ? 2 : 3);
    },
    speech: [0, 1, 2].map(index => speech(`s-${index}`, `source-${index}`, `/source-${index}.mp4`, {
      atSec: index,
      sidecar: {
        path: `/s-${index + 1}.flac`, durationSec: 1,
        padBeforeSec: 0, padAfterSec: 0, skipped: index > 0, bytes: 100 + index,
      },
    })),
  });
  supply.prime();
  await settle();
  assert.equal(supply.debug().prefetch.pending, 3);
  assert.equal(maxActive, 2);
  while (resolvers.length) resolvers.shift()();
  await settle();
  while (resolvers.length) resolvers.shift()();
  await settle();
  const debug = supply.debug();
  assert.equal(debug.prefetch.pending, 0);
  assert.equal(debug.prefetch.items, 3);
  assert.deepEqual(debug.sidecars, { generated: 1, skipped: 2, bytes: 303 });
  supply.dispose();
});

test('sidecar 失敗時も 64 MB 以上の speech source 全体は arrayBuffer 化しない', async () => {
  const context = new FakeContext(new Map([[1, new Error('bad flac')]]));
  const warnings = [];
  let sourceArrayBufferCalls = 0;
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 1,
    scheduleBuilder,
    contextFactory: () => context,
    onWarning: message => warnings.push(message),
    fetchImpl: async url => url.endsWith('.flac') ? response(1) : ({
      ok: true,
      headers: { get: name => name.toLowerCase() === 'content-length' ? String(70 * 1024 * 1024) : null },
      arrayBuffer: async () => { sourceArrayBufferCalls += 1; return Uint8Array.of(2).buffer; },
    }),
    speech: [speech('large', 'hevc', '/large.mp4', {
      sidecar: { path: '/large.flac', durationSec: 1, padBeforeSec: 0, padAfterSec: 0 },
    })],
  });
  supply.playFrom(0);
  await settle();
  assert.equal(sourceArrayBufferCalls, 0);
  assert.equal(supply.debug().speechDecode.skippedSources, 1);
  assert.equal(supply.debug().scheduled.speech, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /speech sidecar large unavailable/u);
  supply.dispose();
});

test('SFX も item 内の第 2 GainNode で exponential envelopeEvents を適用する', async () => {
  const context = new FakeContext(new Map([[1, buffer(1)]]));
  const envelopeEvents = [
    { offsetSec: 0, value: 1, method: 'set' },
    { offsetSec: 0.5, value: 0.25, method: 'exponential' },
  ];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 1,
    scheduleBuilder: () => ({
      startAtSec: 0,
      warnings: [],
      items: [{
        kind: 'sfx', id: 'hit', track: 0,
        timelineStartSec: 0, timelineEndSec: 1, delaySec: 0,
        sourceOffsetSec: 0, durationSec: 1, playbackRate: 1,
        sourceDurationSec: 1, loop: false, gainDb: 0,
        gainEvents: [{ offsetSec: 0, value: 1, method: 'set' }],
        envelopeEvents,
      }],
    }),
    contextFactory: () => context,
    fetchImpl: async () => response(1),
    declarations: [{
      kind: 'sfx', id: 'hit', url: '/hit.wav',
      spec: { id: 'hit', t: 0, durationSec: 1 },
    }],
  });
  supply.playFrom(0);
  await settle();

  assert.equal(context.gains.length, 3, 'master + base + envelope');
  assert.deepEqual(context.gains[2].gain.calls.map(call => call.slice(0, 2)), [
    ['set', 1],
    ['exponential', 0.25],
  ]);
  assert.equal(context.gains[2].gain.calls[1][2] - context.gains[2].gain.calls[0][2], 0.5);
  supply.dispose();
});

test('s1 setRate(2) は source・開始遅延・gain イベントを 2 倍速で予定する', async () => {
  const context = new FakeContext(new Map([[1, buffer(4)]]));
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 4,
    contextFactory: () => context,
    fetchImpl: async () => response(1),
    declarations: [{ kind: 'sfx', id: 'hit', url: '/hit.wav', spec: { id: 'hit', t: 2 } }],
    scheduleBuilder: () => ({
      startAtSec: 0,
      warnings: [],
      items: [{
        kind: 'sfx', id: 'hit', track: 0,
        timelineStartSec: 2, timelineEndSec: 3, delaySec: 2,
        sourceOffsetSec: 0, durationSec: 1, playbackRate: 1.5,
        sourceDurationSec: 1.5, loop: false, gainDb: 0,
        gainEvents: [
          { offsetSec: 0, value: 0, method: 'set' },
          { offsetSec: 0.5, value: 1, method: 'linear' },
        ],
        envelopeEvents: [],
      }],
    }),
  });

  supply.setRate(2);
  supply.playFrom(0);
  await settle();

  assert.equal(context.sources[0].playbackRate.value, 3);
  assert.equal(context.sources[0].starts[0][0], 1.02);
  assert.deepEqual(context.gains[1].gain.calls, [
    ['set', 0, 1.02],
    ['linear', 1, 1.27],
  ]);
  supply.dispose();
});

test('s2 再生中の setRate は位置を保って source を組み直し、時計を 2 倍で進める', async () => {
  const context = new FakeContext(new Map([[1, buffer(8)]]));
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 8,
    scheduleBuilder,
    contextFactory: () => context,
    fetchImpl: async () => response(1),
    speech: [speech('a', 'source-a', '/a.mp4', { durationSec: 8, outSec: 8 })],
  });
  supply.playFrom(0);
  await settle();
  context.currentTime = 0.52;
  const before = supply.position(0);

  supply.setRate(2);
  const immediatelyAfter = supply.position(before);
  await settle();
  assert.ok(Math.abs(immediatelyAfter - before) <= 1e-6);
  assert.equal(context.sources.length, 2);
  assert.equal(context.sources[0].onended, null, '前世代を停止して切り離す');

  context.currentTime = 0.54;
  const restartedAt = supply.position(before);
  context.currentTime += 1;
  assert.ok(Math.abs(supply.position(before) - restartedAt - 2) <= 1e-6);
  supply.dispose();
});

test('s3 debug は worklet 成功と不在フォールバックの pitch 保持状態を返す', async () => {
  const previousWorkletNode = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = FakeAudioWorkletNode;
  try {
    const workletContext = new FakeContext(new Map([[1, buffer(2)]]));
    const moduleUrls = [];
    workletContext.audioWorklet = { addModule: async url => { moduleUrls.push(url); } };
    const workletSupply = createPreviewAudioSupply({
      timelineDurationSec: 2,
      scheduleBuilder,
      contextFactory: () => workletContext,
      fetchImpl: async () => response(1),
      speech: [speech('a', 'source-a', '/a.mp4')],
      pitchShiftWorkletUrl: '/preview-audio-worklet.js',
    });
    await settle();
    workletSupply.setRate(2);
    assert.deepEqual(moduleUrls, ['/preview-audio-worklet.js']);
    assert.deepEqual(
      (({ rate, pitchPreserved, stretcher }) => ({ rate, pitchPreserved, stretcher }))(workletSupply.debug()),
      { rate: 2, pitchPreserved: true, stretcher: 'worklet' }
    );
    const analyser = workletSupply.attachAnalyser();
    assert.equal(analyser, workletSupply.attachAnalyser(), '同じ AnalyserNode を再利用する');
    assert.equal(workletContext.analysers.length, 1);
    assert.equal(analyser.connections[0], workletContext.destination);
    assert.equal(workletContext.workletNodes[0].connections[0], analyser);
    workletSupply.dispose();

    const fallbackContext = new FakeContext(new Map([[1, buffer(2)]]));
    const warnings = [];
    const fallbackSupply = createPreviewAudioSupply({
      timelineDurationSec: 2,
      scheduleBuilder,
      contextFactory: () => fallbackContext,
      fetchImpl: async () => response(1),
      onWarning: message => warnings.push(message),
      speech: [speech('b', 'source-b', '/b.mp4')],
      pitchShiftWorkletUrl: '/preview-audio-worklet.js',
    });
    fallbackSupply.setRate(2);
    assert.deepEqual(
      (({ rate, pitchPreserved, stretcher }) => ({ rate, pitchPreserved, stretcher }))(fallbackSupply.debug()),
      { rate: 2, pitchPreserved: false, stretcher: 'none' }
    );
    assert.equal(warnings.filter(message => /pitch-preserving playback unavailable/u.test(message)).length, 1);
    fallbackSupply.dispose();
  } finally {
    if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = previousWorkletNode;
  }
});

test('s4 setRate(1) は worklet を外して master を destination へ直結する', async () => {
  const previousWorkletNode = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = FakeAudioWorkletNode;
  try {
    const context = new FakeContext(new Map([[1, buffer(2)]]));
    context.audioWorklet = { addModule: async () => {} };
    const supply = createPreviewAudioSupply({
      timelineDurationSec: 2,
      scheduleBuilder,
      contextFactory: () => context,
      fetchImpl: async () => response(1),
      speech: [speech('a', 'source-a', '/a.mp4')],
      pitchShiftWorkletUrl: '/preview-audio-worklet.js',
    });
    await settle();
    const master = context.gains[0];
    supply.setRate(2);
    const worklet = context.workletNodes[0];
    assert.equal(master.connections[0], worklet);
    assert.equal(worklet.connections[0], context.destination);

    supply.setRate(1);
    assert.equal(worklet.connections.length, 0);
    assert.equal(master.connections[0], context.destination);
    assert.deepEqual(
      (({ rate, pitchPreserved, stretcher }) => ({ rate, pitchPreserved, stretcher }))(supply.debug()),
      { rate: 1, pitchPreserved: true, stretcher: 'none' }
    );
    supply.dispose();
  } finally {
    if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = previousWorkletNode;
  }
});
