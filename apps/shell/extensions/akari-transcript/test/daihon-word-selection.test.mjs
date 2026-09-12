import assert from 'node:assert/strict'; import test from 'node:test';
import { addWordRange, extendWordRange, normalizeWordRanges, removeWordRange, wordRangeSummary, wordsOf } from '../lib/common/daihon-word-selection.js';
const rows = [{ id: 'a', words: [{ text: 'A', start: 0, end: 1 }, { text: 'B', start: 1, end: 2 }, { text: 'C', start: 2, end: 3 }] },
  { id: 'b', words: [{ text: 'D', start: 3, end: 4 }] }];
test('normalizes overlaps, adjacency, row order, and invalid ranges', () => assert.deepEqual(normalizeWordRanges([
  { row: 'b', a: 0, b: 0 }, { row: 'a', a: 1, b: 2 }, { row: 'a', a: 0, b: 0 }, { row: 'a', a: -1, b: 2 }
], ['a', 'b']), [{ row: 'a', a: 0, b: 2 }, { row: 'b', a: 0, b: 0 }]));
test('add, remove whole range, and extend last same-row range', () => {
  const added = addWordRange([{ row: 'a', a: 0, b: 0 }], { row: 'b', a: 0, b: 0 });
  assert.deepEqual(removeWordRange(added, { row: 'a', index: 0 }), [{ row: 'b', a: 0, b: 0 }]);
  assert.deepEqual(extendWordRange([{ row: 'a', a: 1, b: 1 }, { row: 'b', a: 0, b: 0 }], { row: 'a', index: 2 }, ['a', 'b']),
    [{ row: 'a', a: 1, b: 2 }, { row: 'b', a: 0, b: 0 }]);
});
test('words and summary follow range order across rows', () => {
  const ranges = [{ row: 'a', a: 0, b: 1 }, { row: 'b', a: 0, b: 0 }];
  assert.equal(wordsOf(rows, ranges).length, 3);
  assert.deepEqual(wordRangeSummary(rows, ranges), { rangeCount: 2, wordCount: 3, start: 0, end: 4, text: 'AB・D' });
});
