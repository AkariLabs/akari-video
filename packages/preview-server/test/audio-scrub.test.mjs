import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createScrubAudioController,
  resolveBgmOffset,
  SCRUB_MODES,
  SCRUB_TUNING,
} from '../public/audio-scrub.js';

function concat(...parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}
const bytes = (...values) => Uint8Array.from(values);
const ascii = value => Uint8Array.from(value, character => character.charCodeAt(0));
const u16 = value => bytes(value >>> 8, value);
const u32 = value => bytes(value >>> 24, value >>> 16, value >>> 8, value);
function box(type, ...payload) {
  const body = concat(...payload);
  return concat(u32(body.byteLength + 8), ascii(type), body);
}
const fullBox = (type, ...payload) => box(type, bytes(0, 0, 0, 0), ...payload);
const descriptor = (tag, payload) => concat(bytes(tag, payload.byteLength), payload);

function mp4Fixture({
  editOffset = null,
  codec = 'mp4a',
  splitChunks = false,
  packetCount = 8,
  interleaveGapBytes = 0,
} = {}) {
  const ftyp = box('ftyp', ascii('isom'), u32(0));
  const interleaved = interleaveGapBytes > 0;
  const media = interleaved
    ? concat(...Array.from({ length: packetCount }, (_, index) => concat(
      bytes(index + 1, index + 1, index + 1, index + 1),
      index + 1 < packetCount ? new Uint8Array(interleaveGapBytes) : new Uint8Array(),
    )))
    : splitChunks
    ? concat(bytes(...Array.from({ length: 16 }, (_, index) => index + 1)), bytes(0, 0, 0, 0),
      bytes(...Array.from({ length: 16 }, (_, index) => index + 17)))
    : bytes(...Array.from({ length: packetCount * 4 }, (_, index) => (index % 255) + 1));
  const mediaOffset = ftyp.byteLength + 8;
  const mdat = box('mdat', media);
  const asc = bytes(0x11, 0x90);
  const esdsPayload = descriptor(0x03, concat(
    u16(1), bytes(0), descriptor(0x04, concat(
      bytes(0x40, 0x15), u32(0), u32(0), u32(0), descriptor(0x05, asc),
    )),
  ));
  const entry = box(codec,
    bytes(0, 0, 0, 0, 0, 0), u16(1),
    u32(0), u32(0), u16(2), u16(16), u16(0), u16(0), u32(48000 << 16),
    ...(codec === 'mp4a' ? [fullBox('esds', esdsPayload)] : []),
  );
  const stsd = fullBox('stsd', u32(1), entry);
  const stts = fullBox('stts', u32(1), u32(packetCount), u32(1024));
  const stsc = fullBox('stsc', u32(1), u32(1), u32(interleaved ? 1 : splitChunks ? 4 : packetCount), u32(1));
  const stsz = fullBox('stsz', u32(0), u32(packetCount), ...Array(packetCount).fill(u32(4)));
  const chunkOffsets = interleaved
    ? Array.from({ length: packetCount }, (_, index) => mediaOffset + index * (4 + interleaveGapBytes))
    : splitChunks ? [mediaOffset, mediaOffset + 20] : [mediaOffset];
  const stco = fullBox('stco', u32(chunkOffsets.length), ...chunkOffsets.map(u32));
  const stbl = box('stbl', stsd, stts, stsc, stsz, stco);
  const mdhd = fullBox('mdhd', u32(0), u32(0), u32(48000), u32(8192), u16(0), u16(0));
  const hdlr = fullBox('hdlr', u32(0), ascii('soun'), new Uint8Array(12), bytes(0));
  const edts = editOffset === null ? new Uint8Array() : box('edts', fullBox(
    'elst', u32(1), u32(1000), u32(editOffset), u16(1), u16(0),
  ));
  const trak = box('trak', fullBox('tkhd', u32(0)), edts, box('mdia', mdhd, hdlr, box('minf', stbl)));
  const mvhd = fullBox('mvhd', u32(0), u32(0), u32(1000), u32(1000));
  const moov = box('moov', mvhd, trak);
  return { file: concat(ftyp, mdat, moov), mediaOffset, secondChunkOffset: chunkOffsets[1] };
}

function rangeFetch(file, calls = [], gate = null, failPackets = false) {
  return async (_src, options) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
    assert.ok(match);
    const start = Number(match[1]);
    if (gate && start === file.byteLength - gate.moovBytes) await gate.promise;
    if (failPackets && start < file.byteLength - gate.moovBytes && start >= gate.mediaOffset) throw new Error('packet fetch failed');
    const end = Math.min(file.byteLength - 1, Number(match[2]));
    calls.push({ start, end });
    const chunk = file.slice(start, end + 1);
    return {
      status: 206,
      headers: { get: name => name.toLowerCase() === 'content-range' ? `bytes ${start}-${end}/${file.byteLength}` : null },
      arrayBuffer: async () => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
    };
  };
}

function gainParam(cancelAndHold = true) {
  const param = {
    _value: 1,
    calls: [],
    cancelScheduledValues(at) { this.calls.push(['cancelScheduledValues', at]); },
    setValueAtTime(value, at) { this._value = value; this.calls.push(['setValueAtTime', value, at]); },
    linearRampToValueAtTime(value, at) { this._value = value; this.calls.push(['linearRampToValueAtTime', value, at]); },
  };
  Object.defineProperty(param, 'value', {
    get() { return this._value; },
    set(value) { this._value = value; this.calls.push(['value', value]); },
  });
  if (cancelAndHold) param.cancelAndHoldAtTime = function (at) { this.calls.push(['cancelAndHoldAtTime', at]); };
  return param;
}

