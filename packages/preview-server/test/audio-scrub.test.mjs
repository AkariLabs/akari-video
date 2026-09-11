import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Mp4AudioTrack,
  createScrubAudioController,
  parseMp4AudioTrack,
  resolveBgmOffset,
} from '../public/audio-scrub.js';

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

function bytes(...values) { return Uint8Array.from(values); }
function ascii(value) { return Uint8Array.from(value, character => character.charCodeAt(0)); }
function u16(value) { return bytes(value >>> 8, value); }
function u32(value) { return bytes(value >>> 24, value >>> 16, value >>> 8, value); }
function box(type, ...payload) {
  const body = concat(...payload);
  return concat(u32(body.byteLength + 8), ascii(type), body);
}
function fullBox(type, ...payload) { return box(type, bytes(0, 0, 0, 0), ...payload); }
function descriptor(tag, payload) { return concat(bytes(tag, payload.byteLength), payload); }

function mp4Fixture() {
  const ftyp = box('ftyp', ascii('isom'), u32(0));
  const media = bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12);
  const mdat = box('mdat', media);
  const mediaOffset = ftyp.byteLength + 8;
  const asc = bytes(0x11, 0x90); // AAC-LC / 48kHz / stereo
  const esdsPayload = descriptor(0x03, concat(
    u16(1), bytes(0),
    descriptor(0x04, concat(bytes(0x40, 0x15), u32(0), u32(0), u32(0), descriptor(0x05, asc)))
  ));
  const esds = fullBox('esds', esdsPayload);
  const mp4a = box('mp4a',
    bytes(0, 0, 0, 0, 0, 0), u16(1),
    u32(0), u32(0), u16(2), u16(16), u16(0), u16(0), u32(48000 << 16),
    esds
  );
  const stsd = fullBox('stsd', u32(1), mp4a);
  const stts = fullBox('stts', u32(1), u32(3), u32(1024));
  const stsc = fullBox('stsc', u32(1), u32(1), u32(3), u32(1));
  const stsz = fullBox('stsz', u32(0), u32(3), u32(4), u32(4), u32(4));
  const stco = fullBox('stco', u32(1), u32(mediaOffset));
  const stbl = box('stbl', stsd, stts, stsc, stsz, stco);
  const minf = box('minf', stbl);
  const mdhd = fullBox('mdhd', u32(0), u32(0), u32(48000), u32(3072), u16(0), u16(0));
  const hdlr = fullBox('hdlr', u32(0), ascii('soun'), new Uint8Array(12), bytes(0));
  const mdia = box('mdia', mdhd, hdlr, minf);
  const trak = box('trak', fullBox('tkhd', u32(0)), mdia);
  const moov = box('moov', fullBox('mvhd', u32(0)), trak);
  return { file: concat(ftyp, mdat, moov), moov, mediaOffset };
}

function rangeFetch(file, calls) {
  return async (_src, options) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
    assert.ok(match, `missing byte range: ${options.headers.Range}`);
    const start = Number(match[1]);
    const requestedEnd = Number(match[2]);
    const end = Math.min(file.byteLength - 1, requestedEnd);
    calls.push({ start, end });
    const chunk = file.slice(start, end + 1);
    return {
      ok: true,
      status: 206,
      headers: { get(name) { return name.toLowerCase() === 'content-range' ? `bytes ${start}-${end}/${file.byteLength}` : null; } },
      async arrayBuffer() { return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength); },
    };
  };
}

