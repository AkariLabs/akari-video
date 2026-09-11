import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  RangeMp4Source,
  buildVideoSampleTable,
  summarizePrefetchStats,
} from '../dist/index.js';

function rangeFetch(file) {
  return async (_url, init = {}) => {
    const match = new Headers(init.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u);
    assert.ok(match);
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]) + 1, file.byteLength);
    return new Response(file.slice(start, end), {
      status: 206,
      headers: {
        'content-length': String(end - start),
        'content-range': `bytes ${start}-${end - 1}/${file.byteLength}`,
      },
    });
  };
}

class Frame {
  constructor(timestamp, duration) {
    this.timestamp = timestamp;
    this.duration = duration;
    this.closed = false;
  }
  clone() { return new Frame(this.timestamp, this.duration); }
  close() { this.closed = true; }
}

class Chunk {
  constructor(init) { Object.assign(this, init); }
}

class Decoder {
  static instances = [];
  static flushCalls = 0;
  static reorderDepth = 2;
  static async isConfigSupported(config) { return { supported: true, config }; }
  constructor(init) {
    this.init = init;
    this.pending = [];
    this.decodeQueueSize = 0;
    this.listeners = new Set();
    this.closed = false;
    Decoder.instances.push(this);
  }
  configure() {}
  decode(chunk) {
    if (this.closed) throw new Error('decode after close');
    this.pending.push(chunk);
    this.decodeQueueSize += 1;
    queueMicrotask(() => {
      if (this.closed) return;
      this.decodeQueueSize -= 1;
      // VideoToolbox と同様に入力を数枚受け取ってから提示順で出力する。
      if (this.pending.length > Decoder.reorderDepth) {
        let next = 0;
        for (let index = 1; index < this.pending.length; index += 1) {
          if (this.pending[index].timestamp < this.pending[next].timestamp) next = index;
        }
        const [output] = this.pending.splice(next, 1);
        this.init.output(new Frame(output.timestamp, output.duration));
      }
      for (const listener of this.listeners) listener();
    });
  }
  async flush() {
    Decoder.flushCalls += 1;
    this.pending.sort((left, right) => left.timestamp - right.timestamp);
    for (const chunk of this.pending.splice(0)) {
      this.init.output(new Frame(chunk.timestamp, chunk.duration));
    }
    this.decodeQueueSize = 0;
    for (const listener of this.listeners) listener();
  }
  addEventListener(type, listener) { if (type === 'dequeue') this.listeners.add(listener); }
  removeEventListener(type, listener) { if (type === 'dequeue') this.listeners.delete(listener); }
  close() {
    this.closed = true;
    this.pending.length = 0;
    this.decodeQueueSize = 0;
  }
}

async function settlePump() {
  for (let index = 0; index < 4; index += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function decodeTimestamps(source, timestamps) {
  const actual = [];
  for (const timestamp of timestamps) {
    const frame = await source.decode(timestamp);
    actual.push(frame.timestamp);
    frame.close();
  }
  return actual;
}

async function createFixture(t, { frames = 48, bf = 2 } = {}) {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    t.skip('ffmpeg is required');
    return null;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'akari-range-prefetch-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, 'prefetch.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=24', '-frames:v', String(frames),
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '12',
    '-keyint_min', '12', '-sc_threshold', '0', '-bf', String(bf),
    '-movflags', '+faststart', fixture,
  ]);
  const file = readFileSync(fixture);
  const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  const table = await buildVideoSampleTable(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
  );
  if (bf > 0) assert.ok(table.maxReorderFrames > 0);
  const allTimestamps = table.presentationOrder
    .map(index => table.samples[index].timestampUs);
  return { bytes, table, timestamps: allTimestamps.slice(0, 32), allTimestamps };
}

function installDecoder(t) {
  const original = {
    VideoDecoder: globalThis.VideoDecoder,
    VideoFrame: globalThis.VideoFrame,
    EncodedVideoChunk: globalThis.EncodedVideoChunk,
  };
  Decoder.instances.length = 0;
  Decoder.flushCalls = 0;
  Decoder.reorderDepth = 2;
  globalThis.VideoDecoder = Decoder;
  globalThis.VideoFrame = Frame;
  globalThis.EncodedVideoChunk = Chunk;
  t.after(() => {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  });
}

