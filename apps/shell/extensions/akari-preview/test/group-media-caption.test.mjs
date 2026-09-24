import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { readInternalEdit } from '@akari-video/edit-store';
import { collectItems, groupedCaptionBagSourceIds, projectDetachedCaptionItems, projectPreviewCaptionRows } from '../lib/common/preview-items.js';
import { resolvePreviewCaptionTrackOrder } from '../lib/common/caption-track-order.js';

const internal = readInternalEdit(JSON.stringify({
  version: 2, output: { width: 640, height: 360, fps: 30 },
  sources: [{ id: 'image', path: 'assets/image.png' }],
  tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'g', at: 30, duration: 60,
    source: { kind: 'group' }, transform: { x: 80, scale: 0.5, rotate: 20 }, opacity: 0.5,
    items: [
      { id: 'photo', at: 0, duration: 60, source: { kind: 'media', src: 'image', in: 0, out: 2 } },
      { id: 'line-item', at: 12, duration: 36,
        source: { kind: 'caption', path: 'captions.json', id: 'c-0001' } }
    ] }] }]
}));

test('preview layer order inserts group children between direct siblings', () => {
  const raw = readFileSync(new URL('../../../../../evidence/c0a-group-media-render/fixture-order/edit.json', import.meta.url), 'utf8');
  assert.deepEqual(collectItems(readInternalEdit(raw), 'layers').map(item => item.id), ['A', 'B', 'C', 'D', 'E']);
});

test('preview receives the grouped photo as a clipped transformed layer', () => {
  const layers = collectItems(internal, 'layers');
  assert.equal(layers.length, 1);
  assert.equal(layers[0].id, 'photo');
  assert.equal(layers[0].declaration.kind, 'video');
  assert.equal(layers[0].declaration.opacity, 0.5);
  assert.equal(layers[0].declaration.transform.x, 80);
  assert.equal(layers[0].at, 1);
  assert.equal(layers[0].duration, 2);
});

test('detached caption uses its own output interval once and inherits group appearance', () => {
  const projected = projectDetachedCaptionItems(internal, [
    { id: 'c-0001', start: 0, end: 4, text: '一行' }
  ]);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].id, 'line-item');
  assert.equal(projected[0].sourceCueId, 'c-0001');
  assert.equal(projected[0].start, 1.4);
  assert.equal(projected[0].end, 2.6);
  assert.equal(projected[0].groupTransform.rotate, 20);
  assert.equal(projected[0].groupOpacity, 0.5);
  assert.equal(projected[0].resolvedTimeline, false);
  assert.equal(projected[0].groupTrackId, 'v');
  assert.equal(Object.hasOwn(projected[0], 'groupFontFamily'), false);
  const z = resolvePreviewCaptionTrackOrder(internal.tracks, true);
  assert.equal(z.captionTrackId, 'v');
});

test('caption bag nested in a group projects source rows into the parent interval', () => {
  const bagInternal = readInternalEdit(JSON.stringify({
    version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
    tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'g', at: 30, duration: 60,
      source: { kind: 'group' }, transform: { rotate: 18 }, opacity: 0.5,
      items: [{ id: 'bag', at: 0, duration: 60,
        source: { kind: 'captions', path: 'captions.json', exclude: [] }, items: [] }] }] }]
  }));
  const projected = projectDetachedCaptionItems(bagInternal, [{ id: 'c-0001', start: 1.4,
    end: 2.6, text: '行' }]);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].id, 'bag::c-0001');
  assert.equal(projected[0].groupBag, true);
  assert.equal(projected[0].start, 2.4);
  assert.equal(projected[0].end, 3);
  assert.equal(projected[0].groupOpacity, 0.5);
  assert.equal(projected[0].groupTrackId, 'v');
  assert.equal(resolvePreviewCaptionTrackOrder(bagInternal.tracks, true).captionTrackId, 'v');
  assert.deepEqual([...groupedCaptionBagSourceIds(bagInternal, [{ id: 'c-0001' }])], ['c-0001']);
});

test('excluded bag row and grouped caption item draw the source cue once', () => {
  const raw = readFileSync(new URL('../../../../../evidence/c0a-group-media-render/fixture/edit.json', import.meta.url), 'utf8');
  const cues = projectPreviewCaptionRows(readInternalEdit(raw), [
    { id: 'c-0001', start: 1.4, end: 2.6, text: '一行' }
  ]);
  assert.deepEqual(cues.map(cue => cue.id), ['caption-line']);
  assert.equal(cues.filter(cue => (cue.sourceCueId ?? cue.id) === 'c-0001').length, 1);
});

// b76f1275 preview-items.ts: only direct track.items were classified and sorted.
function baselineCollectItems(internal, bucket) {
  const items = [];
  for (const track of internal.tracks) for (const item of track.items) {
    let resolved;
    switch (String(item.source.kind)) {
      case 'media': resolved = item.legacy.collection === 'layers' ? 'layers'
        : item.legacy.collection === 'cuts' ? 'cuts' : undefined; break;
      case 'html': resolved = 'overlays'; break;
      case 'telop':
      case 'filter': resolved = 'layers'; break;
      default: resolved = undefined; break;
    }
    if (resolved === bucket) items.push(item);
  }
  return items.sort((a, b) => a.legacy.index - b.legacy.index);
}

const directCases = JSON.parse(readFileSync(new URL('../../../../../evidence/c0a-group-media-render/fixture-direct-only-cases.json', import.meta.url), 'utf8'));
for (const fixture of directCases) {
  test(`direct-only ${fixture.name} keeps the b76f1275 preview buckets`, () => {
    const direct = readInternalEdit(JSON.stringify({
      version: 2, output: { width: 640, height: 360, fps: 30 },
      sources: [{ id: 'still', path: 'assets/still.png' }, { id: 'video', path: 'assets/video.mp4' }],
      tracks: fixture.tracks
    }));
    for (const bucket of ['cuts', 'layers', 'overlays']) {
      assert.deepEqual(collectItems(direct, bucket), baselineCollectItems(direct, bucket));
    }
  });
}
