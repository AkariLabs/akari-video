import assert from 'node:assert/strict';
import test from 'node:test';
import { isInspectorStillImage } from '../lib/browser/inspector/edit-target.js';
import { readInspectorAdjustSnapshot } from '../lib/browser/inspector/adjust-fields.js';
import { maskSourceOptionsForSources } from '../lib/browser/inspector/mask-fields.js';
import { layerSnapshotChromaKey } from '../lib/browser/inspector/field-mappings.js';
import { resolveTimelineClipName } from '../lib/browser/timeline-selection-model.js';
import { timelineMethod } from './helpers/perspective-transition-fixture.mjs';

const treeItemSnapshot = timelineMethod('treeItemSnapshot', { readInspectorAdjustSnapshot, maskSourceOptionsForSources });
const snapshotForSelection = timelineMethod('snapshotForSelection', {
  readInspectorAdjustSnapshot, maskSourceOptionsForSources, layerSnapshotChromaKey, resolveTimelineClipName
});

test('v2 写真 item / layer の source id を sources の path に解決する', () => {
  const sourceMap = new Map([['s2', { path: 'assets/photo.webp' }]]);
  const raw = { id: 'photo', at: 0, duration: 150, source: { kind: 'media', src: 's2' } };
  const item = treeItemSnapshot.call({ fps: 30, sourceMap, expandedTimelineTreeRows: [],
    trackDisplayNameForItem: () => 'Video' },
    { kind: 'item', id: 'photo', itemKind: 'media', trackId: 'video' }, raw);
  assert.equal(item.src, 's2');
  assert.equal(item.sourcePath, 'assets/photo.webp');
  assert.equal(isInspectorStillImage(item.sourcePath), true);
  assert.equal(isInspectorStillImage(item.src), false);

  const layer = snapshotForSelection.call({ fps: 30, sourceMap,
    layers: [{ id: 'photo', kind: 'baked', t: 0, duration: 5, src: 's2' }],
    rawV2Item: () => raw, rawKeyframeItem: () => raw,
    trackDisplayNameForItem: () => 'Video' }, { kind: 'layer', id: 'photo' });
  assert.equal(layer.src, 's2');
  assert.equal(layer.sourcePath, 'assets/photo.webp');
  assert.equal(isInspectorStillImage(layer.sourcePath), true);
});
