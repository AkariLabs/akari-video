import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasForTimelineRow, timelineRowAtClientY, timelineRowAtY } from '../lib/browser/timeline/canvas-row-drop.js';

const rows = [
    { id: 'g', trackId: 'canvas' },
    { id: 'child', trackId: 'canvas', parentId: 'g' },
    { id: 'base', trackId: 'base' }
];
const layouts = [{ id: 'canvas', top: 10, height: 96 }, { id: 'base', top: 110, height: 64 }];
const indices = new Map([['g', 1], ['child', 2], ['base', 1]]);
const hit = y => timelineRowAtY(y, rows, layouts, indices, () => 32, 2);
const owner = row => canvasForTimelineRow(row, rows, id => id === 'g');

test('ストリップの y だけで空のキャンバス行と展開した子の行を特定する', () => {
    assert.equal(owner(hit(50)), 'g');
    assert.equal(owner(hit(81)), 'g');
});

test('段見出し・行間・通常の行には canvasId を付けない', () => {
    assert.equal(owner(hit(25)), undefined);
    assert.equal(owner(hit(41)), undefined);
    assert.equal(owner(hit(157)), undefined);
    assert.equal(hit(143)?.id, 'base');
    assert.equal(owner(hit(143)), undefined);
});

test('縦スクロール中も画面上の行矩形からキャンバスを選ぶ', () => {
    const scrollTop = 44;
    const stripTop = 444;
    const rowRects = [{ id: 'g', top: 520, bottom: 568 }];
    assert.equal(scrollTop > 0 && stripTop < rowRects[0].top, true);
    assert.equal(owner(timelineRowAtClientY(543, rows, rowRects)), 'g');
    assert.equal(owner(timelineRowAtClientY(500, rows, rowRects)), undefined);
});
