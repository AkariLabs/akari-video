import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { duplicatePreviewItem } from '../lib/common/preview-duplicate.js';
import { lintProjectCandidates } from '../../../../../packages/edit-store/lib/write-gate.js';

test('duplicates a top-level visual item into the next higher track and keeps the source unchanged', () => {
  const source = JSON.stringify({ version: 2, tracks: [{ id: 'v1', lane: 'visual', items: [
    { id: 'title', locked: true, transform: { x: 10, y: 0 }, source: { kind: 'html' } }
  ] }] });
  const doc = JSON.parse(duplicatePreviewItem(source, { itemId: 'title', transform: { x: 50 } }));
  assert.equal(doc.tracks.length, 2);
  assert.equal(doc.tracks[0].items.length, 1);
  assert.equal(doc.tracks[1].id, 'v2');
  assert.equal(doc.tracks[1].lane, 'visual');
  assert.equal(doc.tracks[1].items.length, 1);
  assert.deepEqual(doc.tracks[0].items[0].transform, { x: 10, y: 0 });
  assert.deepEqual(doc.tracks[1].items[0].transform, { x: 50, y: 0 });
  assert.equal(doc.tracks[1].items[0].id, 'title-copy-1');
  assert.equal(doc.tracks[1].items[0].locked, false);
});

test('duplicates nested and legacy overlays with collision-free ids', () => {
  const nested = JSON.stringify({ version: 2, tracks: [{ id: 'v1', lane: 'visual', items: [
    { id: 'bag', items: [{ id: 'part' }, { id: 'part-copy-1' }] }
  ] }] });
  const doc = JSON.parse(duplicatePreviewItem(nested, { itemId: 'part', transform: { y: 5 } }));
  assert.equal(doc.tracks[0].items[0].items[1].id, 'part-copy-2');
  assert.equal(doc.tracks.length, 1);
  const legacy = JSON.parse(duplicatePreviewItem(JSON.stringify({ overlays: [{ id: 'o1' }] }),
    { itemId: 'o1', transform: { x: 5 } }));
  assert.equal(legacy.overlays[1].id, 'o1-copy-1');
  const group = JSON.parse(duplicatePreviewItem(nested, { itemId: 'bag', transform: { x: 8 } }));
  assert.equal(group.tracks[1].items[0].id, 'bag-copy-1');
  assert.equal(group.tracks[1].items[0].items[0].id, 'part-copy-2');
});

test('a duplicated top-level shape gets a unique visual track immediately above its source and passes edit-lint', async () => {
  const shape = (id, x = 0) => ({ id, at: 0, duration: 90,
    source: { kind: 'shape', shape: 'rect' }, transform: { x, y: 0 } });
  const before = { version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [],
    tracks: [{ id: 'a1', lane: 'audio', items: [] },
      { id: 'v1', lane: 'visual', items: [shape('original')] },
      { id: 'v2', lane: 'visual', items: [shape('foreground')] },
      { id: 'v3', lane: 'visual', items: [shape('other')] }] };
  const after = JSON.parse(duplicatePreviewItem(JSON.stringify(before),
    { itemId: 'original', transform: { x: 120, y: 30 } }));
  assert.deepEqual(after.tracks.map(track => track.id), ['a1', 'v1', 'v4', 'v2', 'v3']);
  assert.deepEqual(after.tracks[1].items, before.tracks[1].items);
  assert.equal(after.tracks[2].items[0].id, 'original-copy-1');
  assert.deepEqual(after.tracks[2].items[0].transform, { x: 120, y: 30 });
  const root = mkdtempSync(join(tmpdir(), 'h1-duplicate-annotations-'));
  try {
    writeFileSync(join(root, 'edit.json'), JSON.stringify(before));
    const overlapping = structuredClone(before);
    overlapping.tracks[1].items.push(after.tracks[2].items[0]);
    const rejected = await lintProjectCandidates(root, { 'edit.json': JSON.stringify(overlapping) });
    assert.equal(rejected.pass, false);
    assert.ok(rejected.findings.some(finding => finding.check === 'v2.track-no-overlap'));
    const result = await lintProjectCandidates(root, { 'edit.json': JSON.stringify(after) });
    assert.equal(result.pass, true, result.errors.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('overlapping children stay inside their canvas and pass edit-lint', async () => {
  const child = id => ({ id, at: 0, duration: 90, source: { kind: 'shape', shape: 'rect' } });
  const before = { version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [],
    tracks: [{ id: 'v1', lane: 'visual', items: [{ id: 'bag', at: 0, duration: 90,
      source: { kind: 'group' }, items: [child('part')] }] }] };
  const after = JSON.parse(duplicatePreviewItem(JSON.stringify(before),
    { itemId: 'part', transform: { x: 40 } }));
  assert.equal(after.tracks.length, 1);
  assert.deepEqual(after.tracks[0].items[0].items.map(item => item.id), ['part', 'part-copy-1']);
  const root = mkdtempSync(join(tmpdir(), 'h1-duplicate-group-'));
  try {
    writeFileSync(join(root, 'edit.json'), JSON.stringify(before));
    const result = await lintProjectCandidates(root, { 'edit.json': JSON.stringify(after) });
    assert.equal(result.pass, true, result.errors.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
