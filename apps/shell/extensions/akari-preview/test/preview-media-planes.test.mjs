import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { partitionPreviewMediaPlanes } from '../lib/common/preview-media-planes.js';
import { canvasCaptionZPlan } from '../lib/common/canvas-caption-z.js';
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

test('caption item barrier splits lower and upper photo planes', () => {
  const s = { timelineTracks: [{ id: 'v1' }, { id: 'caption' }, { id: 'v2' }],
    trackStackZ: { v1: 0, caption: 1, v2: 2 }, itemStackZ: {}, barrierZ: [1],
    cuts: [{ id: 'photo-low', trackId: 'v1' }, { id: 'photo-high', trackId: 'v2' }],
    overlays: [] };
  const plan = { base: [{ id: 'cut-0', visual }, { id: 'cut-1', visual }], layers: [] };
  const bands = partitionPreviewMediaPlanes(plan, s);
  assert.deepEqual(bands.map(b => b.zIndex), [0, 2]);
  assert.deepEqual(bands[0].baseIndices, [0]);
  assert.equal(bands[1].entries[0].baseIndex, 1);
});

test('top-level caption item plates resolve their own track z even without grouped itemStackZ', () => {
  const tracks = [{ id: 'bottom' }, { id: 'text' }, { id: 'top' }];
  const plate = canvasCaptionZPlan([{ id: 'cap-c1', canvasTrackId: 'text' }], 'top',
    id => tracks.findIndex(track => track.id === id));
  assert.equal(plate.split, true);
  assert.equal(plate.plateZ.get('cap-c1'), 1);
  assert.equal(plate.layerZ, 2);
  const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
  assert.match(handler, /captionItemTrackIds\?: Record<string, string>/);
  assert.match(handler, /canvasTrackId: summary\.captionItemTrackIds\?\.\[row\.caption\.id\]/);
  assert.match(handler, /captionItemBarrierZ\.length \? \{ barrierZ: captionItemBarrierZ \}/);
});
