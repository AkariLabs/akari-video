import assert from 'node:assert/strict';
import test from 'node:test';
import { clampRowCutRange, normalizeCutRanges } from '../lib/common/daihon-cut-plan.js';

const row = (id, start, end) => ({ id, start, end });
const cut = (inside, extra = {}) => ({ in: inside[0], out: inside[1], kind: 'row', captionId: 'a', label: '行', ...extra });

test('単独行へ前後 0.04 秒を足す', () => assert.deepEqual(clampRowCutRange(row('a', 1, 2)), cut([0.96, 2.04])));
test('先頭行は 0 秒より前へ出さない', () => assert.equal(clampRowCutRange(row('a', 0.01, 1)).in, 0));
test('前行 end で開始をクランプする', () => assert.equal(clampRowCutRange(row('a', 1, 2), row('p', 0, 0.99)).in, 0.99));
test('次行 start で終了をクランプする', () => assert.equal(clampRowCutRange(row('a', 1, 2), undefined, row('n', 2.02, 3)).out, 2.02));
test('captionId と行ラベルを付ける', () => assert.deepEqual(clampRowCutRange(row('c-1', 1, 2)).captionId, 'c-1'));
test('normalize は source 秒の降順へ並べる', () => assert.deepEqual(normalizeCutRanges([cut([1, 2]), cut([5, 6])]).map(item => item.in), [5, 1]));
test('同じ属性の重なりレンジを結合する', () => assert.deepEqual(normalizeCutRanges([cut([1, 3]), cut([2, 4])]), [cut([1, 4])]));
test('異なる kind の重なりは結合しない', () => assert.equal(normalizeCutRanges([cut([1, 3]), cut([2, 4], { kind: 'silence' })]).length, 2));
test('異なる captionId の重なりは結合しない', () => assert.equal(normalizeCutRanges([cut([1, 3]), cut([2, 4], { captionId: 'b' })]).length, 2));
test('不正レンジを拒否する', () => assert.throws(() => normalizeCutRanges([cut([2, 1])]), /不正/));
