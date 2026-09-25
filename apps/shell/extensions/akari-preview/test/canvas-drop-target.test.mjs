import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasAtFrame, canvasDropHint, canvasDropTargets } from '../lib/common/canvas-drop-target.js';

test('仮枠の下に対象キャンバスを示し、⌥ と区間外では示さない', () => {
    const targets = canvasDropTargets([{ lane: 'visual', items: [{ id: 'g', at: 300, duration: 150,
        source: { kind: 'group', canvas: {} }, items: [] }] }]);
    assert.equal(canvasDropHint(targets, 12, 30), 'キャンバス 1 に入ります');
    assert.equal(canvasDropHint(targets, 12, 30, true), '');
    assert.equal(canvasDropHint(targets, 15, 30), '');
});

test('プレビューの行き先は入れ子の内側を優先する', () => {
    const targets = canvasDropTargets([{ lane: 'visual', items: [
        { id: 'outer', at: 300, duration: 150, source: { kind: 'group', canvas: {} }, items: [
            { id: 'inner', at: 30, duration: 60, source: { kind: 'group', canvas: {} }, items: [] }
        ] },
        { id: 'sibling', at: 300, duration: 150, source: { kind: 'group', canvas: {} }, items: [] }
    ] }]);
    assert.equal(canvasAtFrame(targets, 360)?.id, 'inner');
    assert.equal(canvasDropHint(targets, 12, 30), 'キャンバス 3 に入ります');
});