test('末尾 moov を Range 取得して AAC sample table を復元する', async () => {
  const fixture = mp4Fixture();
  const calls = [];
  let clock = 10;
  const track = new Mp4AudioTrack({
    src: '/source.mp4',
    fetchFn: rangeFetch(fixture.file, calls),
    now: () => ++clock,
  });
  await track.open();

  assert.equal(track.moovBytes, fixture.moov.byteLength);
  assert.ok(calls.some(call => call.start === fixture.file.byteLength - fixture.moov.byteLength));
  assert.equal(track.info.codec, 'mp4a.40.2');
  assert.equal(track.info.sampleRate, 48000);
  assert.equal(track.info.numberOfChannels, 2);
  assert.deepEqual(Array.from(track.info.description), [0x11, 0x90]);
  assert.deepEqual(track.info.samples, [
    { index: 0, offset: fixture.mediaOffset, size: 4, dts: 0, duration: 1024 },
    { index: 1, offset: fixture.mediaOffset + 4, size: 4, dts: 1024, duration: 1024 },
    { index: 2, offset: fixture.mediaOffset + 8, size: 4, dts: 2048, duration: 1024 },
  ]);

  const window = track.packetsAround(1024 / 48000, 3);
  assert.deepEqual(window.packets.map(packet => packet.index), [0, 1, 2]);
  assert.deepEqual(window.ranges, [{ start: fixture.mediaOffset, end: fixture.mediaOffset + 11 }]);
  assert.equal(window.windowStartSec, 0);
  assert.equal(window.windowEndSec, 3072 / 48000);
});

test('moov 単体の parser も codec と時刻・offset を返す', () => {
  const fixture = mp4Fixture();
  const info = parseMp4AudioTrack(fixture.moov);
  assert.equal(info.timescale, 48000);
  assert.equal(info.samples[1].dts, 1024);
  assert.equal(info.samples[1].offset, fixture.mediaOffset + 4);
});

test('BGM offset は t/in を反映し、loop と範囲外を区別する', () => {
  assert.equal(resolveBgmOffset(8, { t: 5, in: 2, loop: false }, 10), 5);
  assert.equal(resolveBgmOffset(15, { t: 5, in: 2, loop: true }, 10), 2);
  assert.equal(resolveBgmOffset(15, { t: 5, in: 2, loop: false }, 10), null);
  assert.equal(resolveBgmOffset(2, { t: 5, in: 1, loop: false }, 10), null);
});

function gainParam({ cancelAndHold = true, events = null } = {}) {
  const param = {
    value: 1,
    calls: [],
    cancelScheduledValues(at) { this.calls.push(['cancelScheduledValues', at]); events?.push(['cancelScheduledValues', at]); },
    setValueAtTime(value, at) { this.value = value; this.calls.push(['setValueAtTime', value, at]); events?.push(['setValueAtTime', value, at]); },
    linearRampToValueAtTime(value, at) { this.value = value; this.calls.push(['linearRampToValueAtTime', value, at]); events?.push(['linearRampToValueAtTime', value, at]); },
  };
  if (cancelAndHold) {
    param.cancelAndHoldAtTime = function (at) {
      this.calls.push(['cancelAndHoldAtTime', at]);
      events?.push(['cancelAndHoldAtTime', at]);
    };
  }
  return param;
}

function fakeAudioContext(options = {}) {
  const sources = [];
  const gains = [];
  const context = {
    currentTime: 3,
    state: 'suspended',
    destination: { name: 'destination' },
    resumeCalls: 0,
    async resume() { this.resumeCalls++; this.state = 'running'; },
    createMediaElementSource() { return { connect() {} }; },
    createGain() {
      const gain = { gain: gainParam(options), connect() {} };
      gains.push(gain);
      return gain;
    },
    createBufferSource() {
      const source = {
        starts: [], stops: [],
        connect() {},
        start(...args) { this.starts.push(args); },
        stop(...args) { this.stops.push(args); },
      };
      sources.push(source);
      return source;
    },
    createBuffer(channels, frames, sampleRate) {
      const planes = Array.from({ length: channels }, () => new Float32Array(frames));
      return {
        duration: frames / sampleRate,
        getChannelData(channel) { return planes[channel]; },
      };
    },
  };
  return { context, sources, gains };
}

