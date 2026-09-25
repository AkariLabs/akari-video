import assert from 'node:assert/strict';
import test from 'node:test';
import { visionCandidates, preparePhotoClick, ensurePhotoModels, candidateCachePath } from '../lib/node/photo-segmentation.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('missing helper leaves inference unavailable without writing', async () => {
  assert.deepEqual(await visionCandidates('/unused', '/unused', undefined, 'foreground'),
    { ok: false, message: 'この Mac では使えません' });
  assert.deepEqual(await preparePhotoClick('/unused', undefined),
    { ok: false, message: 'この Mac では使えません' });
});

test('missing model and failed retrieval are contained', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-photo-model-test-'));
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try { await assert.rejects(ensurePhotoModels(undefined, root), /offline|この Mac では使えません/); }
  finally { globalThis.fetch = original; await rm(root, { recursive: true, force: true }); }
});

test('Vision and SAM candidate ids resolve to separate cache files', () => {
  const root = join('project', 'cache');
  assert.deepEqual(candidateCachePath(root, 'vision-people--person-1'), [join(root, 'vision-people', 'person-1.png')]);
  assert.deepEqual(candidateCachePath(root, 'vision-foreground--all'), [join(root, 'vision-foreground', 'all.png')]);
  assert.deepEqual(candidateCachePath(root, 'sam-12345678-1234-1234-1234-123456789abc--candidate-2'),
    [join(root, 'sam-12345678-1234-1234-1234-123456789abc', 'candidate-2.png')]);
  assert.deepEqual(candidateCachePath(root, '../escape--all'), []);
});
