import assert from 'node:assert/strict';
import test from 'node:test';
import editStore from '@akari-video/edit-store';
import { indexEditV2Items } from '../lib/common/edit-v2-mutations.js';

import {
  canvasChildChipSpan,
  cutMediaRowHeight,
  timelineCanvasRowGeometry,
  timelineItemRenderRoute,
  timelineTrackHeight,
} from '../lib/browser/timeline/timeline-canvas-row-layout.js';
import { applyTimelineCollapsedRows, buildTimelineTreeRows } from '../lib/browser/timeline/timeline-tree-model.js';

const { readInternalEdit, projectLegacyEdit } = editStore;

function item(id, source, children = []) {
  return {
    id, at: 2, duration: 3, atFrames: 60, durationFrames: 90,
    source, children, declaration: { id, at: 60, duration: 90 },
    legacy: { collection: source.kind === 'media' ? 'cuts' : 'layers', index: 0 },
  };
}

test('media 2 個と html・shape の子は、畳むと親の行だけ、開くと子の行だけへ出る', () => {
  const children = [
    item('image-1', { kind: 'media' }),
    item('frame-1', { kind: 'media' }),
    item('html-1', { kind: 'html', html: 'overlays/card.html' }),
    item('shape-1', { kind: 'shape' }),
  ];
  const group = item('g-1', { kind: 'group' }, children);
  const expanded = buildTimelineTreeRows([{ id: 'v1', items: [group] }], { includeAllItems: true });
  const collapsed = applyTimelineCollapsedRows(expanded, new Set(['g-1']));
  const open = applyTimelineCollapsedRows(expanded, new Set());
  const locations = new Map([['g-1', { trackId: 'v1' }],
    ...children.map(child => [child.id, { parentId: 'g-1', trackId: 'v1' }])]);
  assert.deepEqual(collapsed.map(row => row.id), ['g-1']);
  assert.deepEqual(collapsed[0].ticks.map(tick => tick.id), children.map(child => child.id));
  for (const child of children) {
    assert.equal(timelineItemRenderRoute(child.id, locations, collapsed), 'hidden');
    assert.equal(timelineItemRenderRoute(child.id, locations, open), 'tree');
    assert.equal(open.find(row => row.id === child.id).parentId, 'g-1');
  }
  assert.equal(timelineItemRenderRoute('outside', locations, collapsed), 'legacy');
  assert.equal(timelineItemRenderRoute('', locations, collapsed), 'hidden');
});

test('畳んだ帯の子の細いチップはキャンバスの固定尺で切る', () => {
  assert.deepEqual(canvasChildChipSpan({ at: 2, duration: 4 }, { at: 1, duration: 3 }),
    { left: 0, width: 0.5 });
  assert.deepEqual(canvasChildChipSpan({ at: 2, duration: 4 }, { at: 5, duration: 3 }),
    { left: 0.75, width: 0.25 });
  assert.equal(canvasChildChipSpan({ at: 2, duration: 4 }, { at: 6, duration: 1 }), undefined);
});

test('v2 の media 子は互換 layers 投影に現れても段直下へ描かない', () => {
  const document = {
    version: 2, output: { width: 1080, height: 1920, fps: 30 },
    sources: [{ id: 'image', path: 'assets/image.png' }],
    tracks: [{ id: 'v1', lane: 'visual', items: [{
      id: 'g-1', at: 60, duration: 90,
      source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } },
      items: ['image-1', 'frame-1'].map(id => ({
        id, at: 0, duration: 90, source: { kind: 'media', src: 'image', in: 0, out: 3 }
      }))
    }] }]
  };
  const internal = readInternalEdit(document);
  const projected = projectLegacyEdit(internal);
  const locations = indexEditV2Items(document);
  const expanded = buildTimelineTreeRows(internal.tracks, { includeAllItems: true });
  const collapsed = applyTimelineCollapsedRows(expanded, new Set(['g-1']));
  assert.deepEqual(projected.layers.map(layer => layer.id), ['image-1', 'frame-1']);
  for (const layer of projected.layers) {
    assert.equal(locations.get(layer.id).parentId, 'g-1');
    assert.equal(timelineItemRenderRoute(layer.id, locations, collapsed), 'hidden');
    assert.equal(timelineItemRenderRoute(layer.id, locations, expanded), 'tree');
  }
});

test('キャンバス見出しは字幕高、開いた子とプロパティ行は通常高で詰めて並ぶ', () => {
  const rows = [
    { id: 'g-1', sourceKind: 'group' },
    { id: 'image-1', sourceKind: 'media' },
    { id: 'frame-1', sourceKind: 'media' },
  ];
  const layout = timelineCanvasRowGeometry(rows, 58, 25, 3, id => id === 'image-1' ? 1 : 0);
  assert.deepEqual(layout.rows.get('g-1'), { top: 58, height: 22, propertyTops: [] });
  assert.deepEqual(layout.rows.get('image-1'), { top: 83, height: 55, propertyTops: [141] });
  assert.deepEqual(layout.rows.get('frame-1'), { top: 199, height: 55, propertyTops: [] });
  assert.equal(layout.requiredHeight, 257);
  const canvasOnly = timelineCanvasRowGeometry([rows[0]], 58, 25, 3, () => 0, 25);
  assert.deepEqual(canvasOnly.rows.get('g-1'), { top: 25, height: 22, propertyTops: [] });
  assert.equal(canvasOnly.requiredHeight, 50);
});

test('通常 cut のメディア高は木の行の有無で選び、行高の変更をそのまま反映する', () => {
  assert.equal(cutMediaRowHeight(106, 56, false), 106);
  assert.equal(cutMediaRowHeight(106, 56, true), 56);
  assert.equal(cutMediaRowHeight(106, 72, true), 72);
  assert.equal(cutMediaRowHeight(106, undefined, true), 106);
});

test('木の行が無いときは既定高を守り、展開行は上限なしで積む', () => {
  const noRows = timelineCanvasRowGeometry([], 24, 24, 2, () => 0);
  assert.equal(noRows.requiredHeight, 0);
  assert.equal(timelineTrackHeight(56, noRows), 56);

  const oneCanvas = timelineCanvasRowGeometry(
    [{ id: 'g', sourceKind: 'group' }], 24, 24, 2, () => 0
  );
  assert.equal(timelineTrackHeight(56, oneCanvas), 56);

  const manyRows = timelineCanvasRowGeometry(
    Array.from({ length: 12 }, (_, index) => ({ id: `child-${index}`, sourceKind: 'media' })),
    24, 24, 2, id => id === 'child-0' ? 2 : 0
  );
  assert.equal(manyRows.requiredHeight, 360);
  assert.equal(timelineTrackHeight(240, manyRows), 360);
});
