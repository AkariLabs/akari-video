import assert from 'node:assert/strict';
import test from 'node:test';
import { DAIHON_SILENCE_DEFAULTS, findRowGaps } from '../lib/common/daihon-silence.js';

const row = (id, start, end, outStart = start) => ({ id, start, end, outStart });

test('既定値は 0.45 秒と 0.15 秒', () => assert.deepEqual(DAIHON_SILENCE_DEFAULTS, { minGapSec: 0.45, keepSec: 0.15 }));
test('2 行間の無音を返す', () => assert.deepEqual(findRowGaps([row('a', 0, 1), row('b', 1.7, 2)]), [{ prevId: 'a', nextId: 'b', start: 1, end: 1.7, span: 0.7 }]));
test('接している行は無音にしない', () => assert.deepEqual(findRowGaps([row('a', 0, 1), row('b', 1, 2)]), []));
test('重なる行は無音にしない', () => assert.deepEqual(findRowGaps([row('a', 0, 2), row('b', 1, 3)]), []));
test('カット済み行を飛ばして非カット行同士を比べる', () => assert.deepEqual(findRowGaps([row('a', 0, 1), row('x', 1.1, 2, null), row('b', 3, 4)]), [{ prevId: 'a', nextId: 'b', start: 1, end: 3, span: 2 }]));
test('複数ギャップを入力順で返す', () => assert.deepEqual(findRowGaps([row('a', 0, 1), row('b', 2, 3), row('c', 5, 6)]).map(gap => gap.span), [1, 2]));
test('1 行だけなら空', () => assert.deepEqual(findRowGaps([row('a', 0, 1)]), []));
test('全行カット済みなら空', () => assert.deepEqual(findRowGaps([row('a', 0, 1, null), row('b', 2, 3, null)]), []));
test('小数の境界をそのまま保持する', () => assert.deepEqual(findRowGaps([row('a', 0.1, 0.33), row('b', 0.81, 1)])[0], { prevId: 'a', nextId: 'b', start: 0.33, end: 0.81, span: 0.48000000000000004 }));
