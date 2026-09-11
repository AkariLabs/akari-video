import assert from 'node:assert/strict';
import test from 'node:test';

import { createScrubAudioController, resolveBgmOffset, SCRUB_MODES } from '../public/audio-scrub.js';

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

function mp4Fixture({ editOffset = null, codec = 'mp4a', splitChunks = false } = {}) {
  const ftyp = box('ftyp', ascii('isom'), u32(0));
  const media = splitChunks
    ? concat(bytes(...Array.from({ length: 16 }, (_, index) => index + 1)), bytes(0, 0, 0, 0),
      bytes(...Array.from({ length: 16 }, (_, index) => index + 17)))
    : bytes(...Array.from({ length: 32 }, (_, index) => index + 1));
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
  const stts = fullBox('stts', u32(1), u32(8), u32(1024));
  const stsc = fullBox('stsc', u32(1), u32(1), u32(splitChunks ? 4 : 8), u32(1));
  const stsz = fullBox('stsz', u32(0), u32(8), ...Array(8).fill(u32(4)));
  const chunkOffsets = splitChunks ? [mediaOffset, mediaOffset + 20] : [mediaOffset];
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
      return { duration: frames / sampleRate, getChannelData: channel => planes[channel] };
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
    now: (() => { let value = 0; return () => ++value; })(),
    AudioDecoderCtor: options.Decoder ?? FakeDecoder,
    EncodedAudioChunkCtor: FakeChunk,
    setTimeoutFn: options.setTimeoutFn ?? (() => 1),
    clearTimeoutFn: options.clearTimeoutFn ?? (() => {}),
    idleSuspendMs: options.idleSuspendMs,
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
  assert.deepEqual(bundle.audio.gains[0].gain.calls.slice(-3), [
    ['cancelAndHoldAtTime', 3.02], ['setValueAtTime', 0.75, 3.02], ['linearRampToValueAtTime', 0, 3.025],
  ]);
  assert.deepEqual(bundle.audio.sources[0].stops, [[3.025]]);
});

test('開始前に supersede された断片は開始予定時刻で止める', async () => {
  const bundle = controllerFixture();
  await prepareAndSeek(bundle);
  bundle.controller.onSeek({ outputTime: 0.05, sourceTime: 0.05, src: '/source.mp4', isPlaying: false });
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
  const fixture = mp4Fixture({ splitChunks: true });
  const calls = [];
  const packetStarts = [];
  let releaseFirst;
  const firstPending = new Promise(resolve => { releaseFirst = resolve; });
  const baseFetch = rangeFetch(fixture.file, calls);
  const fetchFn = async (src, options) => {
    const start = Number(/^bytes=(\d+)-/.exec(options.headers.Range)[1]);
    if (start === fixture.mediaOffset + 8 || start === fixture.secondChunkOffset) {
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
  assert.deepEqual(packetStarts, [fixture.mediaOffset + 8, fixture.secondChunkOffset]);
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
  const bundle = controllerFixture({ Decoder: RacingDecoder });
  await bundle.controller.prepare('/source.mp4');
  bundle.controller.onSeek({ outputTime: 0.02, sourceTime: 0.02, src: '/source.mp4', isPlaying: false });
  await until(() => RacingDecoder.instances[0]?.rejectFlush);
  bundle.controller.onSeek({ outputTime: 0.08, sourceTime: 0.08, src: '/source.mp4', isPlaying: false });
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

test('BGM offset は t/in/loop を適用する', () => {
  assert.equal(resolveBgmOffset(8, { t: 5, in: 2, loop: false }, 10), 5);
  assert.equal(resolveBgmOffset(15, { t: 5, in: 2, loop: true }, 10), 2);
  assert.equal(resolveBgmOffset(15, { t: 5, in: 2, loop: false }, 10), null);
});