function fakeVideo(events = null) {
  const video = new EventTarget();
  Object.assign(video, {
    currentTime: 0,
    currentSrc: '/source.mp4',
    src: '/source.mp4',
    volume: 0.75,
    paused: true,
    playCalls: 0,
    pauseCalls: 0,
    async play() { this.playCalls++; this.paused = false; events?.push(['play']); },
    pause() { this.pauseCalls++; this.paused = true; events?.push(['pause']); },
  });
  return video;
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('off は seek 時に context・BGM・fetch・decoderへ触らない', () => {
  let nowCalls = 0;
  let bgmCalls = 0;
  let fetchCalls = 0;
  const rawContext = {};
  const context = new Proxy(rawContext, { get(target, key) { throw new Error(`context touched: ${String(key)}`); } });
  const controller = createScrubAudioController({
    audioContext: context,
    video: {},
    getBgm() { bgmCalls++; return {}; },
    fetchFn() { fetchCalls++; },
    now() { nowCalls++; return 0; },
    AudioDecoderCtor: class { constructor() { throw new Error('decoder touched'); } },
  });

  controller.onSeek({ outputTime: 1, sourceTime: 1, src: '/source.mp4', isPlaying: false });
  assert.equal(nowCalls, 0);
  assert.equal(bgmCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(controller.stats().summary.count, 0);
});

test('通常再生中の seek は playing として記録して何も鳴らさない', () => {
  const { context, sources } = fakeAudioContext();
  const controller = createScrubAudioController({ audioContext: context, video: fakeVideo(), getBgm: () => ({}) });
  controller.mode = 'A';
  controller.onSeek({ outputTime: 1, sourceTime: 1, src: '/source.mp4', isPlaying: true });
  assert.equal(controller.stats().seeks[0].skipped, 'playing');
  assert.equal(context.resumeCalls, 0);
  assert.equal(sources.length, 0);
});

test('A は seeked 後に本編と BGM 断片を鳴らし、次の seek では BGM だけを止める', async () => {
  const { context, sources } = fakeAudioContext();
  const video = fakeVideo();
  const bgmNode = { _buffer: { duration: 10 }, name: 'bgm-gain' };
  let clock = 100;
  const controller = createScrubAudioController({
    audioContext: context,
    video,
    getBgm: () => ({ node: bgmNode, spec: { t: 2, in: 1, loop: true } }),
    now: () => ++clock,
  });
  controller.mode = 'A';
  video.currentTime = 5;
  controller.onSeek({ outputTime: 5, sourceTime: 5, src: '/source.mp4', isPlaying: false });
  assert.equal(video.playCalls, 0);
  video.dispatchEvent(new Event('seeked'));
  video.dispatchEvent(new Event('playing'));
  await settle();

  assert.equal(context.resumeCalls, 1);
  assert.equal(video.playCalls, 1);
  assert.equal(sources.length, 1);
  assert.deepEqual(sources[0].starts, [[3.005, 4, 0.04]]);
  const first = controller.stats().seeks[0];
  assert.equal(first.bgmOffsetSec, 4);
  assert.equal(first.mainStartedCtxSec, 3);
  assert.equal(first.skipped, null);

  video.currentTime = 6;
  controller.onSeek({ outputTime: 6, sourceTime: 6, src: '/source.mp4', isPlaying: false });
  assert.equal(sources[0].stops.length, 1);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(video.pauseCalls, 0);
  video.dispatchEvent(new Event('seeked'));
  await settle();
  assert.equal(sources.length, 2);
  assert.deepEqual(sources[1].starts, [[3.005, 5, 0.04]]);
  assert.equal(controller.stats().summary.played, 2);
});

test('B は DOM に付けない audio を一つだけ作り、seeked 後に再生する', async () => {
  const { context } = fakeAudioContext();
  const video = fakeVideo();
  const audio = fakeVideo();
  audio.src = '';
  audio.currentSrc = '';
  let createCalls = 0;
  const controller = createScrubAudioController({
    audioContext: context,
    video,
    getBgm: () => ({}),
    createAudioElement() { createCalls++; return audio; },
  });
  controller.mode = 'B';
  controller.onSeek({ outputTime: 7, sourceTime: 7, src: '/source.mp4', isPlaying: false });
  assert.equal(createCalls, 1);
  assert.equal(audio.preload, 'auto');
  assert.equal(audio.crossOrigin, 'anonymous');
  assert.equal(audio.volume, video.volume);
  audio.dispatchEvent(new Event('loadeddata'));
  audio.dispatchEvent(new Event('seeked'));
  await settle();
  audio.dispatchEvent(new Event('playing'));
  await settle();
  assert.equal(audio.playCalls, 1);
  assert.equal(controller.stats().summary.played, 1);

  controller.onSeek({ outputTime: 8, sourceTime: 8, src: '/source.mp4', isPlaying: false });
  assert.equal(createCalls, 1);
});

test('C は 5 ms 先を基準に fade in/out と start を予約する', async () => {
  const fixture = mp4Fixture();
  const { context, sources, gains } = fakeAudioContext();
  class FakeChunk { constructor(init) { Object.assign(this, init); } }
  class FakeDecoder {
    static async isConfigSupported(config) { return { supported: true, config }; }
    constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.chunks = []; }
    configure() { this.state = 'configured'; }
    decode(chunk) { this.chunks.push(chunk); }
    async flush() {
      for (const chunk of this.chunks.splice(0)) this.callbacks.output({
        timestamp: chunk.timestamp, numberOfChannels: 1, numberOfFrames: 3072, sampleRate: 48000,
        copyTo(target) { target.fill(0.1); }, close() {},
      });
    }
    close() { this.state = 'closed'; }
  }
  const controller = createScrubAudioController({
    audioContext: context,
    video: {},
    getBgm: () => ({}),
    fetchFn: rangeFetch(fixture.file, []),
    AudioDecoderCtor: FakeDecoder,
    EncodedAudioChunkCtor: FakeChunk,
  });
  controller.mode = 'C';
  controller.onSeek({ outputTime: 0.01, sourceTime: 0.01, src: '/source.mp4', isPlaying: false });
  while (controller.stats().summary.played < 1 && controller.stats().summary.errors === 0) {
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.deepEqual(sources[0].starts, [[3.005, 0.01, 0.04]]);
  assert.deepEqual(gains[0].gain.calls, [
    ['setValueAtTime', 0, 3.005],
    ['linearRampToValueAtTime', 1, 3.01],
    ['setValueAtTime', 1, 3.04],
    ['linearRampToValueAtTime', 0, 3.045],
  ]);
});

test('連続 C seek は hold 対応時に将来値を保持してから fade out と stop を予約する', async () => {
  const fixture = mp4Fixture();
  const { context, sources, gains } = fakeAudioContext();
  class FakeChunk { constructor(init) { Object.assign(this, init); } }
  class FakeDecoder {
    constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.chunks = []; }
    configure() { this.state = 'configured'; }
    decode(chunk) { this.chunks.push(chunk); }
    async flush() {
      for (const chunk of this.chunks.splice(0)) this.callbacks.output({
        timestamp: chunk.timestamp, numberOfChannels: 1, numberOfFrames: 3072, sampleRate: 48000,
        copyTo() {}, close() {},
      });
    }
    close() { this.state = 'closed'; }
  }
  const controller = createScrubAudioController({
    audioContext: context, video: {}, getBgm: () => ({}),
    fetchFn: rangeFetch(fixture.file, []), AudioDecoderCtor: FakeDecoder, EncodedAudioChunkCtor: FakeChunk,
  });
  controller.mode = 'C';
  controller.onSeek({ outputTime: 0.01, sourceTime: 0.01, src: '/source.mp4', isPlaying: false });
  while (controller.stats().summary.played < 1) await new Promise(resolve => setImmediate(resolve));
  context.currentTime = 3.015;
  controller.onSeek({ outputTime: 0.02, sourceTime: 0.02, src: '/source.mp4', isPlaying: false });

  assert.deepEqual(gains[0].gain.calls.slice(-3), [
    ['cancelAndHoldAtTime', 3.02],
    ['setValueAtTime', 1, 3.02],
    ['linearRampToValueAtTime', 0, 3.025],
  ]);
  assert.deepEqual(sources[0].stops, [[3.025]]);
});

test('C は自然 fade out 開始後の連続 seek で停止イベントを追加しない', async () => {
  const fixture = mp4Fixture();
  const { context, sources, gains } = fakeAudioContext();
  class FakeChunk { constructor(init) { Object.assign(this, init); } }
  class FakeDecoder {
    constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.chunks = []; }
    configure() { this.state = 'configured'; }
    decode(chunk) { this.chunks.push(chunk); }
    async flush() {
      for (const chunk of this.chunks.splice(0)) this.callbacks.output({
        timestamp: chunk.timestamp, numberOfChannels: 1, numberOfFrames: 3072, sampleRate: 48000,
        copyTo() {}, close() {},
      });
    }
    close() { this.state = 'closed'; }
  }
  const controller = createScrubAudioController({
    audioContext: context, video: {}, getBgm: () => ({}),
    fetchFn: rangeFetch(fixture.file, []), AudioDecoderCtor: FakeDecoder, EncodedAudioChunkCtor: FakeChunk,
  });
  controller.mode = 'C';
  controller.onSeek({ outputTime: 0.01, sourceTime: 0.01, src: '/source.mp4', isPlaying: false });
  while (controller.stats().summary.played < 1) await new Promise(resolve => setImmediate(resolve));
  const callsBefore = gains[0].gain.calls.length;
  context.currentTime = 3.038;
  controller.onSeek({ outputTime: 0.02, sourceTime: 0.02, src: '/source.mp4', isPlaying: false });

  assert.equal(gains[0].gain.calls.length, callsBefore);
  assert.deepEqual(sources[0].stops, []);
});

