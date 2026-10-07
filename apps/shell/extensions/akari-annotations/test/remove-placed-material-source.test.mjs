import assert from 'node:assert/strict';
import test from 'node:test';

import { removePlacedMaterialAndUnusedSource } from '../lib/common/edit-v2-mutations.js';
import { readEditV2 } from '@akari-video/edit-store';

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

test('removing the baseline source keeps a valid rebased group', () => {
  const doc = { version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: ['cam', 'mic', 'mic2'].map(id => ({ id, path: `${id}.mp4` })),
    sync_groups: [{ id: 'take', members: [
      { source: 'cam', offset_sec: 0 }, { source: 'mic', offset_sec: 0.5 },
      { source: 'mic2', offset_sec: 0.2 } ] }],
    tracks: [{ id: 'v', lane: 'visual', items: [media('placed', 'cam')] }] };
  const result = removePlacedMaterialAndUnusedSource(doc, 'placed');
  assert.deepEqual(readEditV2(result).sync_groups[0].members,
    [{ source: 'mic', offset_sec: 0 }, { source: 'mic2', offset_sec: -0.3 }]);
});

test('removing either member of a two-source group removes the empty group key', () => {
  const doc = { version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'cam', path: 'cam.mp4' }, { id: 'mic', path: 'mic.wav' }],
    sync_groups: [{ id: 'take', members: [
      { source: 'cam', offset_sec: 0 }, { source: 'mic', offset_sec: 0.5 } ] }],
    tracks: [{ id: 'v', lane: 'visual', items: [media('placed', 'cam')] }] };
  const result = removePlacedMaterialAndUnusedSource(doc, 'placed');
  assert.equal(Object.hasOwn(result, 'sync_groups'), false);
  readEditV2(result);
});
