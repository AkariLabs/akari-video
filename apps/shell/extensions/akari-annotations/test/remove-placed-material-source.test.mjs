import assert from 'node:assert/strict';
import test from 'node:test';

import { removePlacedMaterialAndUnusedSource } from '../lib/common/edit-v2-mutations.js';

const media = (id, src) => ({ id, at: 0, duration: 30,
  source: { kind: 'media', src, in: 0, out: 1 } });
const document = items => ({ version: 2, output: { width: 1920, height: 1080, fps: 30 },
  sources: [{ id: 'shared', path: 'assets/still/shared/bg.png' }],
  tracks: [{ id: 'v1', lane: 'visual', items }] });

test('removing the only referencing item removes its source in the same mutation', () => {
  const original = document([media('placed', 'shared')]);
  const result = removePlacedMaterialAndUnusedSource(original, 'placed');
  assert.deepEqual(result.tracks[0].items, []);
  assert.deepEqual(result.sources, []);
  assert.equal(original.sources.length, 1);
  assert.equal(original.tracks[0].items.length, 1);
});

test('another top-level item keeps a shared source', () => {
  const result = removePlacedMaterialAndUnusedSource(
    document([media('placed', 'shared'), media('other', 'shared')]), 'placed');
  assert.deepEqual(result.sources.map(entry => entry.id), ['shared']);
});

test('an item nested in a group keeps a shared source', () => {
  const group = { id: 'group', at: 0, duration: 30, source: { kind: 'group' },
    items: [media('nested', 'shared')] };
  const result = removePlacedMaterialAndUnusedSource(document([media('placed', 'shared'), group]), 'placed');
  assert.deepEqual(result.sources.map(entry => entry.id), ['shared']);
});

test('mask-only references keep a source until their last item is removed', () => {
  const masked = { id: 'masked', at: 0, duration: 30, mask: 'shared',
    source: { kind: 'shape', shape: 'rect' } };
  const group = { id: 'group', at: 0, duration: 30, source: { kind: 'group' }, items: [masked] };
  const retained = removePlacedMaterialAndUnusedSource(document([media('placed', 'shared'), group]), 'placed');
  assert.deepEqual(retained.sources.map(entry => entry.id), ['shared']);

  const removed = removePlacedMaterialAndUnusedSource(document([masked]), 'masked');
  assert.deepEqual(removed.sources, []);
});