function fakeAudioContext({ cancelAndHold = true } = {}) {
  const sources = [];
  const gains = [];
  const context = {
    currentTime: 3,
    state: 'suspended',
    destination: { name: 'destination' },
    resumeCalls: 0,
    suspendCalls: 0,
    async resume() { this.resumeCalls++; this.state = 'running'; },
    async suspend() { this.suspendCalls++; this.state = 'suspended'; },
    createGain() {
      const gain = { gain: gainParam(cancelAndHold), destinations: [], connect(node) { this.destinations.push(node); } };
      gains.push(gain);
      return gain;
    },
    createBufferSource() {
      const source = {
        starts: [], stops: [], destinations: [],
        connect(node) { this.destinations.push(node); },
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
        numberOfChannels: channels,
        length: frames,
        getChannelData: channel => planes[channel],
      };
    },
  };
  return { context, sources, gains };
}

class FakeChunk { constructor(init) { Object.assign(this, init); } }
class FakeDecoder {
  static supportCalls = 0;
  static supported = true;
  static async isConfigSupported(config) {
    this.supportCalls++;
    return { supported: this.supported, config };
  }
  constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.chunks = []; }
  configure(config) { this.config = config; this.state = 'configured'; }
  decode(chunk) { this.chunks.push(chunk); }
  async flush() {
    for (const chunk of this.chunks.splice(0)) this.callbacks.output({
      timestamp: chunk.timestamp,
      numberOfChannels: 2,
      numberOfFrames: 1024,
      sampleRate: 48000,
      copyTo(target) { target.fill(0.25); },
      close() {},
    });
  }
  close() { this.state = 'closed'; }
}

async function until(predicate) {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('condition was not reached');
}

function controllerFixture(options = {}) {
  const fixture = options.fixture ?? mp4Fixture();
  const calls = [];
  const audio = fakeAudioContext({ cancelAndHold: options.cancelAndHold });
  const video = options.video ?? { volume: 0.75, muted: false };
  const controller = createScrubAudioController({
    audioContext: audio.context,
    video,
    getBgm: options.getBgm ?? (() => ({})),
    fetchFn: options.fetchFn ?? rangeFetch(fixture.file, calls),
    now: options.now ?? (() => { let value = 0; return () => (value += 100); })(),
    AudioDecoderCtor: options.Decoder ?? FakeDecoder,
    EncodedAudioChunkCtor: FakeChunk,
    setTimeoutFn: options.setTimeoutFn ?? (() => 1),
    clearTimeoutFn: options.clearTimeoutFn ?? (() => {}),
    idleSuspendMs: options.idleSuspendMs,
    tuning: options.tuning,
    maxCacheBytes: options.maxCacheBytes,
    AbortControllerCtor: options.AbortControllerCtor,
  });
  return { fixture, calls, audio, video, controller };
}

async function prepareAndSeek(bundle, input = {}) {
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 0.04, sourceTime: 0.04, src: '/source.mp4', isPlaying: false, ...input });
  await until(() => bundle.audio.sources.length > 0 || bundle.controller.lastError);
}

test('公開 mode は off/on のみで既定 ON', () => {
  const { controller } = controllerFixture();
  assert.deepEqual(SCRUB_MODES, ['off', 'on']);
  assert.equal(controller.enabled, true);
  assert.equal(controller.mode, 'on');
  controller.mode = 'off';
  assert.equal(controller.active, false);
  assert.throws(() => { controller.mode = 'C'; }, TypeError);
});

test('off の seek は依存へ一切触らない', () => {
  const touched = name => new Proxy({}, { get() { throw new Error(`${name} touched`); } });
  const controller = createScrubAudioController({
    audioContext: touched('context'), video: touched('video'), getBgm() { throw new Error('BGM touched'); },
    fetchFn() { throw new Error('fetch touched'); }, now() { throw new Error('now touched'); }, enabled: false,
  });
  controller.onSeek({ outputTime: 0, sourceTime: 0, src: '/x', isPlaying: false });
  assert.equal(controller.lastError, null);
});

test('通常再生中は鳴らさず resume しない', async () => {
  const bundle = controllerFixture();
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 0, sourceTime: 0, src: '/source.mp4', isPlaying: true });
  assert.equal(bundle.audio.context.resumeCalls, 0);
  assert.equal(bundle.audio.sources.length, 0);
});

test('5ms 先へ volume を頂点にした fade と断片を予約する', async () => {
  const bundle = controllerFixture();
  await prepareAndSeek(bundle);
  const source = bundle.audio.sources[0];
  const gain = bundle.audio.gains[0].gain;
  assert.deepEqual(source.starts[0], [3.005, 0.04, 0.04]);
  assert.deepEqual(gain.calls, [
    ['value', 0],
    ['setValueAtTime', 0, 3.005],
    ['linearRampToValueAtTime', 0.75, 3.01],
    ['setValueAtTime', 0.75, 3.04],
    ['linearRampToValueAtTime', 0, 3.045],
  ]);
});

test('本編と BGM はどちらも automation より前に gain 既定値をゼロにする', async () => {
  const bgmNode = { _buffer: { duration: 10 } };
  const bundle = controllerFixture({
    getBgm: () => ({ node: bgmNode, spec: { t: 0, in: 0, loop: true } }),
  });
  await prepareAndSeek(bundle);
  assert.equal(bundle.audio.sources.length, 2);
  assert.deepEqual(bundle.audio.gains.map(gain => gain.gain.calls.slice(0, 2)), [
    [['value', 0], ['setValueAtTime', 0, 3.005]],
    [['value', 0], ['setValueAtTime', 0, 3.005]],
  ]);
});

