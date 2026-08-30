import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as MP4BoxNamespace from '@webav/mp4box.js';
import {
  ByteRangeCache,
  ClipSession,
  RangeMp4Source,
  avcCodecString,
  buildVideoSampleTable,
  selectSupportedDecoderConfig,
  encodedChunkInitForSample,
  fetchMp4Header,
  futureFrameTimestampsToEvict,
  hevcCodecString,
  mergeByteRanges,
  readVideoCodecFromMoov,
  resetCodecProbeCache,
  resolveFrameEngineSourceMode,
  sampleAtPresentationTime,
  summarizeSampleTiming,
} from '../dist/index.js';

const MP4Box = MP4BoxNamespace.default ?? MP4BoxNamespace;

function box(type, payload = new Uint8Array(), extended = false) {
  const header = extended ? 16 : 8;
  const result = new Uint8Array(header + payload.byteLength);
  const view = new DataView(result.buffer);
  if (extended) {
    view.setUint32(0, 1);
    view.setBigUint64(8, BigInt(result.byteLength));
  } else {
    view.setUint32(0, result.byteLength);
  }
  result.set([...type].map(character => character.charCodeAt(0)), 4);
  result.set(payload, header);
  return result;
}

function concat(...parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function rangeFetch(file, requests = []) {
  return async (_url, init = {}) => {
    const value = new Headers(init.headers).get('range');
    const match = value?.match(/^bytes=(\d+)-(\d+)$/u);
    assert.ok(match, `missing byte range: ${value}`);
    const start = Number(match[1]);
    const requestedEnd = Number(match[2]) + 1;
    const end = Math.min(requestedEnd, file.byteLength);
    requests.push({ start, end });
    return new Response(file.slice(start, end), {
      status: 206,
      headers: {
        'content-length': String(end - start),
        'content-range': `bytes ${start}-${end - 1}/${file.byteLength}`,
      },
    });
  };
}

function fullBodyFetch(file, calls = []) {
  return async (_url, init = {}) => {
    calls.push(new Headers(init.headers).get('range'));
    return new Response(file.slice(), { status: 200 });
  };
}

function parseSamples(bytes) {
  return new Promise((resolveParse, rejectParse) => {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    buffer.fileStart = 0;
    const mp4 = MP4Box.createFile();
    mp4.onError = message => rejectParse(new Error(message));
    mp4.onReady = info => resolveParse(mp4.getTrackSamplesInfo(info.videoTracks[0].id));
    mp4.appendBuffer(buffer);
    mp4.flush();
  });
}

// ffmpeg cannot force co64 below 4 GiB. Convert the only (video-only) stco box and
// grow its ancestors so mp4box's co64 branch is fixed without a multi-gigabyte fixture.
function forceVideoStcoToCo64(input) {
  const source = Buffer.from(input);
  const typeOffset = source.indexOf(Buffer.from('stco'));
  assert.ok(typeOffset >= 4, 'stco box not found');
  const boxStart = typeOffset - 4;
  const oldSize = source.readUInt32BE(boxStart);
  const count = source.readUInt32BE(boxStart + 12);
  const delta = count * 4;
  const output = Buffer.alloc(source.length + delta);
  source.copy(output, 0, 0, boxStart);
  output.writeUInt32BE(oldSize + delta, boxStart);
  output.write('co64', boxStart + 4, 4, 'latin1');
  source.copy(output, boxStart + 8, boxStart + 8, boxStart + 16);
  for (let index = 0; index < count; index += 1) {
    const offset = source.readUInt32BE(boxStart + 16 + index * 4);
    output.writeBigUInt64BE(BigInt(offset + delta), boxStart + 16 + index * 8);
  }
  source.copy(output, boxStart + oldSize + delta, boxStart + oldSize);
  for (const type of ['stbl', 'minf', 'mdia', 'trak', 'moov']) {
    const position = source.lastIndexOf(Buffer.from(type), typeOffset);
    assert.ok(position >= 4, `${type} ancestor not found`);
    output.writeUInt32BE(source.readUInt32BE(position - 4) + delta, position - 4);
  }
  return output;
}

test('top-level walker returns only ftyp+moov for faststart and mdat-first MP4 layouts', async () => {
  const ftyp = box('ftyp', new Uint8Array([1, 2, 3, 4]));
  const moov = box('moov', new Uint8Array([9, 8, 7, 6]));
  const mdat = box('mdat', new Uint8Array(96));
  for (const file of [concat(ftyp, moov, mdat), concat(ftyp, mdat, moov)]) {
    const requests = [];
    const opened = await fetchMp4Header('fixture.mp4', {
      fetchImpl: rangeFetch(file, requests),
      initialBytes: 32,
    });
    assert.deepEqual(new Uint8Array(opened.header), concat(ftyp, moov));
    assert.equal(opened.totalBytes, file.byteLength);
    assert.ok(requests.length <= 5, JSON.stringify(requests));
    assert.ok(requests.every(request => request.end - request.start < file.byteLength));
  }
});

test('top-level walker accepts an extended-size box while skipping to a trailing moov', async () => {
  const ftyp = box('ftyp');
  const wide = box('mdat', new Uint8Array(41), true);
  const moov = box('moov', new Uint8Array([1]));
  const file = concat(ftyp, wide, moov);
  const opened = await fetchMp4Header('extended.mp4', {
    fetchImpl: rangeFetch(file),
    initialBytes: 20,
  });
  assert.deepEqual(new Uint8Array(opened.header), concat(ftyp, moov));
});

test('missing Content-Length on a 200 response falls back to one full-body read and warns once', async () => {
  const file = concat(box('ftyp'), box('moov', new Uint8Array([1, 2, 3])), box('mdat'));
  const calls = [];
  const warnings = [];
  const opened = await fetchMp4Header('file-host.mp4', {
    fetchImpl: fullBodyFetch(file, calls),
    onWarning: message => warnings.push(message),
  });
  assert.equal(opened.totalBytes, file.byteLength);
  assert.equal(opened.stats.fullBodyFallback, true);
  assert.equal(opened.stats.fullBodyBytes, file.byteLength);
  assert.equal(opened.stats.requests, 1);
  assert.deepEqual(calls, ['bytes=0-15']);
  assert.equal(warnings.length, 1);
});

test('a 206 response without total size retries once without Range and retains full bytes', async () => {
  const file = concat(box('ftyp'), box('moov', new Uint8Array([4, 5, 6])), box('mdat'));
  const calls = [];
  const warnings = [];
  const fetchImpl = async (_url, init = {}) => {
    const range = new Headers(init.headers).get('range');
    calls.push(range);
    if (range) return new Response(file.slice(0, 16), { status: 206 });
    return new Response(file.slice(), { status: 200 });
  };
  const opened = await fetchMp4Header('partial-host.mp4', {
    fetchImpl,
    onWarning: message => warnings.push(message),
  });
  assert.equal(opened.stats.fullBodyFallback, true);
  assert.equal(opened.stats.fullBodyBytes, file.byteLength);
  assert.equal(opened.stats.requests, 2);
  assert.deepEqual(calls, ['bytes=0-15', null]);
  assert.equal(warnings.length, 1);
});

test('byte ranges merge only when overlapping or adjacent', () => {
  assert.deepEqual(mergeByteRanges([
    { start: 20, end: 30 },
    { start: 0, end: 10 },
    { start: 10, end: 16 },
    { start: 40, end: 50 },
    { start: 28, end: 41 },
  ]), [{ start: 0, end: 16 }, { start: 20, end: 50 }]);
});

test('Range cache returns subranges and evicts least-recently-used bytes at its hard cap', () => {
  const cache = new ByteRangeCache(8);
  cache.put(0, new Uint8Array([0, 1, 2, 3]));
  cache.put(10, new Uint8Array([10, 11, 12, 13]));
  assert.deepEqual([...cache.get(1, 3)], [1, 2]);
  cache.put(20, new Uint8Array([20, 21, 22, 23]));
  assert.equal(cache.get(10, 14), null);
  assert.deepEqual([...cache.get(0, 4)], [0, 1, 2, 3]);
  assert.equal(cache.sizeBytes, 8);
  cache.put(100, new Uint8Array(9));
  assert.equal(cache.sizeBytes, 8);
});

test('future-frame eviction never drops frames at or after the active target', () => {
  assert.deepEqual(futureFrameTimestampsToEvict([110, 120, 130], 2, 100), []);
  assert.deepEqual(futureFrameTimestampsToEvict([90, 110, 120], 2, 100), [90]);
  assert.deepEqual(futureFrameTimestampsToEvict([70, 80, 110, 120], 2, 100), [70, 80]);
});

test('sample timing summary handles 200,000 samples without argument spreading', () => {
  const sampleCount = 200_000;
  const samples = Array.from({ length: sampleCount }, (_, decodeIndex) => ({
    offset: decodeIndex,
    size: 1,
    dts: decodeIndex,
    cts: decodeIndex,
    duration: 1,
    timescale: 1,
    isSync: decodeIndex === 0,
    timestampUs: decodeIndex * 40_000,
    durationUs: decodeIndex === sampleCount - 1 ? 80_000 : 40_000,
    decodeIndex,
    presentationIndex: decodeIndex === sampleCount - 1 ? 0 : decodeIndex,
    decodeEndIndex: decodeIndex,
  }));
  assert.deepEqual(summarizeSampleTiming(samples), {
    maxReorderFrames: sampleCount - 1,
    sampleDurationUs: sampleCount * 40_000 + 40_000,
  });
});

test('codec strings preserve avcC and hvcC profile fields', () => {
  assert.equal(avcCodecString('avc1', new Uint8Array([1, 0x64, 0, 0x32])), 'avc1.640032');
  const hvcc = new Uint8Array(13);
  hvcc[0] = 1;
  hvcc[1] = 1;
  hvcc[2] = 0x60;
  hvcc[12] = 153;
  assert.equal(hevcCodecString('hvc1', hvcc), 'hvc1.1.6.L153');
});

test('shared codec probe selects hardware/software support once and range selection fails closed', async () => {
  const original = globalThis.VideoDecoder;
  const calls = [];
  globalThis.VideoDecoder = class {
    static async isConfigSupported(config) {
      calls.push(config.hardwareAcceleration);
      return { supported: config.hardwareAcceleration === 'prefer-software', config };
    }
  };
  try {
    resetCodecProbeCache();
    const table = {
      codec: 'avc1.640032',
      description: new Uint8Array([1, 2, 3]),
      codedWidth: 1920,
      codedHeight: 1080,
    };
    const selected = await selectSupportedDecoderConfig(table);
    assert.equal(selected.acceleration, 'prefer-software');
    assert.deepEqual(calls, ['prefer-hardware', 'prefer-software', undefined]);
    calls.length = 0;
    resetCodecProbeCache();
    globalThis.VideoDecoder.isConfigSupported = async config => {
      calls.push(config.hardwareAcceleration);
      return { supported: false, config };
    };
    await assert.rejects(selectSupportedDecoderConfig(table), /Unsupported configuration/u);
    assert.deepEqual(calls, ['prefer-hardware', 'prefer-software', undefined]);
  } finally {
    resetCodecProbeCache();
    if (original === undefined) delete globalThis.VideoDecoder;
    else globalThis.VideoDecoder = original;
  }
});

test('range decoder config requests low-latency output in hardware and software modes', async () => {
  const original = globalThis.VideoDecoder;
  globalThis.VideoDecoder = class {
    static async isConfigSupported(config) { return { supported: true, config }; }
  };
  try {
    resetCodecProbeCache();
    const table = {
      codec: 'avc1.640032',
      description: new Uint8Array([1, 2, 3]),
      codedWidth: 1920,
      codedHeight: 1080,
    };
    const hardware = await selectSupportedDecoderConfig(table, 'prefer-hardware');
    const software = await selectSupportedDecoderConfig(table, 'prefer-software');
    assert.equal(hardware.acceleration, 'prefer-hardware');
    assert.equal(hardware.config.optimizeForLatency, true);
    assert.equal(software.acceleration, 'prefer-software');
    assert.equal(software.config.optimizeForLatency, true);
  } finally {
    resetCodecProbeCache();
    if (original === undefined) delete globalThis.VideoDecoder;
    else globalThis.VideoDecoder = original;
  }
});

test('range is the default source and the one-release MP4Clip escape hatch is explicit', () => {
  assert.equal(resolveFrameEngineSourceMode({}), 'range');
  assert.equal(resolveFrameEngineSourceMode({ AKARI_FRAME_ENGINE_SOURCE: 'range' }), 'range');
  assert.equal(resolveFrameEngineSourceMode({ AKARI_FRAME_ENGINE_SOURCE: 'mp4clip' }), 'mp4clip');
  const previous = process.env.AKARI_FRAME_ENGINE_SOURCE;
  try {
    delete process.env.AKARI_FRAME_ENGINE_SOURCE;
    const defaultSession = new ClipSession('default-range', 'unused.mp4');
    assert.equal(defaultSession.getSourceMode(), 'range');
    defaultSession.destroy();
    const cpuRotatedSession = new ClipSession('cpu-rotated', 'unused.mp4', {
      skipSourceRotation: false,
    });
    assert.equal(cpuRotatedSession.getSourceMode(), 'mp4clip');
    cpuRotatedSession.destroy();
    process.env.AKARI_FRAME_ENGINE_SOURCE = 'mp4clip';
    const session = new ClipSession('escape-hatch', 'unused.mp4');
    assert.equal(session.getSourceMode(), 'mp4clip');
    session.destroy();
  } finally {
    if (previous === undefined) delete process.env.AKARI_FRAME_ENGINE_SOURCE;
    else process.env.AKARI_FRAME_ENGINE_SOURCE = previous;
  }
});

test('sample-table rotation matches the shared tkhd probe and exposes logical dimensions', async t => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    t.skip('ffmpeg is required');
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'akari-range-rotation-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'rotate-0.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24', '-frames:v', '24',
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '12', '-bf', '0',
    '-movflags', '+faststart', source,
  ]);
  const fixtures = [{ rotationDeg: 0, path: source }];
  for (const rotationDeg of [90, 180, 270]) {
    const output = path.join(directory, `rotate-${rotationDeg}.mp4`);
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-display_rotation', String(rotationDeg), '-i', source,
      '-map', '0:v:0', '-an', '-c', 'copy', '-movflags', '+faststart', output,
    ]);
    fixtures.push({ rotationDeg, path: output });
  }
  for (const fixture of fixtures) {
    const bytes = readFileSync(fixture.path);
    const header = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const table = await buildVideoSampleTable(header);
    const probed = readVideoCodecFromMoov(header);
    assert.ok(probed);
    assert.equal(table.rotationDeg, fixture.rotationDeg);
    assert.equal(table.rotationDeg, probed.rotationDeg);
    assert.deepEqual([table.codedWidth, table.codedHeight], [160, 90]);
    assert.deepEqual(
      [table.width, table.height],
      fixture.rotationDeg === 90 || fixture.rotationDeg === 270 ? [90, 160] : [160, 90],
    );
  }
});

