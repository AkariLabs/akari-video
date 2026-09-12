import assert from 'node:assert/strict';
import test from 'node:test';
import { canMergeRows, canSplitRow, splitWordBoundaries } from '../lib/common/daihon-split-merge.js';

const row = (id, options = {}) => ({ id, outStart: 0, timeDomain: 'source', words: [{ text: 'a', start: 0, end: 1 }, { text: 'b', start: 1, end: 2 }], ...options });
test('2 語の行は分割できる', () => assert.equal(canSplitRow(row('a')), true));
test('1 語の行は分割できない', () => assert.equal(canSplitRow(row('a', { words: [{ text: 'a', start: 0, end: 1 }] })), false));
test('words null の行は分割できない', () => assert.equal(canSplitRow(row('a', { words: null })), false));
test('カット中の行は分割できない', () => assert.equal(canSplitRow(row('a', { outStart: null })), false));
test('4 語の境界は 1,2,3', () => assert.deepEqual(splitWordBoundaries(row('a', { words: [{}, {}, {}, {}] })), [1, 2, 3]));
test('words null の境界は空', () => assert.deepEqual(splitWordBoundaries(row('a', { words: null })), []));
test('隣接 2 行は rows 順に結合できる', () => assert.deepEqual(canMergeRows([row('a'), row('b')], ['b', 'a']), { ok: true, orderedIds: ['a', 'b'] }));
test('選択 1 件は拒否する', () => assert.equal(canMergeRows([row('a')], ['a']).ok, false));
test('非連続選択は拒否する', () => assert.match(canMergeRows([row('a'), row('b'), row('c')], ['a', 'c']).reason, /離れた/));
test('time domain 不一致は拒否する', () => assert.match(canMergeRows([row('a'), row('b', { timeDomain: 'output' })], ['a', 'b']).reason, /タイムドメイン/));
test('カット中行を含む結合は拒否する', () => assert.match(canMergeRows([row('a'), row('b', { outStart: null })], ['a', 'b']).reason, /カット中/));
test('存在しない id は拒否する', () => assert.match(canMergeRows([row('a'), row('b')], ['a', 'z']).reason, /見つかりません/));
test('重複 id は拒否する', () => assert.match(canMergeRows([row('a'), row('b')], ['a', 'a']).reason, /2 行以上|重複/));
test('連続 3 行を rows 順に返す', () => assert.deepEqual(canMergeRows([row('a'), row('b'), row('c')], ['c', 'a', 'b']), { ok: true, orderedIds: ['a', 'b', 'c'] }));
