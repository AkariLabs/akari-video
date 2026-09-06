import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { isTrackLocked, lockedTrackMessage } = require('../lib/common/track-lock-guard.js');

test('only an explicitly locked matching track rejects editing', () => {
  const tracks = Object.freeze([
    Object.freeze({ id: 'locked', locked: true }),
    Object.freeze({ id: 'open', locked: false }),
    Object.freeze({ id: 'default' }),
  ]);
  assert.equal(isTrackLocked(tracks, 'locked'), true);
  for (const id of ['open', 'default', 'missing', undefined]) {
    assert.equal(isTrackLocked(tracks, id), false);
  }
  assert.equal(isTrackLocked([], 'locked'), false);
});

test('refusal names the track and explains how to unlock it', () => {
  assert.equal(lockedTrackMessage('本編 1'), '「本編 1」はロック中です（鍵を外すと編集できます）');
});
