import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CUT_RANGE_MIN_SEC,
    clampCutRange,
    cutRangeBounds,
    cutRangePreviewSpans,
    cutRangeRatio,
    cutRangeReadout,
    cutRangeTime,
    cutRangeWindow,
    defaultCutRange,
    moveCutRangeEdge
} from '../lib/common/daihon-cut-range.js';

const silence = { kind: 'silence', start: 1, end: 2, limitStart: 1, limitEnd: 2 };
const word = { kind: 'word', start: 1.2, end: 1.65, limitStart: 1, limitEnd: 2 };

test('無音の可動域は無音区間そのもの', () => assert.deepEqual(cutRangeBounds(silence), { lo: 1, hi: 2 }));
test('語の可動域は前後 0.4 秒', () => assert.deepEqual(cutRangeBounds(word), { lo: 1, hi: 2 }));
test('語の可動域の開始は行境界で止まる', () => assert.deepEqual(
    cutRangeBounds({ ...word, limitStart: 1.1 }), { lo: 1.1, hi: 2 }
));
test('語の可動域の終了は行境界で止まる', () => assert.deepEqual(
    cutRangeBounds({ ...word, limitEnd: 1.9 }), { lo: 1, hi: 1.9 }
));
test('無音の既定範囲は頭を 0.15 秒残す', () => assert.deepEqual(defaultCutRange(silence, 0.15), { from: 1.15, to: 2 }));
test('語の既定範囲は発話区間そのもの', () => assert.deepEqual(defaultCutRange(word, 0.15), { from: 1.2, to: 1.65 }));
test('残す秒数が広すぎても最小幅を確保する', () => assert.deepEqual(defaultCutRange(silence, 2), { from: 1.95, to: 2 }));
test('負の残す秒数は無音先頭に丸める', () => assert.deepEqual(defaultCutRange(silence, -1), { from: 1, to: 2 }));
test('選択範囲を可動域へ収める', () => assert.deepEqual(clampCutRange({ from: 0, to: 3 }, { lo: 1, hi: 2 }), { from: 1, to: 2 }));
test('狭すぎる選択範囲を最小幅へ広げる', () => assert.deepEqual(clampCutRange({ from: 1.5, to: 1.51 }, { lo: 1, hi: 2 }), { from: 1.5, to: 1.55 }));
test('可動域自体が最小幅未満なら全体を返す', () => assert.deepEqual(clampCutRange({ from: 1, to: 2 }, { lo: 1, hi: 1.02 }), { from: 1, to: 1.02 }));
test('開始つまみは可動域の外へ出ない', () => assert.deepEqual(moveCutRangeEdge({ from: 1.2, to: 1.8 }, 'from', 0, { lo: 1, hi: 2 }), { from: 1, to: 1.8 }));
test('開始つまみは終了つまみを越えない', () => assert.deepEqual(moveCutRangeEdge({ from: 1.2, to: 1.8 }, 'from', 2, { lo: 1, hi: 2 }), { from: 1.75, to: 1.8 }));
test('終了つまみは可動域の外へ出ない', () => assert.deepEqual(moveCutRangeEdge({ from: 1.2, to: 1.8 }, 'to', 3, { lo: 1, hi: 2 }), { from: 1.2, to: 2 }));
test('終了つまみは開始つまみを越えない', () => assert.deepEqual(moveCutRangeEdge({ from: 1.2, to: 1.8 }, 'to', 0, { lo: 1, hi: 2 }), { from: 1.2, to: 1.25 }));
test('非有限値でつまみを動かしても現状を保つ', () => assert.deepEqual(moveCutRangeEdge({ from: 1.2, to: 1.8 }, 'to', NaN, { lo: 1, hi: 2 }), { from: 1.2, to: 1.8 }));
test('最小幅の定数は 0.05 秒', () => assert.equal(CUT_RANGE_MIN_SEC, 0.05));
test('無音の読み値には残す秒数が入る', () => assert.equal(cutRangeReadout(silence, { from: 1.15, to: 1.6 }), '切る 0.45 秒 · 残す 0.15 秒 · 1.15–1.60'));
test('語の読み値には切る秒数だけが入る', () => assert.equal(cutRangeReadout(word, { from: 1.23, to: 1.68 }), '切る 0.45 秒 · 1.23–1.68'));
test('窓は可動域の前後へ 0.9 秒広げる', () => assert.deepEqual(cutRangeWindow({ lo: 2, hi: 3 }), { start: 1.1, end: 3.9 }));
test('窓の開始は 0 秒より前へ出ない', () => assert.deepEqual(cutRangeWindow({ lo: 0.2, hi: 1 }), { start: 0, end: 1.9 }));
test('窓は任意の余白を使える', () => assert.deepEqual(cutRangeWindow({ lo: 2, hi: 3 }, 0.2), { start: 1.8, end: 3.2 }));
test('秒から比率への変換は範囲内で往復する', () => assert.equal(cutRangeTime(cutRangeRatio(2, { start: 1, end: 3 }), { start: 1, end: 3 }), 2));
test('秒から比率への変換は 0..1 に収める', () => assert.deepEqual([-1, 4].map(value => cutRangeRatio(value, { start: 1, end: 3 })), [0, 1]));
test('幅ゼロの窓の比率は 0', () => assert.equal(cutRangeRatio(3, { start: 2, end: 2 }), 0));
test('比率から秒への変換は 0..1 に収める', () => assert.deepEqual([-1, 2].map(value => cutRangeTime(value, { start: 1, end: 3 })), [1, 3]));
test('切らずに聞く範囲は選択の前後を含む', () => assert.deepEqual(cutRangePreviewSpans({ from: 2, to: 3 }, { start: 1, end: 4 }, 'intact'), [{ from: 1.2, to: 3.8 }]));
test('切らずに聞く範囲は窓で切り詰める', () => assert.deepEqual(cutRangePreviewSpans({ from: 1.2, to: 3.8 }, { start: 1, end: 4 }, 'intact'), [{ from: 1, to: 4 }]));
test('詰めた結果は前半と後半の二段に分ける', () => assert.deepEqual(cutRangePreviewSpans({ from: 2, to: 3 }, { start: 1, end: 4 }, 'tightened'), [{ from: 1.2, to: 2 }, { from: 3, to: 3.8 }]));
test('詰めた結果の幅ゼロ断片は落とす', () => assert.deepEqual(cutRangePreviewSpans({ from: 1, to: 3 }, { start: 1, end: 4 }, 'tightened'), [{ from: 3, to: 3.8 }]));
