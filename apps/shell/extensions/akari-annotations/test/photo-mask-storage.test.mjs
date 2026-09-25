import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { savePhotoMask } from '../lib/node/photo-mask-storage.js';

test('a missing Vision helper fails softly without changing the project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'photo-mask-test-'));
  try {
    assert.deepEqual(await savePhotoMask(root, join(root, 'photo.png'), undefined),
      { ok: false, message: '背景を消す準備ができていません（開発中は build で作られます）' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