test('prefetch returns the same timestamps for the same B-frame target sequence', {
  timeout: 20_000,
}, async t => {
  const fixture = await createFixture(t);
  if (!fixture) return;
  installDecoder(t);
  const without = new RangeMp4Source('without-prefetch', 'prefetch.mp4', {
    fetchImpl: rangeFetch(fixture.bytes),
    prefetch: false,
  });
  const expected = await decodeTimestamps(without, fixture.timestamps);
  without.destroy();
  const source = new RangeMp4Source('with-prefetch', 'prefetch.mp4', {
    fetchImpl: rangeFetch(fixture.bytes),
  });
  const actual = [];
  for (const timestamp of fixture.timestamps) {
    const frame = await source.decode(timestamp);
    actual.push(frame.timestamp);
    frame.close();
    await settlePump();
  }
  assert.deepEqual(actual, expected, 'prefetch must not change selected presentation frames');
  source.destroy();
});

test('prefetch crosses GOP boundaries without grace, flush, or decoder recreation', {
  timeout: 20_000,
}, async t => {
  const fixture = await createFixture(t);
  if (!fixture) return;
  installDecoder(t);
  const source = new RangeMp4Source('gop-prefetch', 'prefetch.mp4', {
    fetchImpl: rangeFetch(fixture.bytes),
  });
  for (const timestamp of fixture.timestamps) {
    (await source.decode(timestamp)).close();
    // 描画・合成中に走るバックグラウンドポンプへ macrotask を渡す。
    await settlePump();
  }
  assert.equal(source.stats.graceWaits, 0);
  assert.equal(Decoder.flushCalls, 0, 'GOP boundaries do not need recovery flushes');
  assert.equal(Decoder.instances.length, 1, 'forward playback keeps one decoder');
  assert.ok(source.stats.prefetchSubmitted > 0);
  assert.ok(source.stats.prefetchHits > source.stats.prefetchMisses, JSON.stringify(source.stats));
  source.destroy();
});

test('backwards seek outside future frames resets and does not restart prefetch', {
  timeout: 20_000,
}, async t => {
  const fixture = await createFixture(t);
  if (!fixture) return;
  installDecoder(t);
  const source = new RangeMp4Source('backwards-reset', 'prefetch.mp4', {
    fetchImpl: rangeFetch(fixture.bytes),
  });
  for (const timestamp of fixture.timestamps) {
    (await source.decode(timestamp)).close();
    await settlePump();
  }
  const submittedBeforeBackwards = source.stats.prefetchSubmitted;
  const instancesBeforeBackwards = Decoder.instances.length;
  const backwards = await source.decode(fixture.timestamps[2]);
  assert.equal(backwards.timestamp, fixture.timestamps[2]);
  backwards.close();
  await settlePump();
  assert.ok(Decoder.instances.length > instancesBeforeBackwards, 'backwards seek resets the decoder');
  assert.equal(source.stats.prefetchSubmitted, submittedBeforeBackwards,
    'the backwards decode does not restart the pump');
  source.destroy();
});

test('backwards target still reuses an already output future frame', {
  timeout: 20_000,
}, async t => {
  const fixture = await createFixture(t);
  if (!fixture) return;
  installDecoder(t);
  const source = new RangeMp4Source('backwards-future-hit', 'prefetch.mp4', {
    fetchImpl: rangeFetch(fixture.bytes),
  });
  (await source.decode(fixture.timestamps[0])).close();
  (await source.decode(fixture.timestamps[1])).close();
  await settlePump();
  (await source.decode(fixture.timestamps[6])).close();
  await settlePump();
  (await source.decode(fixture.timestamps[14])).close();
  const hitsBeforeBackwards = source.stats.prefetchHits;
  const instancesBeforeBackwards = Decoder.instances.length;
  const backwards = await source.decode(fixture.timestamps[10]);
  assert.equal(backwards.timestamp, fixture.timestamps[10]);
  backwards.close();
  assert.equal(Decoder.instances.length, instancesBeforeBackwards,
    'an output future frame does not recreate the decoder');
  assert.equal(source.stats.prefetchHits, hitsBeforeBackwards + 1);
  source.destroy();
});

test('prefetch ahead is capped by the byte budget even with a larger frame option', {
  timeout: 20_000,
}, async t => {
  const fixture = await createFixture(t);
  if (!fixture) return;
  installDecoder(t);
  const frameBytes = fixture.table.codedWidth * fixture.table.codedHeight * 1.5;
  const source = new RangeMp4Source('budgeted-prefetch', 'prefetch.mp4', {
    fetchImpl: rangeFetch(fixture.bytes),
    prefetchAheadFrames: 64,
    prefetchBudgetBytes: frameBytes * 3,
  });
  await decodeTimestamps(source, fixture.timestamps.slice(0, 8));
  await settlePump();
  assert.ok(source.stats.maxFutureFrames <= 3, JSON.stringify(source.stats));
  assert.ok(source.stats.prefetchAheadHistogram.slice(4).every(count => count === 0));
  source.destroy();
});

