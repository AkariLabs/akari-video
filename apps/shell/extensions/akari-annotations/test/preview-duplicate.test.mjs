import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicatePreviewItem } from '../lib/common/preview-duplicate.js';

test('duplicates a visual item after its source and keeps the source unchanged', () => {
  const source = JSON.stringify({ version: 2, tracks: [{ lane: 'visual', items: [
    { id: 'title', locked: true, transform: { x: 10, y: 0 }, source: { kind: 'html' } }
  ] }] });
  const doc = JSON.parse(duplicatePreviewItem(source, { itemId: 'title', transform: { x: 50 } }));
  assert.equal(doc.tracks[0].items.length, 2);
  assert.deepEqual(doc.tracks[0].items[0].transform, { x: 10, y: 0 });
  assert.deepEqual(doc.tracks[0].items[1].transform, { x: 50, y: 0 });
  assert.equal(doc.tracks[0].items[1].id, 'title-copy-1');
  assert.equal(doc.tracks[0].items[1].locked, false);
});

test('duplicates nested and legacy overlays with collision-free ids', () => {
  const nested = JSON.stringify({ version: 2, tracks: [{ lane: 'visual', items: [
    { id: 'bag', items: [{ id: 'part' }, { id: 'part-copy-1' }] }
  ] }] });
  const doc = JSON.parse(duplicatePreviewItem(nested, { itemId: 'part', transform: { y: 5 } }));
  assert.equal(doc.tracks[0].items[0].items[1].id, 'part-copy-2');
  const legacy = JSON.parse(duplicatePreviewItem(JSON.stringify({ overlays: [{ id: 'o1' }] }),
    { itemId: 'o1', transform: { x: 5 } }));
  assert.equal(legacy.overlays[1].id, 'o1-copy-1');
  const group = JSON.parse(duplicatePreviewItem(nested, { itemId: 'bag', transform: { x: 8 } }));
  assert.equal(group.tracks[0].items[1].id, 'bag-copy-1');
  assert.equal(group.tracks[0].items[1].items[0].id, 'part-copy-2');
});
