import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as geometry from '../lib/common/filmstrip-geometry.js';
import * as band from '../lib/common/waveform-band.js';

test('既定波形は尺で密度を決め旧200キャッシュを無効化し、同じ要求は再抽出しない', async () => {
  const source = readFileSync(new URL('../lib/node/media-cache.js', import.meta.url), 'utf8');
  const start = source.indexOf('function extractPeaks(');
  const end = source.indexOf('async function getAudioDuration(', start);
  assert.ok(start >= 0 && end > start);
  const files = new Map();
  const keys = [];
  let extractions = 0;
  const pcm = Buffer.alloc(16000);
  pcm.writeInt16LE(16384, 100);
  const exports = {};
  runInNewContext(source.slice(start, end), {
    exports, process: { pid: 1 }, path_1: path,
    akari_annotations_protocol_1: { WAVEFORM_BUCKET_COUNT: 200 },
    filmstrip_geometry_1: geometry, waveform_band_1: band,
    fs_1: { promises: {
      stat: async () => ({ size: 1, mtimeMs: 1 }),
      readFile: async file => {
        if (!files.has(file)) throw new Error('ENOENT');
        return files.get(file);
      },
      unlink: async file => { files.delete(file); },
    } },
    hasFfmpeg: async () => true,
    ffmpegPath: async () => 'ffmpeg',
    ensureCacheDirectory: async () => {},
    cacheHash: key => { keys.push([...key]); return JSON.stringify(key); },
    writeAtomic: async (file, data) => { files.set(file, data); },
    waveformExtractionSemaphore: { run: fn => fn() },
    execFileAsync: async (_bin, args) => { extractions++; files.set(args.at(-1), pcm); },
  });
  const get = (end = 190, buckets) => exports.getClipWaveform('/project', 'source.wav', 10, end, buckets);
  const legacy = await get(190, 200);
  assert.equal(legacy.peaks.length, 200);
  const detailed = await get();
  assert.equal(detailed.status, 'ready');
  assert.equal(detailed.peaks.length, 7200);
  assert.equal(Math.max(...detailed.peaks), 0.5, '抽出のピーク写像はそのまま');
  assert.equal(keys.at(-1).at(-1), 7200);
  assert.notDeepEqual(keys[0], keys[1]);
  assert.equal(extractions, 2);
  assert.equal((await get()).peaks.length, 7200);
  assert.equal(extractions, 2, '既定密度の再要求はキャッシュを読む');
  assert.equal((await get(3610)).peaks.length, 16384);
  assert.equal((await get(11)).peaks.length, 256);
  assert.equal((await get(11, 4000)).peaks.length, 200, '明示要求の尺上限は既存どおり');
  assert.equal((await get(190, 9000)).peaks.length, 4000, '明示要求は既存の4000上限');
});
