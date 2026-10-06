import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { cutCandidateContext } = require('../../lib/common/daihon-cut-context.js');
const rows = [
  { id: 'a', text: 'えー今日は台本の話です', words: [
    { text: 'えー', start: 0, end: .3 }, { text: '今日は', start: .3, end: .7 },
    { text: '台本の', start: .7, end: 1.1 }, { text: '話です', start: 1.1, end: 1.5 }
  ] },
  { id: 'b', text: 'まず音を、まず音を聞きます', words: [
    { text: 'まず', start: 2, end: 2.2 }, { text: '音を、', start: 2.2, end: 2.5 },
    { text: 'まず', start: 2.5, end: 2.7 }, { text: '音を', start: 2.7, end: 2.9 },
    { text: '聞きます', start: 2.9, end: 3.2 }
  ] },
  { id: 'c', text: '先週届いた??箱が小さい', words: [
    { text: '先週届いた', start: 4, end: 4.5 }, { text: '箱が小さい', start: 4.8, end: 5.3 }
  ] }
];
const candidate = (rowId, kind, start, end, text) => ({ rowId, kind, start, end, text });

test('filler and redo mark only overlapping words, including a repeated phrase', () => {
  assert.deepEqual(cutCandidateContext(rows, candidate('a', 'filler', 0, .3, 'えー')),
    ['', 'えー', '今日は台本の話です']);
  assert.deepEqual(cutCandidateContext(rows, candidate('b', 'redo', 2, 2.5, 'まず音を、')),
    ['', 'まず音を、', 'まず音を聞きます']);
  assert.deepEqual(cutCandidateContext(rows, candidate('b', 'redo', 2.5, 2.9, 'まず音を')),
    ['まず音を、', 'まず音を', '聞きます']);
});

test('unrecognized keeps the surrounding text and marks only ??', () => {
  assert.deepEqual(cutCandidateContext(rows, candidate('c', 'unrecognized', 4.5, 4.8, '??')),
    ['先週届いた', '??', '箱が小さい']);
});

test('silence uses the previous row tail and next row head around the silence label', () => {
  assert.deepEqual(cutCandidateContext(rows, candidate('a', 'silence', 1.6, 1.8, '無音 0.35 秒')),
    ['えー今日は台本の話です', '（無音 0.35 秒）', 'まず音を、まず音を聞きます']);
});