test('連続 seek は現在値をアンカーに fade stop する', async () => {
  const bundle = controllerFixture();
  await prepareAndSeek(bundle);
  bundle.audio.context.currentTime = 3.015;
  bundle.controller.onSeek({ outputTime: 0.05, sourceTime: 0.05, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.audio.sources.length === 2);
  assert.deepEqual(bundle.audio.gains[0].gain.calls.slice(-3), [
    ['cancelAndHoldAtTime', 3.02], ['setValueAtTime', 0.75, 3.02], ['linearRampToValueAtTime', 0, 3.025],
  ]);
  assert.deepEqual(bundle.audio.sources[0].stops, [[3.025]]);
});

test('開始前に supersede された断片は開始予定時刻で止める', async () => {
  const bundle = controllerFixture();
  await prepareAndSeek(bundle);
  bundle.controller.onSeek({ outputTime: 0.05, sourceTime: 0.05, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.audio.sources.length === 2);
  assert.deepEqual(bundle.audio.gains[0].gain.calls.slice(-2), [
    ['cancelScheduledValues', 0], ['setValueAtTime', 0, 0],
  ]);
  assert.deepEqual(bundle.audio.sources[0].stops, [[3.005]]);
});

test('自然 fade out に入った断片へ停止イベントを追加しない', async () => {
  const bundle = controllerFixture();
  await prepareAndSeek(bundle);
  bundle.audio.context.currentTime = 3.04;
  bundle.controller.onSeek({ outputTime: 0.05, sourceTime: 0.05, src: '/source.mp4', isPlaying: false });
  assert.deepEqual(bundle.audio.sources[0].stops, []);
});

test('cancelAndHoldAtTime 非対応時も現在値アンカーへフォールバックする', async () => {
  const bundle = controllerFixture({ cancelAndHold: false });
  await prepareAndSeek(bundle);
  bundle.audio.context.currentTime = 3.015;
  bundle.controller.onSeek({ outputTime: 0.05, sourceTime: 0.05, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.audio.sources.length === 2);
  assert.deepEqual(bundle.audio.gains[0].gain.calls.slice(-3), [
    ['cancelScheduledValues', 3.02], ['setValueAtTime', 0.75, 3.02], ['linearRampToValueAtTime', 0, 3.025],
  ]);
});

test('同じ提示時刻 window の次 seek は packet を再取得しない', async () => {
  const bundle = controllerFixture();
  await prepareAndSeek(bundle);
  const fetched = bundle.calls.length;
  bundle.controller.onSeek({ outputTime: 0.045, sourceTime: 0.045, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.audio.sources.length === 2);
  assert.equal(bundle.calls.length, fetched);
});

test('LRU は 40ms を収められる中央だけヒットし窓末尾では再取得する', async () => {
  const bundle = controllerFixture();
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 0.02, sourceTime: 0.02, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.audio.sources.length === 1);
  const firstFetchCount = bundle.calls.length;

  bundle.controller.onSeek({ outputTime: 0.023, sourceTime: 0.023, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.audio.sources.length === 2);
  assert.equal(bundle.calls.length, firstFetchCount);

  bundle.controller.onSeek({ outputTime: 0.1, sourceTime: 0.1, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.audio.sources.length === 3);
  assert.ok(bundle.calls.length > firstFetchCount);
  assert.equal(bundle.audio.sources[2].starts[0][2], 0.04);
});

test('複数 packet Range は先頭の完了を待たず並列に取得する', async () => {
  const fixture = mp4Fixture({ packetCount: 8, interleaveGapBytes: 2048 });
  const calls = [];
  const packetStarts = [];
  let releaseFirst;
  const firstPending = new Promise(resolve => { releaseFirst = resolve; });
  const baseFetch = rangeFetch(fixture.file, calls);
  const fetchFn = async (src, options) => {
    const start = Number(/^bytes=(\d+)-/.exec(options.headers.Range)[1]);
    if (start === fixture.mediaOffset + 2 * (4 + 2048)
      || start === fixture.mediaOffset + 3 * (4 + 2048)) {
      packetStarts.push(start);
      if (packetStarts.length === 1) await firstPending;
    }
    return baseFetch(src, options);
  };
  const bundle = controllerFixture({ fixture, fetchFn });
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({
    outputTime: 3 * 1024 / 48000,
    sourceTime: 3 * 1024 / 48000,
    src: '/source.mp4',
    isPlaying: false,
  });
  await until(() => packetStarts.length === 2);
  releaseFirst();
  await until(() => bundle.audio.sources.length === 1);
  assert.deepEqual(packetStarts, [
    fixture.mediaOffset + 2 * (4 + 2048),
    fixture.mediaOffset + 3 * (4 + 2048),
  ]);
});

test('追い越された decode の close エラーは lastError に残さない', async () => {
  class RacingDecoder {
    static instances = [];
    static async isConfigSupported(config) { return { supported: true, config }; }
    constructor(callbacks) {
      this.callbacks = callbacks;
      this.state = 'unconfigured';
      this.chunks = [];
      this.id = RacingDecoder.instances.length;
      RacingDecoder.instances.push(this);
    }
    configure() { this.state = 'configured'; }
    decode(chunk) { this.chunks.push(chunk); }
    flush() {
      if (this.id === 0) return new Promise((_resolve, reject) => { this.rejectFlush = reject; });
      for (const chunk of this.chunks.splice(0)) this.callbacks.output({
        timestamp: chunk.timestamp,
        numberOfChannels: 2,
        numberOfFrames: 1024,
        sampleRate: 48000,
        copyTo(target) { target.fill(0.25); },
        close() {},
      });
      return Promise.resolve();
    }
    close() {
      this.state = 'closed';
      this.rejectFlush?.(new Error('decoder closed by newer seek'));
    }
  }
  const bundle = controllerFixture({ Decoder: RacingDecoder, fixture: mp4Fixture({ packetCount: 64 }) });
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 0.02, sourceTime: 0.02, src: '/source.mp4', isPlaying: false });
  await until(() => RacingDecoder.instances[0]?.rejectFlush);
  bundle.controller.onSeek({ outputTime: 0.5, sourceTime: 0.5, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.audio.sources.length === 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bundle.controller.lastError, null);
});

test('elst offset を decoded window の提示開始へ適用する', async () => {
  const bundle = controllerFixture({ fixture: mp4Fixture({ editOffset: 1024 }) });
  await bundle.controller.prepare('/source.mp4');
  const sourceTime = 2 * 1024 / 48000;
  bundle.controller.onSeek({ outputTime: sourceTime, sourceTime, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.audio.sources.length === 1);
  assert.equal(bundle.audio.sources[0].starts[0][1], 1024 / 48000);
});

test('isConfigSupported false は src ごとに記録し packet/decoder を再試行しない', async () => {
  class Unsupported extends FakeDecoder {}
  Unsupported.supportCalls = 0;
  Unsupported.supported = false;
  const bundle = controllerFixture({ Decoder: Unsupported });
  await bundle.controller.prepare('/source.mp4');
  const moovCalls = bundle.calls.length;
  bundle.controller.onSeek({ outputTime: 0, sourceTime: 0, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.controller.lastError !== null);
  assert.match(bundle.controller.lastError, /mp4a\.40\.2/);
  bundle.controller.onSeek({ outputTime: 0.02, sourceTime: 0.02, src: '/source.mp4', isPlaying: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(Unsupported.supportCalls, 1);
  assert.equal(bundle.calls.length, moovCalls);
  assert.equal(bundle.audio.sources.length, 0);
});

test('未対応 sample entry は decoder と packet fetch へ進まない', async () => {
  class Decoder extends FakeDecoder {}
  Decoder.supportCalls = 0;
  const bundle = controllerFixture({ fixture: mp4Fixture({ codec: 'Opus' }), Decoder });
  await bundle.controller.prepare('/source.mp4');
  const moovCalls = bundle.calls.length;
  bundle.controller.onSeek({ outputTime: 0, sourceTime: 0, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.controller.lastError !== null);
  assert.equal(bundle.controller.lastError, 'unsupported audio codec: Opus');
  assert.equal(Decoder.supportCalls, 0);
  assert.equal(bundle.calls.length, moovCalls);
});

test('prepare 中の seek は鳴らず、同じ src の moov は一度だけ開く', async () => {
  const fixture = mp4Fixture();
  let release;
  const gate = { moovBytes: 0, promise: new Promise(resolve => { release = resolve; }) };
  // 最後の box が moov なので、先に末尾ヘッダからサイズを得る。
  const view = new DataView(fixture.file.buffer);
  let offset = 0;
  while (offset < fixture.file.byteLength) {
    const size = view.getUint32(offset);
    if (String.fromCharCode(...fixture.file.slice(offset + 4, offset + 8)) === 'moov') gate.moovBytes = size;
    offset += size;
  }
  const calls = [];
  const bundle = controllerFixture({ fixture, fetchFn: rangeFetch(fixture.file, calls, gate) });
  const first = bundle.controller.prepare('/source.mp4');
  const second = bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 0, sourceTime: 0, src: '/source.mp4', isPlaying: false });
  assert.equal(bundle.audio.sources.length, 0);
  release();
  await Promise.all([first, second]);
  bundle.controller.onSeek({ outputTime: 0, sourceTime: 0, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.audio.sources.length === 1);
  assert.equal(calls.filter(call => (
    call.start === fixture.file.byteLength - gate.moovBytes
      && call.end - call.start + 1 === gate.moovBytes
  )).length, 1);
});

test('muted または volume 0 では本編も BGM も鳴らない', async () => {
  for (const video of [{ volume: 0.4, muted: true }, { volume: 0, muted: false }]) {
    let bgmCalls = 0;
    const bundle = controllerFixture({ video, getBgm: () => { bgmCalls++; return {}; } });
    await bundle.controller.prepare('/source.mp4');
    bundle.controller.onSeek({ outputTime: 0, sourceTime: 0, src: '/source.mp4', isPlaying: false });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(bundle.audio.sources.length, 0);
    assert.equal(bgmCalls, 0);
  }
});

test('idle suspend は再武装され stop/disabled で解除される', async () => {
  const timers = new Map();
  let id = 0;
  const cleared = [];
  const bundle = controllerFixture({
    setTimeoutFn(fn, ms) { const key = ++id; timers.set(key, { fn, ms }); return key; },
    clearTimeoutFn(key) { cleared.push(key); timers.delete(key); },
  });
  bundle.audio.context.state = 'running';
  bundle.controller.onPlaybackPaused();
  assert.equal([...timers.values()][0].ms, 30000);
  const first = [...timers.keys()][0];
  bundle.controller.onPlaybackPaused();
  assert.ok(cleared.includes(first));
  const armedKey = [...timers.keys()][0];
  const armed = timers.get(armedKey);
  timers.delete(armedKey);
  armed.fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bundle.audio.context.suspendCalls, 1);
  bundle.controller.onPlaybackPaused();
  bundle.controller.stop();
  assert.equal(timers.size, 0);
  bundle.controller.onPlaybackPaused();
  bundle.controller.enabled = false;
  assert.equal(timers.size, 0);
});

test('suspend 後の seek で resume し video の再生 API に触らない', async () => {
  const video = new Proxy({ volume: 0.4, muted: false }, {
    get(target, key) {
      if (!['volume', 'muted'].includes(String(key))) throw new Error(`unexpected video read: ${String(key)}`);
      return target[key];
    },
    set() { throw new Error('unexpected video write'); },
  });
  const bundle = controllerFixture({ video });
  await prepareAndSeek(bundle);
  assert.equal(bundle.audio.context.resumeCalls, 1);
  assert.ok(bundle.audio.gains[0].gain.calls.some(call => call[1] === 0.4));
});

test('async fetch 失敗は lastError に残り外へ throw しない', async () => {
  const fixture = mp4Fixture();
  const calls = [];
  // packet 範囲だけ失敗させ、moov の先読みは成功させる。
  const moovOffset = (() => {
    const view = new DataView(fixture.file.buffer);
    let offset = 0;
    while (offset < fixture.file.byteLength) {
      const size = view.getUint32(offset);
      if (String.fromCharCode(...fixture.file.slice(offset + 4, offset + 8)) === 'moov') return offset;
      offset += size;
    }
  })();
  const fetchFn = async (src, options) => {
    const start = Number(/^bytes=(\d+)-/.exec(options.headers.Range)[1]);
    if (start >= fixture.mediaOffset && start < moovOffset) throw new Error('packet fetch failed');
    return rangeFetch(fixture.file, calls)(src, options);
  };
  const bundle = controllerFixture({ fixture, fetchFn });
  await bundle.controller.prepare('/source.mp4');
  assert.doesNotThrow(() => bundle.controller.onSeek({
    outputTime: 0, sourceTime: 0, src: '/source.mp4', isPlaying: false,
  }));
  await until(() => bundle.controller.lastError !== null);
  assert.equal(bundle.controller.lastError, 'packet fetch failed');
});

test('高速スクラブの調整定数と 8 MB キャッシュ上限を公開する', () => {
  assert.deepEqual(SCRUB_TUNING, {
    maxCacheBytes: 8 * 1024 * 1024,
    minWindowSec: 0.15,
    maxWindowSec: 0.30,
    maxRangesPerWindow: 12,
    maxRangeGapBytes: 1024,
    leadSec: 0.05,
    minFragmentIntervalMs: 70,
    fastSpeedEnterRatio: 25,
    fastSpeedExitRatio: 18,
    velocitySamples: 5,
    timingEwmaAlpha: 0.3,
  });
  const { controller } = controllerFixture({ maxCacheBytes: 16 * 1024 * 1024 });
  assert.equal(controller.tuning.maxCacheBytes, 8 * 1024 * 1024);
  assert.equal(controller.lastWindowRanges, 0);
  assert.equal(controller.lastWindowSec, 0);
  assert.equal(controller.seekIntervalMs, 50);
  assert.equal(controller.deliveryMs, 0);
  assert.equal(controller.throttledSeeks, 0);
  assert.equal(controller.coalescedSeeks, 0);
});

test('速度は向き付きで推定し src 切替で履歴をリセットする', async () => {
  let wallMs = 0;
  const bundle = controllerFixture({
    fixture: mp4Fixture({ packetCount: 512 }),
    now: () => wallMs,
    tuning: { velocitySamples: 2, fastSpeedEnterRatio: 1000 },
  });
  await bundle.controller.prepare(['/source.mp4', '/other.mp4']);
  bundle.controller.onSeek({ outputTime: 1, sourceTime: 1, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.controller.lastStartedSourceTime === 1);
  wallMs = 100;
  bundle.controller.onSeek({ outputTime: 1.2, sourceTime: 1.2, src: '/source.mp4', isPlaying: false });
  assert.ok(Math.abs(bundle.controller.velocity - 2) < 1e-9);
  await until(() => bundle.controller.lastStartedSourceTime === 1.2);
  wallMs = 200;
  bundle.controller.onSeek({ outputTime: 1.1, sourceTime: 1.1, src: '/source.mp4', isPlaying: false });
  assert.ok(Math.abs(bundle.controller.velocity + 1) < 1e-9);
  wallMs = 300;
  bundle.controller.onSeek({ outputTime: 1, sourceTime: 1, src: '/other.mp4', isPlaying: false });
  assert.equal(bundle.controller.velocity, 0);
});

test('次回までを覆える速度だけ窓を広げ、16.7x と 59x は最小へ戻す', async () => {
  const observe = async (speed, intervalMs) => {
    let wallMs = 0;
    const bundle = controllerFixture({
      fixture: mp4Fixture({ packetCount: 1024 }),
      now: () => wallMs,
      tuning: { velocitySamples: 2 },
    });
    await bundle.controller.prepare('/source.mp4');
    bundle.controller.onSeek({ outputTime: 2, sourceTime: 2, src: '/source.mp4', isPlaying: false });
    await until(() => bundle.controller.lastStartedSourceTime === 2);
    wallMs = intervalMs;
    const sourceTime = 2 + speed * intervalMs / 1000;
    bundle.controller.onSeek({ outputTime: sourceTime, sourceTime, src: '/source.mp4', isPlaying: false });
    await until(() => bundle.controller.lastStartedSourceTime === sourceTime);
    return { ranges: bundle.controller.lastWindowRanges, seconds: bundle.controller.lastWindowSec };
  };
  const slow = await observe(2, 1000 / 30);
  const medium = await observe(5, 1000 / 30);
  const fast = await observe(16.7, 1000 / 30);
  const throttled = await observe(59, 100);
  assert.ok(slow.seconds > 0.14 && slow.seconds < 0.16);
  assert.ok(medium.seconds > slow.seconds && medium.seconds < 0.30);
  assert.ok(Math.abs(fast.seconds - slow.seconds) < 1e-9);
  assert.ok(Math.abs(throttled.seconds - slow.seconds) < 1e-9);
});

test('65 KB 間隙の muxed MP4 でも 1 窓の Range は 12 本を超えない', async () => {
  const fixture = mp4Fixture({ packetCount: 64, interleaveGapBytes: 65 * 1024 });
  let wallMs = 0;
  const bundle = controllerFixture({
    fixture,
    now: () => wallMs,
    tuning: { velocitySamples: 2, fastSpeedEnterRatio: 1000 },
  });
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 0.1, sourceTime: 0.1, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.controller.lastStartedSourceTime === 0.1);
  wallMs = 1000 / 30;
  const sourceTime = 0.1 + 5 / 30;
  bundle.controller.onSeek({ outputTime: sourceTime, sourceTime, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.controller.lastStartedSourceTime === sourceTime);
  assert.ok(bundle.controller.lastWindowRanges <= 12);
  assert.ok(bundle.controller.lastWindowSec <= 0.30);
});

test('結合 Range の間隙を飛ばして各 packet の正しいバイトを decoder へ渡す', async () => {
  class InspectingDecoder extends FakeDecoder {
    static packetHeads = [];
    decode(chunk) {
      InspectingDecoder.packetHeads.push(chunk.data[0]);
      super.decode(chunk);
    }
  }
  const bundle = controllerFixture({
    fixture: mp4Fixture({ packetCount: 8, interleaveGapBytes: 16 }),
    Decoder: InspectingDecoder,
    tuning: { maxRangeGapBytes: 16 },
  });
  await prepareAndSeek(bundle, { sourceTime: 0, outputTime: 0 });
  assert.deepEqual(InspectingDecoder.packetHeads, [1, 2, 3, 4, 5, 6]);
  const packetCalls = bundle.calls.filter(call => call.start >= bundle.fixture.mediaOffset
    && call.start < bundle.fixture.mediaOffset + 8 * 4 + 7 * 16);
  assert.equal(packetCalls.length, 1);
});

test('同じ in-flight 窓の seek は合流し、旧断片を残したまま最新位置で鳴る', async () => {
  const fixture = mp4Fixture({ packetCount: 64 });
  const baseFetch = rangeFetch(fixture.file);
  let wallMs = 0;
  let packetFetches = 0;
  let pendingSignal;
  let releasePending;
  const fetchFn = async (src, options) => {
    const start = Number(/^bytes=(\d+)-/.exec(options.headers.Range)[1]);
    if (start >= fixture.mediaOffset && start < fixture.mediaOffset + 64 * 4 && ++packetFetches === 2) {
      pendingSignal = options.signal;
      return new Promise((resolve, reject) => {
        releasePending = () => baseFetch(src, options).then(resolve, reject);
      });
    }
    return baseFetch(src, options);
  };
  const bundle = controllerFixture({
    fixture,
    fetchFn,
    now: () => wallMs,
    tuning: { velocitySamples: 2, fastSpeedEnterRatio: 1000 },
  });
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 0.02, sourceTime: 0.02, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.audio.sources.length === 1);
  wallMs = 1000;
  bundle.controller.onSeek({ outputTime: 0.5, sourceTime: 0.5, src: '/source.mp4', isPlaying: false });
  await until(() => pendingSignal);
  assert.deepEqual(bundle.audio.sources[0].stops, []);
  wallMs = 1016;
  bundle.controller.onSeek({ outputTime: 0.52, sourceTime: 0.52, src: '/source.mp4', isPlaying: false });
  assert.equal(bundle.controller.coalescedSeeks, 1);
  assert.equal(pendingSignal.aborted, false);
  assert.equal(packetFetches, 2);
  assert.deepEqual(bundle.audio.sources[0].stops, []);
  releasePending();
  await until(() => bundle.controller.lastStartedSourceTime === 0.52);
  assert.equal(bundle.audio.sources.length, 2);
  assert.equal(bundle.audio.sources[0].stops.length, 1);
});

test('発音後に進行方向の次窓を 1 本だけ先読みする', async () => {
  const fixture = mp4Fixture({ packetCount: 1024 });
  const calls = [];
  const packetSourceCounts = [];
  let wallMs = 0;
  let bundle;
  const baseFetch = rangeFetch(fixture.file, calls);
  const fetchFn = async (src, options) => {
    const start = Number(/^bytes=(\d+)-/.exec(options.headers.Range)[1]);
    if (start >= fixture.mediaOffset && start < fixture.mediaOffset + 1024 * 4) {
      packetSourceCounts.push(bundle?.audio.sources.length ?? 0);
    }
    return baseFetch(src, options);
  };
  bundle = controllerFixture({
    fixture,
    fetchFn,
    now: () => wallMs,
    tuning: { velocitySamples: 2, fastSpeedEnterRatio: 1000 },
  });
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 1, sourceTime: 1, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.controller.lastStartedSourceTime === 1);
  wallMs = 100;
  bundle.controller.onSeek({ outputTime: 7, sourceTime: 7, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.controller.cacheSize === 3 && bundle.controller.inFlightFetches === 0);
  assert.deepEqual(packetSourceCounts, [0, 1, 2]);
});

test('逆走時は進行中の先読みを abort し lastError を汚さない', async () => {
  const fixture = mp4Fixture({ packetCount: 1024 });
  let wallMs = 0;
  let packetFetches = 0;
  let prefetchSignal;
  const baseFetch = rangeFetch(fixture.file);
  const fetchFn = async (src, options) => {
    const start = Number(/^bytes=(\d+)-/.exec(options.headers.Range)[1]);
    if (start >= fixture.mediaOffset && start < fixture.mediaOffset + 1024 * 4) {
      packetFetches++;
      if (packetFetches === 3) {
        prefetchSignal = options.signal;
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
          const error = new Error('aborted prefetch');
          error.name = 'AbortError';
          reject(error);
        }, { once: true }));
      }
    }
    return baseFetch(src, options);
  };
  const bundle = controllerFixture({
    fixture,
    fetchFn,
    now: () => wallMs,
    tuning: { velocitySamples: 2, fastSpeedEnterRatio: 1000 },
  });
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 1, sourceTime: 1, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.controller.lastStartedSourceTime === 1);
  wallMs = 100;
  bundle.controller.onSeek({ outputTime: 7, sourceTime: 7, src: '/source.mp4', isPlaying: false });
  await until(() => prefetchSignal);
  wallMs = 200;
  bundle.controller.onSeek({ outputTime: 6, sourceTime: 6, src: '/source.mp4', isPlaying: false });
  assert.equal(prefetchSignal.aborted, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bundle.controller.lastError, null);
});

test('高速時だけ発音を間引き、満了時には最新 seek を鳴らす', async () => {
  const timers = new Map();
  let timerId = 0;
  let wallMs = 0;
  const bundle = controllerFixture({
    fixture: mp4Fixture({ packetCount: 512 }),
    now: () => wallMs,
    tuning: { velocitySamples: 2 },
    setTimeoutFn(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeoutFn(id) { timers.delete(id); },
  });
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 0.5, sourceTime: 0.5, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.controller.lastStartedSourceTime === 0.5);
  wallMs = 10;
  bundle.controller.onSeek({ outputTime: 1.5, sourceTime: 1.5, src: '/source.mp4', isPlaying: false });
  wallMs = 20;
  bundle.controller.onSeek({ outputTime: 2.5, sourceTime: 2.5, src: '/source.mp4', isPlaying: false });
  assert.equal(bundle.audio.sources.length, 1);
  assert.deepEqual(bundle.audio.sources[0].stops, []);
  const pending = [...timers.values()].find(timer => timer.ms < 1000);
  assert.equal(pending.ms, 60);
  wallMs = 30;
  bundle.controller.onSeek({ outputTime: 2.6, sourceTime: 2.6, src: '/source.mp4', isPlaying: false });
  assert.equal(bundle.controller.fastMode, false);
  wallMs = 70;
  pending.fn();
  await until(() => bundle.controller.lastStartedSourceTime === 2.6);
  assert.equal(bundle.audio.sources.length, 2);
  assert.equal(bundle.controller.throttledSeeks, 3);

  const slow = controllerFixture({
    fixture: mp4Fixture({ packetCount: 512 }),
    now: () => wallMs,
    tuning: { velocitySamples: 2 },
  });
  await slow.controller.prepare('/source.mp4');
  slow.controller.onSeek({ outputTime: 1, sourceTime: 1, src: '/source.mp4', isPlaying: false });
  await until(() => slow.audio.sources.length === 1);
  wallMs += 1000;
  slow.controller.onSeek({ outputTime: 1.1, sourceTime: 1.1, src: '/source.mp4', isPlaying: false });
  await until(() => slow.audio.sources.length === 2);
  assert.equal(slow.controller.fastMode, false);
});

test('配達 EWMA ぶんタイマーを前倒しし、その満了予測位置を先読みする', async () => {
  const fixture = mp4Fixture({ packetCount: 700 });
  const calls = [];
  const baseFetch = rangeFetch(fixture.file, calls);
  const timers = new Map();
  let timerId = 0;
  let wallMs = 0;
  let firstPacket;
  let releaseFirst;
  const fetchFn = async (src, options) => {
    const start = Number(/^bytes=(\d+)-/.exec(options.headers.Range)[1]);
    if (start >= fixture.mediaOffset && start < fixture.mediaOffset + 700 * 4 && !firstPacket) {
      firstPacket = options;
      return new Promise((resolve, reject) => {
        releaseFirst = () => baseFetch(src, options).then(resolve, reject);
      });
    }
    return baseFetch(src, options);
  };
  const bundle = controllerFixture({
    fixture,
    fetchFn,
    now: () => wallMs,
    tuning: { velocitySamples: 2 },
    setTimeoutFn(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeoutFn(id) { timers.delete(id); },
  });
  const packetCalls = () => calls.filter(call => call.start >= fixture.mediaOffset
    && call.start < fixture.mediaOffset + 700 * 4);
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 1, sourceTime: 1, src: '/source.mp4', isPlaying: false });
  await until(() => firstPacket);
  wallMs = 20;
  releaseFirst();
  await until(() => bundle.controller.lastStartedSourceTime === 1);
  assert.equal(bundle.controller.deliveryMs, 20);
  wallMs = 30;
  bundle.controller.onSeek({ outputTime: 2.77, sourceTime: 2.77, src: '/source.mp4', isPlaying: false });
  const pending = [...timers.values()].find(timer => timer.ms < 1000);
  assert.equal(pending.ms, 40);
  await until(() => packetCalls().length === 2);
  const prefetch = packetCalls().at(-1);
  const predictedWindowStartSec = (prefetch.start - fixture.mediaOffset) / 4 * 1024 / 48000;
  assert.ok(predictedWindowStartSec > 6.26 && predictedWindowStartSec < 6.33);
});

test('配達前倒しは最短発音間隔の半分までに制限する', async () => {
  const fixture = mp4Fixture({ packetCount: 700 });
  const baseFetch = rangeFetch(fixture.file);
  const timers = [];
  let wallMs = 0;
  let releaseFirst;
  let firstPacket = true;
  const fetchFn = async (src, options) => {
    const start = Number(/^bytes=(\d+)-/.exec(options.headers.Range)[1]);
    if (start >= fixture.mediaOffset && start < fixture.mediaOffset + 700 * 4 && firstPacket) {
      firstPacket = false;
      return new Promise((resolve, reject) => {
        releaseFirst = () => baseFetch(src, options).then(resolve, reject);
      });
    }
    return baseFetch(src, options);
  };
  const bundle = controllerFixture({
    fixture,
    fetchFn,
    now: () => wallMs,
    tuning: { velocitySamples: 2 },
    setTimeoutFn(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeoutFn() {},
  });
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 1, sourceTime: 1, src: '/source.mp4', isPlaying: false });
  await until(() => releaseFirst);
  wallMs = 100;
  releaseFirst();
  await until(() => bundle.controller.lastStartedSourceTime === 1);
  assert.equal(bundle.controller.deliveryMs, 100);
  wallMs = 110;
  bundle.controller.onSeek({ outputTime: 7.49, sourceTime: 7.49, src: '/source.mp4', isPlaying: false });
  assert.equal(timers.find(timer => timer.ms < 1000).ms, 25);
});

test('間引き中の先読みは次の 70 ms 発音位置を狙う', async () => {
  const fixture = mp4Fixture({ packetCount: 700 });
  const calls = [];
  let wallMs = 0;
  const bundle = controllerFixture({
    fixture,
    fetchFn: rangeFetch(fixture.file, calls),
    now: () => wallMs,
    tuning: { velocitySamples: 2 },
  });
  const packetCalls = () => calls.filter(call => call.start >= fixture.mediaOffset
    && call.start < fixture.mediaOffset + 700 * 4);
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 1, sourceTime: 1, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.controller.lastStartedSourceTime === 1);
  wallMs = 100;
  bundle.controller.onSeek({ outputTime: 6.9, sourceTime: 6.9, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.controller.cacheSize === 3 && bundle.controller.inFlightFetches === 0);
  assert.equal(bundle.controller.fastMode, true);
  const prefetch = packetCalls().at(-1);
  const prefetchWindowStartSec = (prefetch.start - fixture.mediaOffset) / 4 * 1024 / 48000;
  assert.ok(prefetchWindowStartSec > 10.9 && prefetchWindowStartSec < 11.1);
});

test('間引いた seek のたびに進行中の次回先読みを取り直さない', async () => {
  const fixture = mp4Fixture({ packetCount: 700 });
  const baseFetch = rangeFetch(fixture.file);
  let wallMs = 0;
  let packetFetches = 0;
  let prefetchSignal;
  let releasePrefetch;
  const timers = new Map();
  let timerId = 0;
  const fetchFn = async (src, options) => {
    const start = Number(/^bytes=(\d+)-/.exec(options.headers.Range)[1]);
    if (start >= fixture.mediaOffset && start < fixture.mediaOffset + 700 * 4 && ++packetFetches === 3) {
      prefetchSignal = options.signal;
      return new Promise((resolve, reject) => {
        releasePrefetch = () => baseFetch(src, options).then(resolve, reject);
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    }
    return baseFetch(src, options);
  };
  const bundle = controllerFixture({
    fixture,
    fetchFn,
    now: () => wallMs,
    tuning: { velocitySamples: 2 },
    setTimeoutFn(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeoutFn(id) { timers.delete(id); },
  });
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 1, sourceTime: 1, src: '/source.mp4', isPlaying: false });
  await until(() => bundle.controller.lastStartedSourceTime === 1);
  wallMs = 100;
  bundle.controller.onSeek({ outputTime: 6.9, sourceTime: 6.9, src: '/source.mp4', isPlaying: false });
  await until(() => prefetchSignal);
  wallMs = 110;
  bundle.controller.onSeek({ outputTime: 7.49, sourceTime: 7.49, src: '/source.mp4', isPlaying: false });
  wallMs = 120;
  bundle.controller.onSeek({ outputTime: 8.08, sourceTime: 8.08, src: '/source.mp4', isPlaying: false });
  assert.equal(packetFetches, 3);
  assert.equal(prefetchSignal.aborted, false);
  wallMs = 170;
  bundle.controller.onSeek({ outputTime: 11.03, sourceTime: 11.03, src: '/source.mp4', isPlaying: false });
  assert.equal(packetFetches, 3);
  assert.equal(prefetchSignal.aborted, false);
  [...timers.values()].find(timer => timer.ms < 1000).fn();
  releasePrefetch();
  await until(() => bundle.controller.lastStartedSourceTime === 11.03);
});

test('16.7x は間引かず 59x で入り、18x 超を維持して 18x 以下で抜ける', async () => {
  const fixture = mp4Fixture({ packetCount: 6000 });
  let wallMs = 0;
  const bundle = controllerFixture({
    fixture,
    now: () => wallMs,
    tuning: { velocitySamples: 2 },
  });
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 1, sourceTime: 1, src: '/source.mp4', isPlaying: false });
  wallMs = 1000;
  bundle.controller.onSeek({ outputTime: 17.7, sourceTime: 17.7, src: '/source.mp4', isPlaying: false });
  assert.equal(bundle.controller.fastMode, false);
  wallMs = 2000;
  bundle.controller.onSeek({ outputTime: 76.7, sourceTime: 76.7, src: '/source.mp4', isPlaying: false });
  assert.equal(bundle.controller.fastMode, true);
  wallMs = 3000;
  bundle.controller.onSeek({ outputTime: 95.7, sourceTime: 95.7, src: '/source.mp4', isPlaying: false });
  assert.equal(bundle.controller.fastMode, true);
  wallMs = 4000;
  bundle.controller.onSeek({ outputTime: 112.7, sourceTime: 112.7, src: '/source.mp4', isPlaying: false });
  assert.equal(bundle.controller.fastMode, false);
});

