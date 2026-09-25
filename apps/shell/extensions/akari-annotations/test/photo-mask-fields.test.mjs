import assert from 'node:assert/strict';
import test from 'node:test';
import { maskSourceIdForLabel, maskSourceOptionsForSources } from '../lib/browser/inspector/mask-fields.js';

test('photo mask picker offers PNG while video picker keeps video masks', () => {
  const sources = new Map([
    ['photo-mask', { path: 'assets/masks/sample.png' }],
    ['video-mask', { path: 'masks/sample.mp4' }]
  ]);
  assert.deepEqual(maskSourceOptionsForSources(sources, true).map(option => option.id), ['photo-mask']);
  assert.deepEqual(maskSourceOptionsForSources(sources).map(option => option.id), ['video-mask']);
});

test('generated photo masks have numbered Japanese labels while their ids and manual filenames stay intact', () => {
  const firstHash = 'a'.repeat(64);
  const secondHash = 'b'.repeat(64);
  const sources = new Map([
    ['manual', { path: 'assets/masks/chosen.png' }],
    [`mask-${firstHash}`, { path: `assets/masks/${firstHash}.png` }],
    ['movie', { path: 'assets/masks/chosen.mov' }],
    [`mask-${secondHash}`, { path: `assets\\masks\\${secondHash}.png` }],
    [`mask-${'c'.repeat(64)}`, { path: 'assets/masks/manual.png' }]
  ]);
  const options = maskSourceOptionsForSources(sources, true);
  assert.deepEqual(options, [
    { id: 'manual', label: 'chosen.png' },
    { id: `mask-${firstHash}`, label: '背景を消したマスク' },
    { id: `mask-${secondHash}`, label: '背景を消したマスク 2' },
    { id: `mask-${'c'.repeat(64)}`, label: 'manual.png' }
  ]);
  assert.equal(maskSourceIdForLabel(options, '背景を消したマスク 2'), `mask-${secondHash}`);
  assert.deepEqual(maskSourceOptionsForSources(sources), [{ id: 'movie', label: 'chosen.mov' }]);
});
