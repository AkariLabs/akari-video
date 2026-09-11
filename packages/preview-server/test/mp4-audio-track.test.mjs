import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchRange, Mp4AudioTrack, parseMp4AudioTrack } from '../public/mp4-audio-track.js';

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
function u64(value) {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, BigInt(value));
  return result;
}
function i64(value) {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigInt64(0, BigInt(value));
  return result;
}
function f64(value) {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setFloat64(0, value);
  return result;
}
function box(type, ...payload) {
  const body = concat(...payload);
  return concat(u32(body.byteLength + 8), ascii(type), body);
}
const fullBox = (type, ...payload) => box(type, bytes(0, 0, 0, 0), ...payload);
const descriptor = (tag, payload) => concat(bytes(tag, payload.byteLength), payload);

function fixture({
  faststart = false,
  co64 = false,
  codec = 'mp4a',
  edits = null,
  elstV1 = false,
  sampleVersion = 0,
  waveEsds = false,
} = {}) {
  const ftyp = box('ftyp', ascii('isom'), u32(0));
  const media = bytes(...Array.from({ length: 32 }, (_, index) => index + 1));
  const mdat = box('mdat', media);
  const makeMoov = (mediaOffset) => {
    const asc = bytes(0x11, 0x90);
    const esdsPayload = descriptor(0x03, concat(
      u16(1), bytes(0),
      descriptor(0x04, concat(bytes(0x40, 0x15), u32(0), u32(0), u32(0), descriptor(0x05, asc))),
    ));
    const esds = fullBox('esds', esdsPayload);
    const extension = sampleVersion === 1
      ? concat(u32(1024), u32(4), u32(4), u32(2))
      : sampleVersion === 2
        ? concat(u32(72), f64(44100), u32(6), u32(0x7f000000), u32(24), u32(0), u32(0), u32(0))
        : new Uint8Array();
    const codecChildren = codec !== 'mp4a' ? [] : [waveEsds
      ? box('wave', box('frma', ascii('mp4a')), esds, u32(0))
      : esds];
    const entry = box(codec,
      bytes(0, 0, 0, 0, 0, 0), u16(1),
      u16(sampleVersion), u16(0), u32(0),
      u16(2), u16(16), u16(0), u16(0), u32(48000 << 16),
      extension,
      ...codecChildren,
    );
    const stsd = fullBox('stsd', u32(1), entry);
    const stts = fullBox('stts', u32(1), u32(8), u32(1024));
    const stsc = fullBox('stsc', u32(1), u32(1), u32(8), u32(1));
    const stsz = fullBox('stsz', u32(0), u32(8), ...Array(8).fill(u32(4)));
    const offsets = co64 ? fullBox('co64', u32(1), u64(mediaOffset)) : fullBox('stco', u32(1), u32(mediaOffset));
    const stbl = box('stbl', stsd, stts, stsc, stsz, offsets);
    const minf = box('minf', stbl);
    const mdhd = fullBox('mdhd', u32(0), u32(0), u32(48000), u32(8192), u16(0), u16(0));
    const hdlr = fullBox('hdlr', u32(0), ascii('soun'), new Uint8Array(12), bytes(0));
    const mdia = box('mdia', mdhd, hdlr, minf);
    let edts = new Uint8Array();
    if (edits) {
      const rows = edits.map(({ duration, mediaTime }) => elstV1
        ? concat(u64(duration), i64(mediaTime), u16(1), u16(0))
        : concat(u32(duration), u32(mediaTime), u16(1), u16(0)));
      const header = elstV1 ? bytes(1, 0, 0, 0) : bytes(0, 0, 0, 0);
      edts = box('edts', box('elst', header, u32(rows.length), ...rows));
    }
    const trak = box('trak', fullBox('tkhd', u32(0)), edts, mdia);
    const mvhd = fullBox('mvhd', u32(0), u32(0), u32(1000), u32(1000));
    return box('moov', mvhd, trak);
  };
  let moov = makeMoov(ftyp.byteLength + 8);
  if (faststart) moov = makeMoov(ftyp.byteLength + moov.byteLength + 8);
  const file = faststart ? concat(ftyp, moov, mdat) : concat(ftyp, mdat, moov);
  return { file, moov, mediaOffset: faststart ? ftyp.byteLength + moov.byteLength + 8 : ftyp.byteLength + 8 };
}

function rangeFetch(file, calls = []) {
  return async (_src, options) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
    assert.ok(match);
    const start = Number(match[1]);
    const end = Math.min(file.byteLength - 1, Number(match[2]));
    calls.push({ start, end, range: options.headers.Range });
    const chunk = file.slice(start, end + 1);
    return {
      status: 206,
      headers: { get: name => name.toLowerCase() === 'content-range' ? `bytes ${start}-${end}/${file.byteLength}` : null },
      arrayBuffer: async () => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
    };
  };
}