test('新しい発音世代は Range fetch を abort し signal 無視時も旧結果を捨てる', async () => {
  for (const honorSignal of [true, false]) {
    const fixture = mp4Fixture({ packetCount: 512 });
    const baseFetch = rangeFetch(fixture.file);
    let wallMs = 0;
    let firstPacketSignal;
    let releaseFirst;
    let rejectFirst;
    let packetFetches = 0;
    const fetchFn = async (src, options) => {
      const start = Number(/^bytes=(\d+)-/.exec(options.headers.Range)[1]);
      if (start >= fixture.mediaOffset && start < fixture.mediaOffset + 512 * 4 && ++packetFetches === 1) {
        firstPacketSignal = options.signal;
        return new Promise((resolve, reject) => {
          releaseFirst = () => baseFetch(src, options).then(resolve, reject);
          rejectFirst = reject;
          if (honorSignal) options.signal.addEventListener('abort', () => {
            const error = new Error('aborted seek');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      }
      return baseFetch(src, options);
    };
    const bundle = controllerFixture({
      fixture,
      fetchFn,
      now: () => wallMs,
      tuning: { velocitySamples: 2, fastSpeedEnterRatio: 1000 },
    });
    await bundle.controller.prepare('/source.mp4');
    bundle.controller.onSeek({ outputTime: 1, sourceTime: 1, src: '/source.mp4', isPlaying: false });
    await until(() => firstPacketSignal);
    wallMs = 1000;
    bundle.controller.onSeek({ outputTime: 1.1, sourceTime: 1.1, src: '/source.mp4', isPlaying: false });
    assert.equal(firstPacketSignal.aborted, true);
    await until(() => bundle.controller.lastStartedSourceTime === 1.1);
    if (!honorSignal) releaseFirst();
    else rejectFirst(Object.assign(new Error('already aborted'), { name: 'AbortError' }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(bundle.controller.lastError, null);
  }
});

test('復号 PCM の LRU は注入したバイト上限を超えない', async () => {
  const bundle = controllerFixture({
    fixture: mp4Fixture({ packetCount: 512 }),
    now: () => 0,
    maxCacheBytes: 60000,
    tuning: { fastSpeedEnterRatio: 1000 },
  });
  await bundle.controller.prepare('/source.mp4');
  for (const sourceTime of [1, 2, 3]) {
    bundle.controller.onSeek({ outputTime: sourceTime, sourceTime, src: '/source.mp4', isPlaying: false });
    await until(() => bundle.controller.lastStartedSourceTime === sourceTime);
    assert.ok(bundle.controller.cacheBytes <= 60000);
  }
  assert.equal(bundle.controller.cacheSize, 1);
});

test('BGM offset は t/in/loop を適用する', () => {
  assert.equal(resolveBgmOffset(8, { t: 5, in: 2, loop: false }, 10), 5);
  assert.equal(resolveBgmOffset(15, { t: 5, in: 2, loop: true }, 10), 2);
  assert.equal(resolveBgmOffset(15, { t: 5, in: 2, loop: false }, 10), null);
});
