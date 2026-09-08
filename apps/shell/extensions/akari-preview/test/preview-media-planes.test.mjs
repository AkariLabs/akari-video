import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionPreviewMediaPlanes } from '../lib/common/preview-media-planes.js';
const visual = { transform: { x: 0, y: 0, scale: 0.45, rotateDegrees: 0 }, opacity: 1 };
const summary = { timelineTracks: [{ id: 'v1' }, { id: 'v13' }, { id: 'v14' }, { id: 'subtitles' }],
  captionTrackId: 'subtitles', overlays: [{ id: 'html', trackId: 'v13' }],
  cuts: [{ id: 'back', trackId: 'v1', renderTrack: 0 }, { id: 'front', trackId: 'v14', renderTrack: 2 }],
  layers: [{ id: 'front', trackId: 'v14', renderTrack: 2 }] };

test('V14 media sits above V13 HTML and below higher captions', () => {
  const back = { id: 'cut-0', visual, source: {} }, front = { id: 'front', kind: 'video', visual, source: {} };
  const bands = partitionPreviewMediaPlanes({ base: [back], layers: [front] }, summary);
  assert.deepEqual(bands.map(b => b.zIndex), [0, 2]);
  assert.deepEqual(bands[0].baseIndices, [0]);
  assert.equal(bands[1].entries[0].spec, front);
});

test('HTML can occupy V1: the only video stays transparent outside its upper-track box', () => {
  const s = { ...summary, overlays: [{ id: 'html', trackId: 'v1' }] };
  const front = { id: 'cut-1', visual, source: {} };
  const bands = partitionPreviewMediaPlanes({ base: [front], layers: [] }, s);
  assert.equal(bands[0].baseIndices.length, 0);
  assert.equal(bands[1].zIndex, 2);
  assert.equal(bands[1].entries[0].spec.cutVisual, visual);
  assert.equal(bands[1].entries[0].spec.source, front.source);
});

test('a cut and its projected layer share the same track plane after save', () => {
  const cut = { id: 'cut-1', cutVisual: visual, visual };
  const before = partitionPreviewMediaPlanes({ base: [], layers: [cut] }, summary);
  const after = partitionPreviewMediaPlanes({ base: [], layers: [{ id: 'front', visual }] }, summary);
  assert.deepEqual(before.map(b => [b.key, b.zIndex]), after.map(b => [b.key, b.zIndex]));
});
