import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { LookaheadCache, LookaheadFrameSource } from '../../dist/index.js';

function fakeFrame(id, rotationDeg) {
  const frame = {
    id,
    closed: false,
    clone() { return fakeFrame(`${id}:clone`); },
    close() { this.closed = true; },
  };
  if (rotationDeg !== undefined) frame.rotationDeg = rotationDeg;
  return frame;
}

test('LookaheadCache preserves rotationDeg on caller clones', () => {
  const cache = new LookaheadCache(1);
  cache.put(1, fakeFrame('rotated', 90), 1);
  const cloned = cache.getClone(1).frame;
  assert.equal(cloned.rotationDeg, 90);
  cloned.close();
  cache.clear();
});

test('LookaheadFrameSource preserves rotationDeg after prefetch and cache hits', async () => {
  let decodes = 0;
  const source = new LookaheadFrameSource({
    async decode(timeUs) {
      decodes += 1;
      return fakeFrame(`decoded-${timeUs}`, 90);
    },
  }, { fps: 30 });

  await source.prefetch(1_000_000, { streamId: 'prefetch' });
  const prefetchedHit = await source.decode(1_000_000, undefined, { streamId: 'prefetch' });
  assert.equal(prefetchedHit.rotationDeg, 90);
  prefetchedHit.close();

  const miss = await source.decode(2_000_000, undefined, { streamId: 'repeat' });
  assert.equal(miss.rotationDeg, 90);
  miss.close();
  const repeatedHit = await source.decode(2_000_000, undefined, { streamId: 'repeat' });
  assert.equal(repeatedHit.rotationDeg, 90);
  repeatedHit.close();
  assert.equal(decodes, 2);
  source.clear();
});

test('ClipSession fixes rotation before priming and adopts an attached prime frame', async () => {
  const sourceRoot = path.resolve(import.meta.dirname, '../../src/decode');
  const clipSessionSource = await readFile(path.join(sourceRoot, 'clip-session.ts'), 'utf8');
  const doLoad = clipSessionSource.slice(
    clipSessionSource.indexOf('private async doLoad()'),
    clipSessionSource.indexOf('private async readKeyframes('),
  );
  const rotationIndex = doLoad.indexOf('this.rotationDeg =');
  const primeIndex = doLoad.indexOf('candidate.tick(primeTarget)');
  assert.notEqual(rotationIndex, -1);
  assert.notEqual(primeIndex, -1);
  assert.ok(rotationIndex < primeIndex);
  assert.match(doLoad, /coverage\.adopt\(this\.attachRotation\(/u);
});