test('C は開始前に supersede された断片を startAt で止めて鳴らさない', async () => {
  const fixture = mp4Fixture();
  const { context, sources, gains } = fakeAudioContext();
  class FakeChunk { constructor(init) { Object.assign(this, init); } }
  class FakeDecoder {
    constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.chunks = []; }
    configure() { this.state = 'configured'; }
    decode(chunk) { this.chunks.push(chunk); }
    async flush() {
      for (const chunk of this.chunks.splice(0)) this.callbacks.output({
        timestamp: chunk.timestamp, numberOfChannels: 1, numberOfFrames: 3072, sampleRate: 48000,
        copyTo() {}, close() {},
      });
    }
    close() { this.state = 'closed'; }
  }
  const controller = createScrubAudioController({
    audioContext: context, video: {}, getBgm: () => ({}),
    fetchFn: rangeFetch(fixture.file, []), AudioDecoderCtor: FakeDecoder, EncodedAudioChunkCtor: FakeChunk,
  });
  controller.mode = 'C';
  controller.onSeek({ outputTime: 0.01, sourceTime: 0.01, src: '/source.mp4', isPlaying: false });
  while (controller.stats().summary.played < 1) await new Promise(resolve => setImmediate(resolve));
  controller.onSeek({ outputTime: 0.02, sourceTime: 0.02, src: '/source.mp4', isPlaying: false });

  assert.deepEqual(gains[0].gain.calls.slice(-2), [
    ['cancelScheduledValues', 0], ['setValueAtTime', 0, 0],
  ]);
  assert.deepEqual(sources[0].stops, [[3.005]]);
});