test('MP4Clip escape hatch performs a whole-response fetch instead of a Range request', async () => {
  const previousMode = process.env.AKARI_FRAME_ENGINE_SOURCE;
  const previousFetch = globalThis.fetch;
  const calls = [];
  try {
    process.env.AKARI_FRAME_ENGINE_SOURCE = 'mp4clip';
    globalThis.fetch = async (_input, init) => {
      calls.push(new Headers(init?.headers).get('range'));
      return new Response(new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112]));
    };
    const session = new ClipSession('mp4clip-behavior', 'fixture.mp4', { loadTimeoutMs: 1 });
    await session.prepare();
    assert.equal(session.getSourceMode(), 'mp4clip');
    assert.deepEqual(calls, [null]);
    session.destroy();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousMode === undefined) delete process.env.AKARI_FRAME_ENGINE_SOURCE;
    else process.env.AKARI_FRAME_ENGINE_SOURCE = previousMode;
  }
});

test('mp4box sample table matches ffprobe packet offsets, sizes, and presentation timestamps', t => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0
    || spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status !== 0) {
    t.skip('ffmpeg and ffprobe are required');
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'akari-range-source-'));
  const fixture = path.join(directory, 'bframes.mp4');
  try {
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-g', '12', '-bf', '2', '-c:a', 'aac', '-movflags', '+faststart', fixture,
    ]);
    const file = readFileSync(fixture);
    const header = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    return Promise.all([buildVideoSampleTable(header), parseSamples(file)]).then(([table, rawSamples]) => {
      const packets = JSON.parse(execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0', '-show_packets',
        '-show_entries', 'packet=pos,size,pts_time,flags', '-of', 'json', fixture,
      ], { encoding: 'utf8' })).packets;
      assert.equal(table.samples.length, packets.length);
      assert.deepEqual([table.width, table.height], [160, 90]);
      assert.ok(new Set(rawSamples.map(sample => sample.chunk_index)).size > 1, 'fixture must exercise multiple stsc chunks');
      for (let index = 0; index < packets.length; index += 1) {
        assert.equal(table.samples[index].offset, Number(packets[index].pos));
        assert.equal(table.samples[index].size, Number(packets[index].size));
        assert.equal(table.samples[index].timestampUs, Math.round(Number(packets[index].pts_time) * 1e6));
        assert.equal(table.samples[index].isSync, packets[index].flags.includes('K'));
      }
      assert.ok(table.samples.some(sample => sample.decodeIndex !== sample.presentationIndex));
      const key = table.samples.find(sample => sample.isSync);
      const delta = table.samples.find(sample => !sample.isSync);
      assert.equal(encodedChunkInitForSample(key, new Uint8Array()).type, 'key');
      assert.equal(encodedChunkInitForSample(delta, new Uint8Array()).type, 'delta');
      assert.equal(encodedChunkInitForSample(key, new Uint8Array()).timestamp, key.timestampUs);
      const last = sampleAtPresentationTime(table, table.presentationDurationUs - 1);
      assert.equal(last.timestampUs, table.lastFrameStartUs);
    });
  } finally {
    t.after(() => rmSync(directory, { recursive: true, force: true }));
  }
});