test('a two-frame final GOP keeps prefetched frames and flushes only the decoder tail', {
  timeout: 20_000,
}, async t => {
  const fixture = await createFixture(t, { frames: 50, bf: 0 });
  if (!fixture) return;
  installDecoder(t);
  // 4 入力目から提示順で出し、残る 3 枚は flush だけで出るデコーダを模擬する。
  Decoder.reorderDepth = 3;
  const source = new RangeMp4Source('short-final-gop', 'prefetch.mp4', {
    fetchImpl: rangeFetch(fixture.bytes),
  });
  const actual = [];
  for (const timestamp of fixture.allTimestamps) {
    const frame = await source.decode(timestamp);
    actual.push(frame.timestamp);
    frame.close();
    await settlePump();
  }
  assert.deepEqual(actual, fixture.allTimestamps);
  assert.equal(source.stats.droppedTargets, 0);
  assert.equal(source.stats.targetSkips, 0);
  assert.equal(Decoder.instances.length, 1);
  assert.ok(Decoder.flushCalls <= 1, `flush calls: ${Decoder.flushCalls}`);
  source.destroy();
});

test('prefetch summary combines pools with nearest-rank percentiles', () => {
  const histogram = (...values) => {
    const result = new Array(65).fill(0);
    for (const value of values) result[value] += 1;
    return result;
  };
  const base = {
    requests: 0, bytes: 0, headerBytes: 0, mediaBytes: 0, maxDecodeQueueSize: 0,
    fullBodyFallback: false, fullBodyBytes: 0, maxFutureFrames: 0, graceWaits: 0,
    eosFlushes: 0, targetSkips: 0, droppedTargets: 0,
  };
  assert.deepEqual(summarizePrefetchStats([
    { ...base, prefetchHits: 2, prefetchMisses: 1, prefetchSubmitted: 7, prefetchAheadHistogram: histogram(1, 9) },
    { ...base, prefetchHits: 3, prefetchMisses: 4, prefetchSubmitted: 8, prefetchAheadHistogram: histogram(3, 5, 7) },
  ]), {
    hit: 5,
    miss: 5,
    submitted: 15,
    aheadFrames: { count: 5, p50: 5, p95: 9, max: 9 },
  });
});

test('prefetch env and global kill switches retain demand-driven behavior', async t => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    t.skip('ffmpeg is required');
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'akari-range-prefetch-off-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, 'off.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=12', '-frames:v', '24',
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '12', '-bf', '0',
    '-movflags', '+faststart', fixture,
  ]);
  const file = readFileSync(fixture);
  const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  const table = await buildVideoSampleTable(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
  );
  const timestamps = table.presentationOrder.slice(0, 5)
    .map(index => table.samples[index].timestampUs);
  const original = {
    VideoDecoder: globalThis.VideoDecoder,
    VideoFrame: globalThis.VideoFrame,
    EncodedVideoChunk: globalThis.EncodedVideoChunk,
    env: process.env.AKARI_FRAME_ENGINE_PREFETCH,
  };
  globalThis.VideoDecoder = Decoder;
  globalThis.VideoFrame = Frame;
  globalThis.EncodedVideoChunk = Chunk;
  try {
    process.env.AKARI_FRAME_ENGINE_PREFETCH = '0';
    const envDisabled = new RangeMp4Source('env-off', 'off.mp4', { fetchImpl: rangeFetch(bytes) });
    await decodeTimestamps(envDisabled, timestamps);
    await settlePump();
    assert.equal(envDisabled.stats.prefetchSubmitted, 0);
    envDisabled.destroy();

    delete process.env.AKARI_FRAME_ENGINE_PREFETCH;
    globalThis.__AKARI_FRAME_ENGINE_PREFETCH__ = false;
    const globalDisabled = new RangeMp4Source('global-off', 'off.mp4', { fetchImpl: rangeFetch(bytes) });
    await decodeTimestamps(globalDisabled, timestamps);
    await settlePump();
    assert.equal(globalDisabled.stats.prefetchSubmitted, 0);
    globalDisabled.destroy();
  } finally {
    delete globalThis.__AKARI_FRAME_ENGINE_PREFETCH__;
    if (original.env === undefined) delete process.env.AKARI_FRAME_ENGINE_PREFETCH;
    else process.env.AKARI_FRAME_ENGINE_PREFETCH = original.env;
    for (const name of ['VideoDecoder', 'VideoFrame', 'EncodedVideoChunk']) {
      const value = original[name];
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