test('連続 C seek は hold 非対応時に cancel + set へフォールバックする', async () => {
  const fixture = mp4Fixture();
  const { context, sources, gains } = fakeAudioContext({ cancelAndHold: false });
  class FakeChunk { constructor(init) { Object.assign(this, init); } }
  class FakeDecoder {
    constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.chunks = []; }
    configure() { this.state = 'configured'; }
    decode(chunk) { this.chunks.push(chunk); }
    async flush() {
      for (const chunk of this.chunks.splice(0)) this.callbacks.output({
        timestamp: chunk.timestamp, numberOfChannels: 1, numberOfFrames: 3072, sampleRate: 48000,
        copyTo() {}, close() {},
      });
    }
    close() { this.state = 'closed'; }
  }
  const controller = createScrubAudioController({
    audioContext: context, video: {}, getBgm: () => ({}),
    fetchFn: rangeFetch(fixture.file, []), AudioDecoderCtor: FakeDecoder, EncodedAudioChunkCtor: FakeChunk,
  });
  controller.mode = 'C';
  controller.onSeek({ outputTime: 0.01, sourceTime: 0.01, src: '/source.mp4', isPlaying: false });
  while (controller.stats().summary.played < 1) await new Promise(resolve => setImmediate(resolve));
  context.currentTime = 3.015;
  controller.onSeek({ outputTime: 0.02, sourceTime: 0.02, src: '/source.mp4', isPlaying: false });

  assert.deepEqual(gains[0].gain.calls.slice(-3), [
    ['cancelScheduledValues', 3.02], ['setValueAtTime', 1, 3.02], ['linearRampToValueAtTime', 0, 3.025],
  ]);
  assert.deepEqual(sources[0].stops, [[3.025]]);
});

