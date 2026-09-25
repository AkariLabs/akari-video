import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { duplicatePreviewItemSource } from '../lib/common/preview-duplicate-fallback.js';
import { lintProjectCandidates } from '../../../../../packages/edit-store/lib/write-gate.js';

test('closed-timeline duplicate creates one higher visual track and passes edit-lint', async () => {
  const shape = (id, x = 0) => ({ id, at: 0, duration: 90,
    source: { kind: 'shape', shape: 'rect' }, transform: { x, y: 0 } });
  const before = { version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [],
    tracks: [{ id: 'a1', lane: 'audio', items: [] },
      { id: 'v1', lane: 'visual', items: [shape('original')] },
      { id: 'v2', lane: 'visual', items: [shape('foreground')] },
      { id: 'v3', lane: 'visual', items: [shape('other')] }] };
  const after = JSON.parse(duplicatePreviewItemSource(JSON.stringify(before), 'original', { x: 120, y: 30 }));
  assert.deepEqual(after.tracks.map(track => track.id), ['a1', 'v1', 'v4', 'v2', 'v3']);
  assert.deepEqual(after.tracks[1].items, before.tracks[1].items);
  assert.equal(after.tracks[2].items[0].id, 'original-copy-1');
  assert.deepEqual(after.tracks[2].items[0].transform, { x: 120, y: 30 });
  const root = mkdtempSync(join(tmpdir(), 'h1-duplicate-preview-'));
  try {
    writeFileSync(join(root, 'edit.json'), JSON.stringify(before));
    const result = await lintProjectCandidates(root, { 'edit.json': JSON.stringify(after) });
    assert.equal(result.pass, true, result.errors.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