test('synthetic co64 header preserves ffprobe packet offsets and sizes', async t => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0
    || spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status !== 0) {
    t.skip('ffmpeg and ffprobe are required');
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'akari-range-co64-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const base = path.join(directory, 'base.mp4');
  const co64 = path.join(directory, 'co64.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=24', '-frames:v', '48',
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '12', '-bf', '2',
    '-movflags', '+faststart', base,
  ]);
  writeFileSync(co64, forceVideoStcoToCo64(readFileSync(base)));
  const bytes = readFileSync(co64);
  const table = await buildVideoSampleTable(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const packets = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_packets',
    '-show_entries', 'packet=pos,size,pts_time', '-of', 'json', co64,
  ], { encoding: 'utf8' })).packets;
  assert.equal(table.samples.length, packets.length);
  assert.deepEqual(
    table.samples.map(sample => [sample.offset, sample.size, sample.timestampUs]),
    packets.map(packet => [Number(packet.pos), Number(packet.size), Math.round(Number(packet.pts_time) * 1e6)]),
  );
});

test('Range source pads all in-duration tail requests with the final presentation frame', async t => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    t.skip('ffmpeg is required');
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'akari-range-tail-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, 'tail.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24',
    '-frames:v', '249', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-g', '48', '-bf', '2', '-movflags', '+faststart', fixture,
  ]);
  const file = readFileSync(fixture);
  const original = {
    VideoDecoder: globalThis.VideoDecoder,
    VideoFrame: globalThis.VideoFrame,
    EncodedVideoChunk: globalThis.EncodedVideoChunk,
  };
  class FakeFrame {
    constructor(timestamp, duration) {
      this.timestamp = timestamp;
      this.duration = duration;
      this.closed = false;
    }
    clone() { return new FakeFrame(this.timestamp, this.duration); }
    close() { this.closed = true; }
  }
  class FakeEncodedVideoChunk {
    constructor(init) { Object.assign(this, init); }
  }
  class FakeVideoDecoder {
    static failNext = false;
    static flushCalls = 0;
    static async isConfigSupported(config) { return { supported: true, config }; }
    constructor(init) {
      this.init = init;
      this.pending = [];
      this.decodeQueueSize = 0;
      this.listeners = new Set();
      this.closed = false;
      this.reorderDepth = 2;
    }
    configure() {}
    decode(chunk) {
      if (FakeVideoDecoder.failNext) {
        FakeVideoDecoder.failNext = false;
        queueMicrotask(() => this.init.error(new Error('injected decoder failure')));
        return;
      }
      this.pending.push(chunk);
      this.decodeQueueSize += 1;
      queueMicrotask(() => {
        if (this.closed) return;
        this.decodeQueueSize = Math.max(0, this.decodeQueueSize - 1);
        if (this.pending.length > this.reorderDepth) {
          let nextIndex = 0;
          for (let index = 1; index < this.pending.length; index += 1) {
            if (this.pending[index].timestamp < this.pending[nextIndex].timestamp) nextIndex = index;
          }
          const [next] = this.pending.splice(nextIndex, 1);
          if (next) this.init.output(new FakeFrame(next.timestamp, next.duration));
        }
        for (const listener of this.listeners) listener();
      });
    }
    async flush() {
      FakeVideoDecoder.flushCalls += 1;
      this.pending.sort((left, right) => left.timestamp - right.timestamp);
      for (const next of this.pending.splice(0)) this.init.output(new FakeFrame(next.timestamp, next.duration));
      this.decodeQueueSize = 0;
      for (const listener of this.listeners) listener();
    }
    addEventListener(type, listener) { if (type === 'dequeue') this.listeners.add(listener); }
    removeEventListener(type, listener) { if (type === 'dequeue') this.listeners.delete(listener); }
    close() { this.closed = true; this.pending.length = 0; this.decodeQueueSize = 0; }
  }
  globalThis.VideoDecoder = FakeVideoDecoder;
  globalThis.VideoFrame = FakeFrame;
  globalThis.EncodedVideoChunk = FakeEncodedVideoChunk;
  try {
    const source = new RangeMp4Source('tail', 'tail.mp4', {
      fetchImpl: rangeFetch(new Uint8Array(file.buffer, file.byteOffset, file.byteLength)),
    });
    await source.prepare();
    const table = await buildVideoSampleTable(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    );
    const sequential = await source.fork('tail:sequential');
    for (const decodeIndex of table.presentationOrder.slice(0, 60)) {
      const expected = table.samples[decodeIndex].timestampUs;
      const frame = await sequential.decode(expected);
      assert.equal(frame.timestamp, expected);
      frame.close();
    }
    assert.equal(FakeVideoDecoder.flushCalls, 0, 'forward non-terminal decode must not flush');
    sequential.destroy();
    FakeVideoDecoder.failNext = true;
    const recovering = await source.fork('tail:recovering');
    const recovered = await recovering.decode(0);
    assert.equal(recovered.timestamp, 0);
    recovered.close();
    recovering.destroy();
    const { duration } = source.meta;
    const lastFrameStartUs = source.keyframes.lastFrameStartUs;
    for (const target of [lastFrameStartUs, lastFrameStartUs + Math.floor(1e6 / 48), duration - 1]) {
      const frame = await source.decode(target);
      assert.equal(frame.timestamp, lastFrameStartUs);
      frame.close();
    }
    const fork = await source.fork('tail:fork');
    const forked = await fork.decode(duration - 1);
    assert.equal(forked.timestamp, lastFrameStartUs);
    forked.close();
    assert.ok(source.stats.mediaBytes < file.byteLength);
    assert.ok(source.stats.maxDecodeQueueSize <= 48 * 2);
    assert.ok(source.stats.maxFutureFrames <= table.maxReorderFrames + 4);
    const fallbackCalls = [];
    const fallbackWarnings = [];
    const fallback = new RangeMp4Source('tail:fallback', 'tail-file.mp4', {
      fetchImpl: fullBodyFetch(
        new Uint8Array(file.buffer, file.byteOffset, file.byteLength),
        fallbackCalls,
      ),
      onWarning: message => fallbackWarnings.push(message),
    });
    const fallbackFrame = await fallback.decode(0);
    assert.equal(fallbackFrame.timestamp, 0);
    fallbackFrame.close();
    assert.equal(fallback.stats.fullBodyFallback, true);
    assert.equal(fallback.stats.fullBodyBytes, file.byteLength);
    assert.equal(fallbackCalls.length, 1);
    assert.equal(fallbackWarnings.length, 1);
    fallback.destroy();
    fork.destroy();
    source.destroy();
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});