test('B は play 解決後に fade in を置き、停止時は fade out 後に pause する', async () => {
  const events = [];
  const { context, gains } = fakeAudioContext({ events });
  const video = fakeVideo();
  const audio = fakeVideo(events);
  audio.src = '';
  audio.currentSrc = '';
  let resolvePlay;
  audio.play = function () {
    this.playCalls++;
    events.push(['play']);
    return new Promise(resolve => { resolvePlay = resolve; });
  };
  const controller = createScrubAudioController({
    audioContext: context, video, getBgm: () => ({}), createAudioElement: () => audio,
  });
  controller.mode = 'B';
  controller.onSeek({ outputTime: 7, sourceTime: 7, src: '/source.mp4', isPlaying: false });
  audio.dispatchEvent(new Event('loadeddata'));
  audio.dispatchEvent(new Event('seeked'));
  await settle();
  assert.deepEqual(gains[0].gain.calls, [['cancelScheduledValues', 3], ['setValueAtTime', 0, 3]]);
  resolvePlay();
  await settle();
  assert.deepEqual(gains[0].gain.calls, [['cancelScheduledValues', 3], ['setValueAtTime', 0, 3]]);
  audio.dispatchEvent(new Event('playing'));
  await settle();
  assert.deepEqual(gains[0].gain.calls.slice(-2), [['setValueAtTime', 0, 3.005], ['linearRampToValueAtTime', 1, 3.01]]);
  assert.equal(controller.stats().seeks[0].mainStartedCtxSec, 3.005);

  context.currentTime = 3.02;
  controller.stop();
  assert.equal(audio.pauseCalls, 0);
  assert.deepEqual(gains[0].gain.calls.slice(-3), [
    ['cancelAndHoldAtTime', 3.025], ['setValueAtTime', 1, 3.025], ['linearRampToValueAtTime', 0, 3.03],
  ]);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(audio.pauseCalls, 1);
  assert.ok(events.findIndex(event => event[0] === 'linearRampToValueAtTime' && event[1] === 0) < events.findIndex(event => event[0] === 'pause'));
});

test('B は playing が来なくても 100 ms 後に fade in を始める', async () => {
  const { context, gains } = fakeAudioContext();
  const video = fakeVideo();
  const audio = fakeVideo();
  audio.src = '';
  audio.currentSrc = '';
  const controller = createScrubAudioController({
    audioContext: context, video, getBgm: () => ({}), createAudioElement: () => audio,
  });
  controller.mode = 'B';
  controller.onSeek({ outputTime: 7, sourceTime: 7, src: '/source.mp4', isPlaying: false });
  audio.dispatchEvent(new Event('loadeddata'));
  audio.dispatchEvent(new Event('seeked'));
  await new Promise(resolve => setTimeout(resolve, 110));

  assert.deepEqual(gains[0].gain.calls.slice(-2), [
    ['setValueAtTime', 0, 3.005], ['linearRampToValueAtTime', 1, 3.01],
  ]);
  assert.equal(controller.stats().seeks[0].mainStartedCtxSec, 3.005);
});

