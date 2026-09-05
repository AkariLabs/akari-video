import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  evaluateCodecSupport,
  probeSourceCodec,
  readVideoCodecFromMoov,
  resetCodecProbeCache,
  setForceSoftwareDecode,
} from '../dist/index.js';

const fixture = path.resolve(
  import.meta.dirname,
  '../../../dev-fixtures/preview-lut-chroma/b-lut-100/media/pattern.mp4',
);

function moovBox(bytes) {
  let offset = 0;
  while (offset + 8 <= bytes.byteLength) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      size = Number(bytes.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = bytes.byteLength - offset;
    }
    if (size < header || offset + size > bytes.byteLength) return null;
    if (type === 'moov') return bytes.subarray(offset, offset + size);
    offset += size;
  }
  return null;
}

function withTkhdRotation(bytes, degrees) {
  const output = Buffer.from(bytes);
  const typeOffset = output.indexOf(Buffer.from('tkhd'));
  assert.ok(typeOffset >= 4, 'fixture has no tkhd box');
  const dataStart = typeOffset + 4;
  const matrixOffset = dataStart + 4 + (output[dataStart] === 1 ? 32 : 20) + 16;
  const radians = degrees * Math.PI / 180;
  const fixed = value => Math.round(value * 65536);
  output.writeInt32BE(fixed(Math.cos(radians)), matrixOffset);
  output.writeInt32BE(fixed(-Math.sin(radians)), matrixOffset + 4);
  output.writeInt32BE(fixed(Math.sin(radians)), matrixOffset + 12);
  output.writeInt32BE(fixed(Math.cos(radians)), matrixOffset + 16);
  return output;
}

test('reads AVC codec and dimensions from a complete MP4 and a moov-only buffer', () => {
  const bytes = readFileSync(fixture);
  const complete = readVideoCodecFromMoov(bytes);
  assert.match(complete?.codec ?? '', /^avc1\.[0-9A-F]{6}$/u);
  assert.equal(complete?.codedWidth, 320);
  assert.equal(complete?.codedHeight, 180);
  assert.equal(complete?.rotationDeg, 0);
  const moov = moovBox(bytes);
  assert.ok(moov);
  assert.deepEqual(readVideoCodecFromMoov(moov), complete);
});

test('normalizes tkhd matrices to 0/90/180/270 degrees', () => {
  const bytes = readFileSync(fixture);
  for (const rotationDeg of [0, 90, 180, 270]) {
    assert.equal(readVideoCodecFromMoov(withTkhdRotation(bytes, rotationDeg))?.rotationDeg, rotationDeg);
  }
});

test('reads an hvc1 codec string when ffmpeg can generate HEVC', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'akari-codec-probe-'));
  try {
    const output = path.join(directory, 'tiny-hevc.mp4');
    const result = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=64x48:r=1',
      '-t', '1', '-an', '-c:v', 'libx265', '-tag:v', 'hvc1', '-y', output,
    ], { timeout: 30_000 });
    if (result.status !== 0) return t.skip('ffmpeg with libx265 is unavailable');
    const info = readVideoCodecFromMoov(readFileSync(output));
    assert.equal(info?.fourcc, 'hvc1');
    assert.match(info?.codec ?? '', /^hvc1\./u);
    assert.equal(info?.codedWidth, 64);
    assert.equal(info?.codedHeight, 48);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('returns null for malformed input without throwing', () => {
  assert.equal(readVideoCodecFromMoov(new Uint8Array([0, 1, 2, 3])), null);
  assert.equal(readVideoCodecFromMoov(new Uint8Array(32)), null);
});

test('force-software mode masks hardware support and derives any from software', async () => {
  const previous = globalThis.VideoDecoder;
  globalThis.VideoDecoder = class {
    static async isConfigSupported(config) {
      return { supported: config.hardwareAcceleration !== 'prefer-software' };
    }
  };
  try {
    setForceSoftwareDecode(false);
    resetCodecProbeCache();
    assert.deepEqual(await evaluateCodecSupport('hvc1.test'), {
      codec: 'hvc1.test', hw: true, sw: false, any: true,
    });
    setForceSoftwareDecode(true);
    assert.deepEqual(await evaluateCodecSupport('hvc1.test'), {
      codec: 'hvc1.test', hw: false, sw: false, any: false,
    });
  } finally {
    setForceSoftwareDecode(false);
    resetCodecProbeCache();
    if (previous === undefined) delete globalThis.VideoDecoder;
    else globalThis.VideoDecoder = previous;
  }
});