test('Range source waits for delayed output after dequeue across all seek orders', {
  timeout: 30_000,
}, async t => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    t.skip('ffmpeg is required');
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'akari-range-delayed-output-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, 'delayed-output.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=24', '-frames:v', '36',
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '12',
    '-keyint_min', '12', '-sc_threshold', '0', '-bf', '2',
    '-movflags', '+faststart', fixture,
  ]);
  const file = readFileSync(fixture);
  const table = await buildVideoSampleTable(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
  );
  assert.equal(table.samples.length, 36);
  assert.ok(table.maxReorderFrames > 0, 'fixture must exercise reordered presentation');

  const original = {
    VideoDecoder: globalThis.VideoDecoder,
    VideoFrame: globalThis.VideoFrame,
    EncodedVideoChunk: globalThis.EncodedVideoChunk,
  };
  class DelayedFrame {
    constructor(timestamp, duration) {
      this.timestamp = timestamp;
      this.duration = duration;
      this.closed = false;
    }
    clone() { return new DelayedFrame(this.timestamp, this.duration); }
    close() { this.closed = true; }
  }
  class DelayedChunk {
    constructor(init) { Object.assign(this, init); }
  }
  class DelayedVideoDecoder {
    static instances = [];
    static flushCalls = 0;
    static outputBatches = [];
    static deliverySequence = 0;
    static withheldTimestamp = null;
    static async isConfigSupported(config) { return { supported: true, config }; }
    constructor(init) {
      this.init = init;
      this.pending = [];
      this.decodeQueueSize = 0;
      this.listeners = new Set();
      this.closed = false;
      this.deliveryTimer = null;
      DelayedVideoDecoder.instances.push(this);
    }
    configure() {}
    decode(chunk) {
      if (this.closed) throw new Error('decode called after close');
      this.pending.push(chunk);
      this.decodeQueueSize += 1;
      queueMicrotask(() => {
        if (this.closed) return;
        this.decodeQueueSize = Math.max(0, this.decodeQueueSize - 1);
        for (const listener of this.listeners) listener();
        if (this.decodeQueueSize === 0) this.schedulePresentationBatch();
      });
    }
    schedulePresentationBatch() {
      if (this.deliveryTimer || this.pending.length === 0) return;
      const delayMs = 50 + (DelayedVideoDecoder.deliverySequence % 3) * 50;
      DelayedVideoDecoder.deliverySequence += 1;
      this.deliveryTimer = setTimeout(() => {
        this.deliveryTimer = null;
        if (this.closed) return;
        const sorted = this.pending.splice(0).sort((left, right) => left.timestamp - right.timestamp);
        const batch = [];
        for (const chunk of sorted) {
          if (chunk.timestamp === DelayedVideoDecoder.withheldTimestamp) this.pending.push(chunk);
          else batch.push(chunk);
        }
        DelayedVideoDecoder.outputBatches.push(batch.map(chunk => chunk.timestamp));
        for (const chunk of batch) {
          this.init.output(new DelayedFrame(chunk.timestamp, chunk.duration));
        }
      }, delayMs);
    }
    async flush() {
      DelayedVideoDecoder.flushCalls += 1;
      if (this.deliveryTimer) clearTimeout(this.deliveryTimer);
      this.deliveryTimer = null;
      const batch = this.pending.splice(0).sort((left, right) => left.timestamp - right.timestamp);
      DelayedVideoDecoder.outputBatches.push(batch.map(chunk => chunk.timestamp));
      for (const chunk of batch) {
        this.init.output(new DelayedFrame(chunk.timestamp, chunk.duration));
      }
      this.decodeQueueSize = 0;
      for (const listener of this.listeners) listener();
    }
    addEventListener(type, listener) { if (type === 'dequeue') this.listeners.add(listener); }
    removeEventListener(type, listener) { if (type === 'dequeue') this.listeners.delete(listener); }
    close() {
      this.closed = true;
      if (this.deliveryTimer) clearTimeout(this.deliveryTimer);
      this.deliveryTimer = null;
      this.pending.length = 0;
      this.decodeQueueSize = 0;
    }
  }

  globalThis.VideoDecoder = DelayedVideoDecoder;
  globalThis.VideoFrame = DelayedFrame;
  globalThis.EncodedVideoChunk = DelayedChunk;
  try {
    const source = new RangeMp4Source('delayed-output', 'delayed-output.mp4', {
      fetchImpl: rangeFetch(new Uint8Array(file.buffer, file.byteOffset, file.byteLength)),
    });
    await source.prepare();
    const presentation = table.presentationOrder.map(index => table.samples[index].timestampUs);
    const random = presentation
      .map((timestamp, index) => ({ timestamp, order: (index * 17) % presentation.length }))
      .sort((left, right) => left.order - right.order)
      .map(entry => entry.timestamp);
    const gopPingPong = [];
    for (let start = 0; start < presentation.length; start += 12) {
      let left = start;
      let right = Math.min(start + 11, presentation.length - 1);
      while (left <= right) {
        gopPingPong.push(presentation[left]);
        left += 1;
        if (left <= right) {
          gopPingPong.push(presentation[right]);
          right -= 1;
        }
      }
    }
    const patterns = [
      ['forward', presentation],
      ['random', random],
      ['reverse', presentation.slice().reverse()],
      ['same-gop-ping-pong', gopPingPong],
    ];
    for (const [name, timestamps] of patterns) {
      assert.equal(timestamps.length, presentation.length, `${name}: every frame is requested`);
      const session = await source.fork(`delayed-output:${name}`);
      for (let requestIndex = 0; requestIndex < timestamps.length; requestIndex += 1) {
        const timestamp = timestamps[requestIndex];
        const frame = await session.decode(timestamp);
        assert.equal(frame.timestamp, timestamp, `${name}: exact frame at ${timestamp}us`);
        frame.close();
        if (name === 'forward' && requestIndex < timestamps.length - 1) {
          assert.equal(DelayedVideoDecoder.flushCalls, 0,
            'forward non-terminal delayed output must not flush');
        }
      }
      session.destroy();
    }
    for (const batch of DelayedVideoDecoder.outputBatches) {
      assert.deepEqual(batch, [...batch].sort((left, right) => left - right));
    }

    const flushTarget = presentation[5];
    const afterFlushTarget = presentation[13];
    const flushCallsBeforeWithholding = DelayedVideoDecoder.flushCalls;
    DelayedVideoDecoder.withheldTimestamp = flushTarget;
    const flushSession = await source.fork('delayed-output:flush-recovery');
    const flushedFrame = await flushSession.decode(flushTarget);
    assert.equal(flushedFrame.timestamp, flushTarget);
    flushedFrame.close();
    assert.ok(DelayedVideoDecoder.flushCalls > flushCallsBeforeWithholding,
      'grace expiry flushes the reorder buffer as a last resort');
    DelayedVideoDecoder.withheldTimestamp = null;
    const instancesBeforeContinuation = DelayedVideoDecoder.instances.length;
    const continuedFrame = await flushSession.decode(afterFlushTarget);
    assert.equal(continuedFrame.timestamp, afterFlushTarget);
    continuedFrame.close();
    assert.ok(DelayedVideoDecoder.instances.length > instancesBeforeContinuation,
      'a flushed source reseeks and submits again from sync on the next decode');
    flushSession.destroy();

    const directOutputs = [];
    const direct = new DelayedVideoDecoder({
      output: frame => directOutputs.push(frame.timestamp),
      error: error => { throw error; },
    });
    direct.configure({});
    direct.decode(new DelayedChunk({ timestamp: 0, duration: 1, type: 'key', data: new Uint8Array() }));
    await new Promise(resolve => setTimeout(resolve, 0));
    await direct.flush();
    direct.decode(new DelayedChunk({ timestamp: 1, duration: 1, type: 'key', data: new Uint8Array() }));
    await new Promise(resolve => setTimeout(resolve, 160));
    assert.deepEqual(directOutputs, [0, 1], 'flush keeps the decoder usable for a new sync input');
    direct.close();
    source.destroy();
  } finally {
    for (const instance of DelayedVideoDecoder.instances) instance.close();
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});

