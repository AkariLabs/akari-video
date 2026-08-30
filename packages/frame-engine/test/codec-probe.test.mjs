import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

test('reads AVC codec and dimensions from a complete MP4 and a moov-only buffer', () => {
  const bytes = readFileSync(fixture);
  const complete = readVideoCodecFromMoov(bytes);
  assert.match(complete?.codec ?? '', /^avc1\.[0-9A-F]{6}$/u);
  assert.equal(complete?.codedWidth, 320);
  assert.equal(complete?.codedHeight, 180);
  const moov = moovBox(bytes);
  assert.ok(moov);
  assert.deepEqual(readVideoCodecFromMoov(moov), complete);
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
