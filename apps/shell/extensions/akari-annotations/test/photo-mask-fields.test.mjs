import assert from 'node:assert/strict';
import test from 'node:test';
import { maskSourceOptionsForSources } from '../lib/browser/inspector/mask-fields.js';

test('photo mask picker offers PNG while video picker keeps video masks', () => {
  const sources = new Map([
    ['photo-mask', { path: 'assets/masks/sample.png' }],
    ['video-mask', { path: 'masks/sample.mp4' }]
  ]);
  assert.deepEqual(maskSourceOptionsForSources(sources, true).map(option => option.id), ['photo-mask']);
  assert.deepEqual(maskSourceOptionsForSources(sources).map(option => option.id), ['video-mask']);
});