test('six-stage decoder pipeline continues supplying without per-frame grace or flush', {
  timeout: 20_000,
}, async t => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    t.skip('ffmpeg is required');
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'akari-range-pipeline-six-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, 'pipeline-six.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=24', '-frames:v', '72',
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '72',
    '-keyint_min', '72', '-sc_threshold', '0', '-bf', '0',
    '-movflags', '+faststart', fixture,
  ]);
  const file = readFileSync(fixture);
  const table = await buildVideoSampleTable(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
  );
  assert.equal(table.samples.length, 72);
  assert.equal(table.maxReorderFrames, 0);

  const original = {
    VideoDecoder: globalThis.VideoDecoder,
    VideoFrame: globalThis.VideoFrame,
    EncodedVideoChunk: globalThis.EncodedVideoChunk,
  };
  class PipelineFrame {
    constructor(timestamp, duration) {
      this.timestamp = timestamp;
      this.duration = duration;
      this.closed = false;
    }
    clone() { return new PipelineFrame(this.timestamp, this.duration); }
    close() { this.closed = true; }
  }
  class PipelineChunk {
    constructor(init) { Object.assign(this, init); }
  }
  class PipelineVideoDecoder {
    static configureCalls = 0;
    static flushCalls = 0;
    static async isConfigSupported(config) { return { supported: true, config }; }
    constructor(init) {
      this.init = init;
      this.pipeline = [];
      this.decodeQueueSize = 0;
      this.listeners = new Set();
      this.closed = false;
    }
    configure() { PipelineVideoDecoder.configureCalls += 1; }
    decode(chunk) {
      if (this.closed) throw new Error('decode called after close');
      this.decodeQueueSize += 1;
      this.pipeline.push(chunk);
      queueMicrotask(() => {
        if (this.closed) return;
        this.decodeQueueSize = Math.max(0, this.decodeQueueSize - 1);
        if (this.pipeline.length >= 6) {
          const next = this.pipeline.shift();
          this.init.output(new PipelineFrame(next.timestamp, next.duration));
        }
        for (const listener of this.listeners) listener();
      });
    }
    async flush() {
      PipelineVideoDecoder.flushCalls += 1;
      for (const chunk of this.pipeline.splice(0)) {
        this.init.output(new PipelineFrame(chunk.timestamp, chunk.duration));
      }
      this.decodeQueueSize = 0;
      for (const listener of this.listeners) listener();
    }
    addEventListener(type, listener) { if (type === 'dequeue') this.listeners.add(listener); }
    removeEventListener(type, listener) { if (type === 'dequeue') this.listeners.delete(listener); }
    close() {
      this.closed = true;
      this.pipeline.length = 0;
      this.decodeQueueSize = 0;
    }
  }

  globalThis.VideoDecoder = PipelineVideoDecoder;
  globalThis.VideoFrame = PipelineFrame;
  globalThis.EncodedVideoChunk = PipelineChunk;
  try {
    const source = new RangeMp4Source('pipeline-six', 'pipeline-six.mp4', {
      fetchImpl: rangeFetch(new Uint8Array(file.buffer, file.byteOffset, file.byteLength)),
    });
    await source.prepare();
    const timestamps = table.presentationOrder
      .slice(0, 60)
      .map(index => table.samples[index].timestampUs);
    const startedAt = performance.now();
    for (const timestamp of timestamps) {
      const frame = await source.decode(timestamp);
      assert.equal(frame.timestamp, timestamp);
      frame.close();
    }
    const elapsedMs = performance.now() - startedAt;
    assert.equal(PipelineVideoDecoder.flushCalls, 0, 'pipeline fill must not flush');
    assert.equal(PipelineVideoDecoder.configureCalls, 1, 'forward decode keeps one decoder');
    assert.ok(elapsedMs < 3_000, `60 forward frames took ${elapsedMs.toFixed(1)}ms`);
    assert.ok(source.stats.maxDecodeQueueSize <= 72 * 2);
    source.destroy();
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});