test('URL probe uses byte ranges and memoizes one result per URL', async () => {
  const bytes = readFileSync(fixture);
  let fetches = 0;
  const fetchImpl = async (_url, init = {}) => {
    fetches += 1;
    const range = String(new Headers(init.headers).get('range'));
    const match = range.match(/^bytes=(\d+)-(\d+)$/u);
    assert.ok(match, `missing byte range: ${range}`);
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), bytes.byteLength - 1);
    return new Response(bytes.subarray(start, end + 1), {
      status: 206,
      headers: {
        'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
        'content-length': String(end - start + 1),
      },
    });
  };
  resetCodecProbeCache();
  const first = await probeSourceCodec('/fixture.mp4', { fetchImpl });
  const afterFirst = fetches;
  const second = await probeSourceCodec('/fixture.mp4', { fetchImpl });
  assert.match(first.info?.codec ?? '', /^avc1\./u);
  assert.deepEqual(second, first);
  assert.equal(fetches, afterFirst);
  assert.ok(fetches >= 1);
});

test('9 MiB 超の moov は既定予算で成功し転送量を抑え、明示 8 MiB では失敗する', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'akari-moov-budget-'));
  try {
    const original = readFileSync(fixture);
    const originalInfo = readVideoCodecFromMoov(original);
    assert.match(originalInfo?.codec ?? '', /^avc1\./u);
    const moov = moovBox(original);
    assert.ok(moov);
    let ftyp = null;
    for (let offset = 0; offset + 8 <= original.byteLength;) {
      let size = original.readUInt32BE(offset);
      const type = original.toString('latin1', offset + 4, offset + 8);
      let header = 8;
      if (size === 1) {
        size = Number(original.readBigUInt64BE(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = original.byteLength - offset;
      }
      assert.ok(size >= header && offset + size <= original.byteLength);
      if (type === 'ftyp') {
        ftyp = original.subarray(offset, offset + size);
        break;
      }
      offset += size;
    }
    assert.ok(ftyp);
    assert.equal(moov.readUInt32BE(0), moov.byteLength);
    const padding = Buffer.alloc(9 * 1024 * 1024);
    padding.writeUInt32BE(padding.byteLength, 0);
    padding.write('free', 4, 'latin1');
    const paddedMoov = Buffer.concat([moov, padding]);
    const moovSize = paddedMoov.byteLength;
    paddedMoov.writeUInt32BE(moovSize, 0);
    assert.ok(moovSize > 9 * 1024 * 1024);
    assert.deepEqual(readVideoCodecFromMoov(paddedMoov), originalInfo);
    const output = path.join(directory, 'moov-budget.mp4');
    writeFileSync(output, Buffer.concat([ftyp, paddedMoov]));
    const bytes = readFileSync(output);
    let transferredBytes = 0;
    const fetchImpl = async (_url, init = {}) => {
      const range = String(new Headers(init.headers).get('range'));
      const match = range.match(/^bytes=(\d+)-(\d+)$/u);
      assert.ok(match, `Range ヘッダが不正: ${range}`);
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), bytes.byteLength - 1);
      assert.ok(start <= end && start < bytes.byteLength);
      transferredBytes += end - start + 1;
      return new Response(bytes.subarray(start, end + 1), {
        status: 206,
        headers: {
          'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
          'content-length': String(end - start + 1),
        },
      });
    };
    resetCodecProbeCache();
    const result = await probeSourceCodec('/moov-budget.mp4', { fetchImpl });
    assert.equal(result.error, undefined);
    assert.match(result.info?.codec ?? '', /^avc1\./u);
    assert.equal(result.info?.codec, originalInfo.codec);
    assert.ok(transferredBytes <= moovSize + 1024 * 1024);

    resetCodecProbeCache();
    const limited = await probeSourceCodec('/moov-budget-8mib.mp4', {
      fetchImpl, maxProbeBytes: 8 * 1024 * 1024,
    });
    assert.match(limited.error ?? '', /moov exceeds probe budget/u);
    assert.ok((limited.error ?? '').includes(String(moovSize)));
    assert.ok((limited.error ?? '').includes(String(8 * 1024 * 1024)));
    assert.equal(limited.info, null);
  } finally {
    resetCodecProbeCache();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('URL probe default fetch preserves the global receiver', async () => {
  const bytes = readFileSync(fixture);
  const previous = globalThis.fetch;
  let receivers = 0;
  globalThis.fetch = function (_url, init = {}) {
    assert.equal(this, globalThis);
    receivers += 1;
    const range = String(new Headers(init.headers).get('range'));
    const match = range.match(/^bytes=(\d+)-(\d+)$/u);
    assert.ok(match);
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), bytes.byteLength - 1);
    return Promise.resolve(new Response(bytes.subarray(start, end + 1), {
      status: 206,
      headers: {
        'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
        'content-length': String(end - start + 1),
      },
    }));
  };
  try {
    resetCodecProbeCache();
    const result = await probeSourceCodec('/receiver-fixture.mp4');
    assert.match(result.info?.codec ?? '', /^avc1\./u);
    assert.ok(receivers >= 1);
  } finally {
    globalThis.fetch = previous;
    resetCodecProbeCache();
  }
});
