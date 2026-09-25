import assert from 'node:assert/strict';
import test from 'node:test';
import { isCurrentPhotoResponse } from '../lib/browser/inspector/photo-response-state.js';

test('late response is discarded after replacement, deletion or edit', () => {
  const binding = { itemId: 'photo-1', sourceId: 'src-1', sourceUri: 'file:///photo.png',
    inputSha256: 'a'.repeat(64), revision: '{"at":0}' };
  assert.equal(isCurrentPhotoResponse(binding, binding), true);
  for (const change of [{ sourceId: 'src-2' }, { itemId: '' }, { revision: '{"at":1}' },
    { inputSha256: 'b'.repeat(64) }, { sourceUri: 'file:///other.png' }]) {
    assert.equal(isCurrentPhotoResponse(binding, { ...binding, ...change }), false);
  }
});