test('five one-minute cuts from a five-minute source stay within sample plus preceding-GOP byte budget', async t => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    t.skip('ffmpeg is required');
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'akari-range-five-cuts-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, 'five-minutes.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=1', '-t', '300',
    '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-g', '10', '-keyint_min', '10', '-sc_threshold', '0', '-bf', '2',
    '-movflags', '+faststart', fixture,
  ]);
  const file = readFileSync(fixture);
  const table = await buildVideoSampleTable(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
  );
  const original = {
    VideoDecoder: globalThis.VideoDecoder,
    VideoFrame: globalThis.VideoFrame,
    EncodedVideoChunk: globalThis.EncodedVideoChunk,
  };
  class Frame {
    constructor(timestamp, duration) { this.timestamp = timestamp; this.duration = duration; }
    clone() { return new Frame(this.timestamp, this.duration); }
    close() {}
  }
  class Chunk { constructor(init) { Object.assign(this, init); } }
  class Decoder {
    static async isConfigSupported(config) { return { supported: true, config }; }
    constructor(init) { this.init = init; this.pending = []; this.decodeQueueSize = 0; this.listeners = new Set(); this.closed = false; }
    configure() {}
    decode(chunk) {
      this.pending.push(chunk);
      this.decodeQueueSize = this.pending.length;
      queueMicrotask(() => {
        if (this.closed) return;
        const next = this.pending.shift();
        if (!next) return;
        this.decodeQueueSize = this.pending.length;
        this.init.output(new Frame(next.timestamp, next.duration));
        for (const listener of this.listeners) listener();
      });
    }
    async flush() { while (this.pending.length) await new Promise(resolve => queueMicrotask(resolve)); }
    addEventListener(type, listener) { if (type === 'dequeue') this.listeners.add(listener); }
    removeEventListener(type, listener) { if (type === 'dequeue') this.listeners.delete(listener); }
    close() { this.closed = true; this.pending.length = 0; this.decodeQueueSize = 0; }
  }
  globalThis.VideoDecoder = Decoder;
  globalThis.VideoFrame = Frame;
  globalThis.EncodedVideoChunk = Chunk;
  try {
    const source = new RangeMp4Source('five-cuts', 'five-minutes.mp4', {
      fetchImpl: rangeFetch(new Uint8Array(file.buffer, file.byteOffset, file.byteLength)),
    });
    await source.prepare();
    let cutBytes = 0;
    let precedingGopBytes = 0;
    for (let cut = 0; cut < 5; cut += 1) {
      const presentation = table.presentationOrder.slice(cut * 60, (cut + 1) * 60);
      const first = table.samples[presentation[0]];
      let sync = first.decodeIndex;
      while (sync > 0 && !table.samples[sync].isSync) sync -= 1;
      precedingGopBytes += table.samples.slice(sync, first.decodeIndex)
        .reduce((sum, sample) => sum + sample.size, 0);
      cutBytes += presentation.reduce((sum, index) => sum + table.samples[index].size, 0);
      const session = await source.fork(`five-cuts:${cut}`);
      for (const index of presentation) {
        const frame = await session.decode(table.samples[index].timestampUs);
        frame.close();
      }
      session.destroy();
    }
    const moovType = file.indexOf(Buffer.from('moov'));
    const moovBytes = file.readUInt32BE(moovType - 4);
    const allowedMedia = (cutBytes + precedingGopBytes) * 1.2;
    assert.ok(source.stats.mediaBytes <= allowedMedia, JSON.stringify({ stats: source.stats, allowedMedia }));
    assert.ok(source.stats.headerBytes <= moovBytes + 256);
    assert.ok(source.stats.bytes <= allowedMedia + moovBytes + 256);
    source.destroy();
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