test('末尾 moov を Range だけで一度取得して sample table を復元する', async () => {
  const data = fixture();
  const calls = [];
  const track = new Mp4AudioTrack({ src: '/tail.mp4', fetchFn: rangeFetch(data.file, calls), now: () => 1 });
  const first = track.open();
  assert.strictEqual(track.open(), first);
  await first;
  assert.equal(track.isOpen, true);
  assert.equal(track.moovBytes, data.moov.byteLength);
  assert.equal(calls.filter(call => (
    call.start === data.file.byteLength - data.moov.byteLength
      && call.end - call.start + 1 === data.moov.byteLength
  )).length, 1);
  assert.ok(calls.every(call => call.range.startsWith('bytes=')));
  assert.equal(track.info.codec, 'mp4a.40.2');
  assert.equal(track.info.durationSec, 8192 / 48000);
});

test('faststart と co64 でも同じ packet 表になる', async () => {
  const data = fixture({ faststart: true, co64: true });
  const track = new Mp4AudioTrack({ src: '/fast.mp4', fetchFn: rangeFetch(data.file) });
  await track.open();
  assert.deepEqual(track.info.samples.map(item => item.offset), [0, 4, 8, 12, 16, 20, 24, 28].map(n => data.mediaOffset + n));
});

test('elst media_time を提示時刻と packet 探索へ適用する', () => {
  const data = fixture({ edits: [{ duration: 1000, mediaTime: 1024 }] });
  const info = parseMp4AudioTrack(data.moov);
  assert.equal(info.hasEditList, true);
  assert.equal(info.editOffsetTicks, 1024);
  assert.equal(info.editOffsetSec, 1024 / 48000);
  const track = new Mp4AudioTrack({ src: '/edit.mp4' });
  track.info = info;
  const window = track.packetsAround(0);
  assert.deepEqual(window.packets.map(item => item.index), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(window.windowStartSec, -1024 / 48000);
  assert.equal(window.rawStartTick, 0);
});

test('空編集を media timescale へ換算し version 1 も読める', () => {
  const edits = [{ duration: 100, mediaTime: -1 }, { duration: 900, mediaTime: 1024 }];
  for (const elstV1 of [false, true]) {
    const info = parseMp4AudioTrack(fixture({ edits, elstV1 }).moov);
    assert.equal(info.editOffsetTicks, 1024 - 4800);
  }
});

test('edts がなければ edit offset はゼロ', () => {
  const info = parseMp4AudioTrack(fixture().moov);
  assert.equal(info.hasEditList, false);
  assert.equal(info.editOffsetTicks, 0);
});

test('Opus sample entry は解析に成功し未対応として返る', async () => {
  const data = fixture({ codec: 'Opus' });
  const track = new Mp4AudioTrack({ src: '/opus.mp4', fetchFn: rangeFetch(data.file) });
  await track.open();
  assert.equal(track.info.codec, 'Opus');
  assert.equal(track.info.supported, false);
  assert.deepEqual(track.decoderConfig(), {
    codec: 'Opus', sampleRate: 48000, numberOfChannels: 2, description: null,
  });
});

test('QuickTime sound sample description v1 の wave 内 esds を読む', () => {
  const info = parseMp4AudioTrack(fixture({ sampleVersion: 1, waveEsds: true }).moov);
  assert.equal(info.codec, 'mp4a.40.2');
  assert.equal(info.supported, true);
  assert.deepEqual(Array.from(info.description), [0x11, 0x90]);
  assert.equal(info.sampleRate, 48000);
  assert.equal(info.numberOfChannels, 2);
});

test('QuickTime sound sample description v2 の実数 sample rate と channel 数を使う', () => {
  const info = parseMp4AudioTrack(fixture({ sampleVersion: 2, waveEsds: true }).moov);
  assert.equal(info.codec, 'mp4a.40.2');
  assert.equal(info.supported, true);
  assert.deepEqual(Array.from(info.description), [0x11, 0x90]);
  assert.equal(info.sampleRate, 44100);
  assert.equal(info.numberOfChannels, 6);
});

test('packetsAround は既定7 packet（before 1 / after 5）を端でクランプする', () => {
  const track = new Mp4AudioTrack({ src: '/source.mp4' });
  track.info = parseMp4AudioTrack(fixture().moov);
  assert.deepEqual(track.packetsAround(0).packets.map(item => item.index), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(track.packetsAround(2 * 1024 / 48000).packets.map(item => item.index), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(track.packetsAround(7 * 1024 / 48000).packets.map(item => item.index), [6, 7]);
});

test('206 以外の Range 応答を拒否する', async () => {
  await assert.rejects(
    fetchRange(async () => ({ status: 200, headers: {}, arrayBuffer: async () => new ArrayBuffer() }), '/x', 0, 1),
    /range fetch was not honored: 200/,
  );
});
