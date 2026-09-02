import assert from 'node:assert/strict';
import test from 'node:test';

import {
    clampCaptionRangeToNeighbors,
    neighborWalls,
    usableNeighbors
} from '../lib/common/caption-overlap-guard.js';

const MIN = 0.15;
// 隙間なしの字幕列（文字起こし由来の典型）: a 0-2 / b 2-4 / c 4-6
const neighbors = [
    { id: 'a', start: 0, end: 2 },
    { id: 'b', start: 2, end: 4 },
    { id: 'c', start: 4, end: 6 }
];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('隣が無ければ変更しない', () => {
    const result = clampCaptionRangeToNeighbors({ id: 'b', start: 2.3, end: 4.3, mode: 'move', neighbors: [{ id: 'b', start: 2, end: 4 }], minDuration: MIN });
    assert.deepEqual(result, { start: 2.3, end: 4.3, clamped: false });
});

test('move で次の字幕へ食い込むと start = next.start − 尺 で止まる（1 px 相当の移動でも）', () => {
    const result = clampCaptionRangeToNeighbors({ id: 'b', start: 2.007, end: 4.007, mode: 'move', neighbors, minDuration: MIN });
    assert.equal(result.clamped, true);
    near(result.start, 2);
    near(result.end, 4);
    assert.equal(result.blockedBy?.id, 'c');
});

test('move で直前の字幕へ食い込むと start = prev.end で止まる', () => {
    const result = clampCaptionRangeToNeighbors({ id: 'b', start: 1.5, end: 3.5, mode: 'move', neighbors, minDuration: MIN });
    assert.equal(result.clamped, true);
    near(result.start, 2);
    near(result.end, 4);
    assert.equal(result.blockedBy?.id, 'a');
});

test('接触（end == 次の start）は許容し、クランプしない', () => {
    const result = clampCaptionRangeToNeighbors({ id: 'b', start: 2, end: 4, mode: 'move', neighbors, minDuration: MIN });
    assert.equal(result.clamped, false);
});

test('start 端トリムは prev.end で止まる', () => {
    const result = clampCaptionRangeToNeighbors({ id: 'b', start: 1.2, end: 4, mode: 'start', neighbors, minDuration: MIN });
    assert.equal(result.clamped, true);
    near(result.start, 2);
    near(result.end, 4);
    assert.equal(result.blockedBy?.id, 'a');
});

test('end 端トリムは next.start で止まる', () => {
    const result = clampCaptionRangeToNeighbors({ id: 'b', start: 2, end: 4.9, mode: 'end', neighbors, minDuration: MIN });
    assert.equal(result.clamped, true);
    near(result.start, 2);
    near(result.end, 4);
    assert.equal(result.blockedBy?.id, 'c');
});

test('端トリムのクランプは最小尺を下回らない', () => {
    // b を 3.9-4 に縮めて start を左へ引く: prev.end(2) で止まるが、end 側の壁が近い場合は最小尺を優先
    const tight = [{ id: 'a', start: 0, end: 3.95 }, { id: 'c', start: 4, end: 6 }];
    const result = clampCaptionRangeToNeighbors({ id: 'b', start: 3.7, end: 4, mode: 'start', neighbors: tight, minDuration: MIN });
    assert.equal(result.clamped, true);
    near(result.start, 4 - MIN);
});

test('隙間の無い列で move すると尺が入らなくても右の壁を越えない', () => {
    const packed = [{ id: 'a', start: 0, end: 2 }, { id: 'c', start: 2.5, end: 6 }];
    const result = clampCaptionRangeToNeighbors({ id: 'b', start: 1.8, end: 3.8, mode: 'move', neighbors: packed, minDuration: MIN });
    assert.equal(result.clamped, true);
    near(result.start, 2);
    assert.ok(result.end <= 2.5 + 1e-9);
});

test('別群（呼び出し側で除いた）は neighbors に入らないので無視される', () => {
    const result = clampCaptionRangeToNeighbors({ id: 'b', start: 1.5, end: 3.5, mode: 'move', neighbors: [], minDuration: MIN });
    assert.equal(result.clamped, false);
});

test('自分自身と不正な区間は隣から除く', () => {
    const usable = usableNeighbors('b', [...neighbors, { id: 'x', start: 5, end: 5 }, { id: 'y', start: Number.NaN, end: 1 }]);
    assert.deepEqual(usable.map(n => n.id), ['a', 'c']);
});

test('壁は区間の中心を基準に左右へ分ける', () => {
    const walls = neighborWalls(2.5, 4.5, usableNeighbors('b', neighbors));
    assert.equal(walls.left?.id, 'a');
    assert.equal(walls.right?.id, 'c');
});

test('不正な区間（end <= start・非有限）はそのまま返す', () => {
    assert.equal(clampCaptionRangeToNeighbors({ id: 'b', start: 3, end: 3, mode: 'move', neighbors, minDuration: MIN }).clamped, false);
    assert.equal(clampCaptionRangeToNeighbors({ id: 'b', start: Number.NaN, end: 3, mode: 'move', neighbors, minDuration: MIN }).clamped, false);
});

// ---- task 2026-09-02-timeline-followups-3: 0 秒側へ押し出さない / 正当な位置が無ければ元へ戻す ----
import { isValidCaptionRange } from '../lib/common/caption-overlap-guard.js';

test('0 秒に字幕がある状態で別の字幕を 0 秒へ寄せても start は負にならず、ドラッグ前の区間へ戻る', () => {
    // 実機 2026-09-02: 0:00 へずらすと -0:00 になった
    const result = clampCaptionRangeToNeighbors({
        id: 'b', start: -0.5, end: 1.5, mode: 'move',
        neighbors: [{ id: 'a', start: 0, end: 2 }], minDuration: MIN,
        fallback: { start: 2.2, end: 4.2 }
    });
    assert.equal(result.clamped, true);
    assert.deepEqual([result.start, result.end], [2.2, 4.2]);
    assert.equal(result.blockedBy?.id, 'a');
});

test('fallback が無ければ従来どおりクランプ結果を返す（互換）', () => {
    const result = clampCaptionRangeToNeighbors({ id: 'b', start: -0.5, end: 1.5, mode: 'move', neighbors: [{ id: 'a', start: 0, end: 2 }], minDuration: MIN });
    assert.equal(result.clamped, true);
    near(result.start, -2);
});

test('正当な位置へクランプできたときは fallback を使わない', () => {
    const result = clampCaptionRangeToNeighbors({ id: 'b', start: 2.007, end: 4.007, mode: 'move', neighbors, minDuration: MIN, fallback: { start: 9, end: 11 } });
    assert.equal(result.clamped, true);
    near(result.start, 2);
    near(result.end, 4);
});

test('isValidCaptionRange: 0 秒以上・隣と重ならない（接触は可）', () => {
    assert.equal(isValidCaptionRange(2, 4, neighbors.filter(n => n.id !== 'b')), true);
    assert.equal(isValidCaptionRange(-0.01, 2, []), false);
    assert.equal(isValidCaptionRange(1.9, 3.9, neighbors.filter(n => n.id !== 'b')), false);
    assert.equal(isValidCaptionRange(3, 3, []), false);
});
