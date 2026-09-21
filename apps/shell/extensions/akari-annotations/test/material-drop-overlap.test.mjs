import assert from 'node:assert/strict';
import test from 'node:test';
import { materialRangeOverlaps, materialOverlapInsertIndex } from '../lib/common/material-drop-overlap.js';

const occupied = Object.freeze([Object.freeze({ at: 30, duration: 60 })]);
for (const [name, range, overlaps] of [
    ['手前で接するだけ', { at: 0, duration: 30 }, false],
    ['後ろで接するだけ', { at: 90, duration: 30 }, false],
    ['手前から1フレーム重なる', { at: 0, duration: 31 }, true],
    ['後ろから1フレーム重なる', { at: 89, duration: 30 }, true],
    ['既存の中に内包', { at: 40, duration: 10 }, true],
    ['既存を内包', { at: 0, duration: 120 }, true],
    ['同じ範囲', { at: 30, duration: 60 }, true],
    ['離れている', { at: 120, duration: 30 }, false]
]) {
    test(`素材のフレーム範囲: ${name}`, () => {
        assert.equal(materialRangeOverlaps(occupied, Object.freeze(range)), overlaps);
    });
}

test('空トラックには重ならない', () => {
    assert.equal(materialRangeOverlaps([], { at: 0, duration: 100 }), false);
});

test('隣接行の挿入位置は映像が rawIndex + 1、音が rawIndex', () => {
    const tracks = [
        { id: 'a1', lane: 'audio', items: occupied },
        { id: 'a2', lane: 'audio', items: occupied },
        { id: 'a3', lane: 'audio', items: occupied },
        { id: 'v1', lane: 'visual', items: occupied },
        { id: 'v2', lane: 'visual', items: occupied }
    ];
    const before = JSON.stringify(tracks);
    assert.equal(materialOverlapInsertIndex(tracks, 'a2', { at: 40, duration: 1 }), 1);
    assert.equal(materialOverlapInsertIndex(tracks, 'v1', { at: 40, duration: 1 }), 4);
    assert.equal(materialOverlapInsertIndex(tracks, 'v1', { at: 90, duration: 1 }), undefined);
    assert.equal(materialOverlapInsertIndex(tracks, undefined, { at: 40, duration: 1 }), undefined);
    assert.equal(materialOverlapInsertIndex(tracks, 'missing', { at: 40, duration: 1 }), undefined);
    assert.equal(JSON.stringify(tracks), before);
});