test('A は main gain を fade out してから pause し、gain を 1 に戻す', async () => {
  const events = [];
  const { context } = fakeAudioContext();
  const video = fakeVideo(events);
  const mainParam = gainParam({ events });
  const controller = createScrubAudioController({
    audioContext: context, video, getBgm: () => ({}), getMainGain: () => ({ gain: mainParam }),
  });
  controller.mode = 'A';
  video.currentTime = 5;
  controller.onSeek({ outputTime: 5, sourceTime: 5, src: '/source.mp4', isPlaying: false });
  video.dispatchEvent(new Event('seeked'));
  await settle();
  assert.deepEqual(mainParam.calls, [
    ['cancelAndHoldAtTime', 3], ['setValueAtTime', 0, 3],
  ]);
  assert.equal(video.playCalls, 1);
  assert.ok(events.findIndex(event => event[0] === 'setValueAtTime' && event[1] === 0) < events.findIndex(event => event[0] === 'play'));
  video.dispatchEvent(new Event('playing'));
  await settle();
  assert.deepEqual(mainParam.calls.slice(-2), [
    ['setValueAtTime', 0, 3.005], ['linearRampToValueAtTime', 1, 3.01],
  ]);
  context.currentTime = 3.02;
  controller.stop();

  assert.deepEqual(mainParam.calls.slice(-3), [
    ['cancelAndHoldAtTime', 3.025], ['setValueAtTime', 1, 3.025], ['linearRampToValueAtTime', 0, 3.03],
  ]);
  assert.equal(video.pauseCalls, 0);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(video.pauseCalls, 1);
  assert.deepEqual(mainParam.calls.at(-1), ['setValueAtTime', 1, 3.02]);
  const pauseIndex = events.findIndex(event => event[0] === 'pause');
  assert.ok(events.findIndex(event => event[0] === 'linearRampToValueAtTime') < pauseIndex);
  assert.ok(pauseIndex < events.findLastIndex(event => event[0] === 'setValueAtTime' && event[1] === 1));
});

test('A は seek による supersede では main gain と video に触れない', async () => {
  const { context } = fakeAudioContext();
  const video = fakeVideo();
  const mainParam = gainParam();
  const controller = createScrubAudioController({
    audioContext: context, video, getBgm: () => ({}), getMainGain: () => ({ gain: mainParam }),
  });
  controller.mode = 'A';
  video.currentTime = 5;
  controller.onSeek({ outputTime: 5, sourceTime: 5, src: '/source.mp4', isPlaying: false });
  video.dispatchEvent(new Event('seeked'));
  await settle();
  video.dispatchEvent(new Event('playing'));
  await settle();
  const gainCalls = mainParam.calls.length;

  video.currentTime = 6;
  controller.onSeek({ outputTime: 6, sourceTime: 6, src: '/source.mp4', isPlaying: false });
  await new Promise(resolve => setTimeout(resolve, 15));

  assert.equal(mainParam.calls.length, gainCalls);
  assert.equal(video.pauseCalls, 0);
});

test('A は断片の自然終了時に fade out、pause、gain 復帰の順で止まる', async () => {
  const events = [];
  const { context } = fakeAudioContext();
  const video = fakeVideo(events);
  const mainParam = gainParam({ events });
  const controller = createScrubAudioController({
    audioContext: context, video, getBgm: () => ({}), getMainGain: () => ({ gain: mainParam }),
  });
  controller.fragmentMs = 5;
  controller.mode = 'A';
  video.currentTime = 5;
  controller.onSeek({ outputTime: 5, sourceTime: 5, src: '/source.mp4', isPlaying: false });
  video.dispatchEvent(new Event('seeked'));
  await settle();
  video.dispatchEvent(new Event('playing'));
  await settle();
  context.currentTime = 3.02;
  await new Promise(resolve => setTimeout(resolve, 20));

  const rampIndex = events.findIndex(event => event[0] === 'linearRampToValueAtTime' && event[1] === 0);
  const pauseIndex = events.findIndex(event => event[0] === 'pause');
  const restoreIndex = events.findLastIndex(event => event[0] === 'setValueAtTime' && event[1] === 1);
  assert.ok(rampIndex >= 0 && rampIndex < pauseIndex && pauseIndex < restoreIndex);
});

