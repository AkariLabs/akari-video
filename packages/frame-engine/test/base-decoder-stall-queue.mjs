import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RangeMp4Source } from '../dist/decode/range-mp4-source.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(process.env.AKARI_STALL_FIXTURE_DIR
  ?? resolve(tmpdir(), 'akari-base-decoder-stall'));
const fixture = resolve(fixtureDir, 'stuck-decoder.mp4');
const evidenceDir = resolve(testDir, '../evidence/base-decoder-stall');
mkdirSync(fixtureDir, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });
if (!existsSync(fixture)) {
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'color=c=black:s=320x180:r=30:d=2', '-an',
    '-c:v', 'libx264', '-g', '30', '-bf', '2',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', fixture,
  ], { stdio: 'inherit' });
}
const bytes = new Uint8Array(readFileSync(fixture));
const requests = [];
const fetchImpl = async (_url, init) => {
  const match = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init.headers).get('range') ?? '');
  assert.ok(match, 'Range request required');
  const start = Number(match[1]);
  const end = Math.min(Number(match[2]) + 1, bytes.length);
  requests.push(end - start);
  return new Response(bytes.slice(start, end), {
    status: 206,
    headers: { 'Content-Length': String(end - start), 'Content-Range': `bytes ${start}-${end - 1}/${bytes.length}` },
  });
};

const originals = { VideoDecoder: globalThis.VideoDecoder, EncodedVideoChunk: globalThis.EncodedVideoChunk };
const instances = [];
class StuckDecoder {
  static async isConfigSupported(config) { return { supported: true, config }; }
  constructor() { this.decodeQueueSize = 0; instances.push(this); }
  configure() {}
  decode() { this.decodeQueueSize++; }
  addEventListener() {}
  removeEventListener() {}
  flush() { return new Promise(() => undefined); }
  close() { this.decodeQueueSize = 0; }
}
globalThis.VideoDecoder = StuckDecoder;
globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
const warnings = [];
const source = new RangeMp4Source('genuine-stall', 'stuck-decoder.mp4', {
  fetchImpl, prefetch: false, hardwareAcceleration: 'prefer-software',
  onWarning: warning => warnings.push(warning),
});
try {
  await assert.rejects(source.decode(0), /decoder made no progress/u);
  assert.equal(warnings.filter(warning => warning.includes('recreating once')).length, 1);
  assert.equal(instances.length, 2, 'a permanently stuck decoder must be recreated once');
  writeFileSync(resolve(evidenceDir, 'genuine-stall.json'), `${JSON.stringify({
    fixtureBytes: bytes.length,
    rangeRequests: requests.length,
    rangeBytes: requests.reduce((sum, count) => sum + count, 0),
    decoderInstances: instances.length,
    outputs: 0,
    dequeues: 0,
    recreationWarnings: 1,
  }, null, 2)}\n`);
} finally {
  source.destroy();
  for (const [name, value] of Object.entries(originals)) {
    if (value === undefined) delete globalThis[name];
    else globalThis[name] = value;
  }
}
