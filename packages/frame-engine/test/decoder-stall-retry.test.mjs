import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RangeMp4Source } from '../dist/decode/range-mp4-source.js';

const directory = process.env.AKARI_STALL_RETRY_FIXTURE ? null : mkdtempSync(join(tmpdir(), 'akari-decoder-retry-'));
const fixture = process.env.AKARI_STALL_RETRY_FIXTURE ?? join(directory, 'fixture.mp4');
if (directory) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
  '-i', 'color=c=black:s=320x180:r=30:d=2', '-an', '-c:v', 'libx264', '-g', '30',
  '-bf', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', fixture]);
const bytes = new Uint8Array(readFileSync(fixture));
const fetchImpl = async (_url, init) => {
  const match = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init.headers).get('range') ?? '');
  assert.ok(match);
  const start = Number(match[1]);
  const end = Math.min(Number(match[2]) + 1, bytes.length);
  return new Response(bytes.slice(start, end), { status: 206, headers: {
    'Content-Length': String(end - start), 'Content-Range': `bytes ${start}-${end - 1}/${bytes.length}`,
  } });
};

function installDecoder(stuckCount) {
  const original = { VideoDecoder: globalThis.VideoDecoder, EncodedVideoChunk: globalThis.EncodedVideoChunk };
  const instances = [];
  class Decoder {
    static async isConfigSupported(config) { return { supported: true, config }; }
    constructor(init) { this.init = init; this.decodeQueueSize = 0; this.listeners = new Set(); instances.push(this); }
    configure() {}
    decode(chunk) {
      this.decodeQueueSize += 1;
      if (instances.length <= stuckCount) return;
      queueMicrotask(() => {
        this.decodeQueueSize -= 1;
        this.init.output({ timestamp: chunk.timestamp, duration: chunk.duration, codedWidth: 320,
          codedHeight: 180, clone() { return { ...this }; }, close() {} });
        for (const listener of this.listeners) listener();
      });
    }
    addEventListener(_event, listener) { this.listeners.add(listener); }
    removeEventListener(_event, listener) { this.listeners.delete(listener); }
    flush() { return new Promise(() => undefined); }
    close() { this.decodeQueueSize = 0; }
  }
  globalThis.VideoDecoder = Decoder;
  globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
  return { instances, restore() {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  } };
}

async function scenario(stuckCount, options, run) {
  const decoder = installDecoder(stuckCount);
  const warnings = [];
  const source = new RangeMp4Source('retry', 'fixture.mp4', {
    fetchImpl, prefetch: false, hardwareAcceleration: 'prefer-software',
    decoderStallMs: 20, ...options, onWarning: (warning) => warnings.push(warning),
  });
  try { await run({ source, warnings, instances: decoder.instances }); }
  finally { source.destroy(); decoder.restore(); }
}

test('recovers after two stalled decoders with backoff', async () => {
  await scenario(2, { decoderRecoveryAttempts: 3, decoderRecoveryBackoffMs: [5, 10] }, async ({ source, warnings, instances }) => {
    const frame = await source.decode(0);
    assert.equal(frame.timestamp, 0);
    frame.close();
    assert.equal(instances.length, 3);
    assert.equal(source.stats.decoderRecoveries, 2);
    assert.match(warnings.join('\n'), /recreating \(1\/3\) after 5ms/u);
    assert.match(warnings.join('\n'), /recreating \(2\/3\) after 10ms/u);
  });
});

test('exhaustion preserves decoder error', async () => {
  await scenario(Infinity, { decoderRecoveryAttempts: 3 }, async ({ source, warnings, instances }) => {
    await assert.rejects(source.decode(0), /decoder made no progress/u);
    assert.equal(instances.length, 4);
    assert.equal(source.stats.decoderRecoveryFailures, 1);
    assert.equal(warnings.filter((warning) => warning.includes('recovery exhausted')).length, 1);
  });
});

test('default recovery count and warning stay compatible', async () => {
  await scenario(Infinity, {}, async ({ source, warnings, instances }) => {
    await assert.rejects(source.decode(0), /decoder made no progress/u);
    assert.equal(instances.length, 2);
    assert.equal(warnings.filter((warning) => warning.includes('recreating once')).length, 1);
  });
});

test('stall budget controls elapsed time', async () => {
  await scenario(Infinity, { decoderStallMs: 100, decoderRecoveryAttempts: 0 }, async ({ source }) => {
    const started = performance.now();
    await assert.rejects(source.decode(0), /decoder made no progress/u);
    assert.ok(performance.now() - started < 1_000);
  });
  await scenario(Infinity, { decoderStallMs: undefined, decoderRecoveryAttempts: 0 }, async ({ source }) => {
    const started = performance.now();
    await assert.rejects(source.decode(0), /decoder made no progress/u);
    assert.ok(performance.now() - started >= 2_000);
  });
});

test('destroy during backoff prevents recreation', async () => {
  await scenario(Infinity, { decoderRecoveryAttempts: 3, decoderRecoveryBackoffMs: [100] }, async ({ source, warnings, instances }) => {
    const decode = source.decode(0);
    while (!warnings.some((warning) => warning.includes('recreating (1/3)'))) await new Promise((resolve) => setTimeout(resolve, 2));
    source.destroy();
    await assert.rejects(decode, /is unavailable/u);
    assert.equal(instances.length, 1);
  });
});

test.after(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