test('B は前断片の pause 後に次の currentTime を変更する', async () => {
  const events = [];
  const { context } = fakeAudioContext({ events });
  const video = fakeVideo();
  const audio = fakeVideo(events);
  audio.src = '';
  audio.currentSrc = '';
  let mediaTime = 0;
  Object.defineProperty(audio, 'currentTime', {
    get() { return mediaTime; },
    set(value) { mediaTime = value; events.push(['currentTime', value]); },
    configurable: true,
  });
  const controller = createScrubAudioController({
    audioContext: context, video, getBgm: () => ({}), createAudioElement: () => audio,
  });
  controller.mode = 'B';
  controller.onSeek({ outputTime: 7, sourceTime: 7, src: '/source.mp4', isPlaying: false });
  audio.dispatchEvent(new Event('loadeddata'));
  audio.dispatchEvent(new Event('seeked'));
  await settle();
  audio.dispatchEvent(new Event('playing'));
  await settle();

  controller.onSeek({ outputTime: 8, sourceTime: 8, src: '/source.mp4', isPlaying: false });
  assert.equal(events.filter(event => event[0] === 'currentTime').length, 1);
  await new Promise(resolve => setTimeout(resolve, 15));

  const pauseIndex = events.findIndex(event => event[0] === 'pause');
  const secondSeekIndex = events.findIndex(event => event[0] === 'currentTime' && event[1] === 8);
  assert.ok(pauseIndex >= 0 && pauseIndex < secondSeekIndex);
});

test('C は必要な AAC packet だけ復号し、同じ窓の次 seek は LRU を使う', async () => {
  const fixture = mp4Fixture();
  const calls = [];
  const { context, sources } = fakeAudioContext();
  class FakeChunk {
    constructor(init) { Object.assign(this, init); }
  }
  class FakeDecoder {
    static async isConfigSupported(config) { return { supported: config.codec === 'mp4a.40.2', config }; }
    constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.chunks = []; }
    configure(config) { this.config = config; this.state = 'configured'; }
    decode(chunk) { this.chunks.push(chunk); }
    async flush() {
      for (const chunk of this.chunks.splice(0)) {
        this.callbacks.output({
          timestamp: chunk.timestamp,
          numberOfChannels: 2,
          numberOfFrames: 1024,
          sampleRate: 48000,
          copyTo(target) { target.fill(0.25); },
          close() {},
        });
      }
    }
    close() { this.state = 'closed'; }
  }
  const controller = createScrubAudioController({
    audioContext: context,
    video: {},
    getBgm: () => ({}),
    fetchFn: rangeFetch(fixture.file, calls),
    now: (() => { let value = 0; return () => ++value; })(),
    AudioDecoderCtor: FakeDecoder,
    EncodedAudioChunkCtor: FakeChunk,
  });
  controller.mode = 'C';
  controller.onSeek({ outputTime: 0.02, sourceTime: 0.02, src: '/source.mp4', isPlaying: false });
  while (controller.stats().summary.played < 1 && controller.stats().summary.errors === 0) {
    await new Promise(resolve => setImmediate(resolve));
  }

  const first = controller.stats().seeks[0];
  assert.equal(first.cacheHit, false);
  assert.equal(first.bytes, 12);
  assert.equal(sources.length, 1);
  assert.deepEqual(controller.stats().summary.decoderConfig.description, [0x11, 0x90]);
  const fetchCount = calls.length;

  controller.onSeek({ outputTime: 0.03, sourceTime: 0.03, src: '/source.mp4', isPlaying: false });
  while (controller.stats().summary.played < 2 && controller.stats().summary.errors === 0) {
    await new Promise(resolve => setImmediate(resolve));
  }
  const second = controller.stats().seeks[1];
  assert.equal(second.cacheHit, true);
  assert.equal(second.fetchMs, 0);
  assert.equal(second.decodeMs, 0);
  assert.equal(calls.length, fetchCount);
  assert.equal(sources.length, 2);
});
