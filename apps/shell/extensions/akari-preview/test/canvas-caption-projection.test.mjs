import assert from 'node:assert/strict';
import test from 'node:test';
import { projectCanvasCaptionRows } from '../lib/common/canvas-caption-projection.js';

test('除外済みの元字幕を明示的な子として 1 回だけ復元し、固定尺で切る', () => {
  const row = { id: 'c-1', start: 11, end: 14, text: '本文', clockDomain: 'output', timeDomain: 'output' };
  const child = { id: 'cap-c-1', at: 21, duration: 1, source: { kind: 'caption', id: 'c-1' },
    declaration: {}, children: [] };
  const internal = { tracks: [{ id: 'kt', items: [{ id: 'g', source: { kind: 'group' }, declaration: {},
    children: [child] }] }] };
  const original = structuredClone(row);
  const projected = projectCanvasCaptionRows(internal, [row]);
  assert.deepEqual(projected.map(item => [item.id, item.sourceCueId, item.canvasTrackId, item.start, item.end]),
    [['cap-c-1', 'c-1', 'kt', 21, 22]]);
  assert.deepEqual(row, original);
});
