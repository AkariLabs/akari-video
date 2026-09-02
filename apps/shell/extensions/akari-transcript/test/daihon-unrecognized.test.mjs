import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    clipUnrecognizedToRange,
    placeUnrecognized
} = require('../lib/common/daihon-unrecognized.js');

const words = [
    { text: '前', start: 1, end: 1.5 },
    { text: '中', start: 2, end: 2.5 },
    { text: '後', start: 3, end: 3.5 }
];

test('語間 span は直後の語の前へ置く', () => {
    assert.equal(placeUnrecognized(words, [{ start: 1.7, end: 1.8 }])[0].beforeWordIndex, 1);
});

test('行頭 span は最初の語の前へ置く', () => {
    assert.equal(placeUnrecognized(words, [{ start: 0.7, end: 0.9 }])[0].beforeWordIndex, 0);
});

test('行末 span は beforeWordIndex null になる', () => {
    assert.equal(placeUnrecognized(words, [{ start: 3.7, end: 3.9 }])[0].beforeWordIndex, null);
});

test('words null の span はすべて行末になる', () => {
    assert.deepEqual(placeUnrecognized(null, [{ start: 2, end: 2.1 }]).map(item => item.beforeWordIndex), [null]);
});

test('words 空配列の複数 span はすべて行末になる', () => {
    assert.deepEqual(placeUnrecognized([], [{ start: 2, end: 2.1 }, { start: 1, end: 1.1 }])
        .map(item => item.beforeWordIndex), [null, null]);
});

test('複数 span は入力順に関係なく時刻順へ並ぶ', () => {
    const placed = placeUnrecognized(words, [
        { start: 3.7, end: 3.9 },
        { start: 0.7, end: 0.9 },
        { start: 2.7, end: 2.9 }
    ]);
    assert.deepEqual(placed.map(item => [item.span.start, item.beforeWordIndex]), [
        [0.7, 0], [2.7, 2], [3.7, null]
    ]);
});

test('span.start が語 end と同じならその語の直後へ置く', () => {
    assert.equal(placeUnrecognized(words, [{ start: 1.5, end: 1.6 }])[0].beforeWordIndex, 1);
});

test('最後に条件を満たした語の直後を選ぶ', () => {
    assert.equal(placeUnrecognized(words, [{ start: 2.5, end: 2.6 }])[0].beforeWordIndex, 2);
});

test('配置結果は入力 span を変更しない', () => {
    const spans = [{ start: 2, end: 2.2 }, { start: 1, end: 1.2 }];
    const before = JSON.stringify(spans);
    placeUnrecognized(words, spans);
    assert.equal(JSON.stringify(spans), before);
});

test('clipUnrecognizedToRange は ms 丸め・クリップ・隣接結合を行う', () => {
    assert.deepEqual(clipUnrecognizedToRange([
        { start: 0.9996, end: 1.2 },
        { start: 1.2, end: 1.4 },
        { start: 2.8, end: 3.0004 }
    ], 1, 3), [{ start: 1, end: 1.4 }, { start: 2.8, end: 3 }]);
});

test('clipUnrecognizedToRange は範囲外と 0 長区間を捨てる', () => {
    assert.deepEqual(clipUnrecognizedToRange([
        { start: 0, end: 0.5 }, { start: 1.2, end: 1.2 }, { start: 3.1, end: 4 }
    ], 1, 3), []);
});
