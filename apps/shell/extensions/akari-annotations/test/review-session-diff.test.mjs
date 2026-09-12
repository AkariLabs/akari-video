import assert from 'node:assert/strict';
import test from 'node:test';
import { diffReviewSessionEdit } from '../lib/browser/review-session-diff.js';

const item = (id, at, duration, input = 0, output = duration / 10) => ({
  id, at, duration, source: { kind: 'media', src: 'src', in: input, out: output }
});
const edit = items => JSON.stringify({
  version: 2,
  output: { width: 640, height: 360, fps: 10 },
  sources: [{ id: 'src', path: 'clip.mp4', proxy: null }],
  tracks: [{ id: 'video', lane: 'visual', items }]
});

test('detects added, removed, moved, resized, and trimmed items in stable order', () => {
  const before = edit([item('removed', 0, 20), item('changed', 20, 30, 1, 4)]);
  const after = edit([item('added', 50, 10), item('changed', 30, 20, 2, 4)]);
  const result = diffReviewSessionEdit(before, after);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.changes.map(change => change.kind), ['added', 'removed', 'moved', 'resized', 'trimmed']);
  assert.deepEqual(result.changes.map(change => change.itemId), ['added', 'removed', 'changed', 'changed', 'changed']);
});

test('returns no changes for an identical edit', () => {
  const value = edit([item('same', 0, 10)]);
  assert.deepEqual(diffReviewSessionEdit(value, value), { status: 'ok', changes: [] });
});

test('rejects legacy snapshots without migration and reports unreadable input', () => {
  assert.deepEqual(diffReviewSessionEdit('{"version":0}', edit([])), { status: 'legacy-snapshot', version: 0 });
  assert.deepEqual(diffReviewSessionEdit('{"version":1}', edit([])), { status: 'legacy-snapshot', version: 1 });
  assert.equal(diffReviewSessionEdit('{broken', edit([])).status, 'unreadable');
  assert.equal(diffReviewSessionEdit(null, edit([])).status, 'unreadable');
});

test('detects changes in nested child items', () => {
  const group = at => ({
    id: 'group', at: 0, duration: 20, source: { kind: 'group' },
    items: [item('child', at, 10)]
  });
  const result = diffReviewSessionEdit(edit([group(0)]), edit([group(10)]));
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.changes.map(change => [change.itemId, change.kind]), [['child', 'moved']]);
});
