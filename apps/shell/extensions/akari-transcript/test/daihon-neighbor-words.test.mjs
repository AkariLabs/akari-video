import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { neighborWordsForRow } = require('../lib/common/daihon-neighbor-words.js');

const rows = [
  { id: 's1-b', src: 'src-1', start: 2, end: 3, text: 'one-b', words: [{ text: 'one-b', start: 2, end: 3 }] },
  { id: 's2-b', src: 'src-2', start: 2, end: 3, text: 'two-b', words: [{ text: 'two-b', start: 2, end: 3 }] },
  { id: 's1-a', src: 'src-1', start: 0, end: 1, text: 'one-a', words: [{ text: 'one-a', start: 0, end: 1 }] },
  { id: 's2-a', src: 'src-2', start: 0, end: 1, text: 'two-a', words: [{ text: 'two-a', start: 0, end: 1 }] }
];

test('neighborWordsForRow は別素材の語を混ぜず秒順に並べる', () => {
  const order = rows.map(row => row.id);
  const words = neighborWordsForRow(rows, rows[1]);
  assert.deepEqual(words.map(word => word.text), ['two-a', 'two-b']);
  assert.equal(words.some(word => word.text.startsWith('one-')), false);
  assert.deepEqual(rows.map(row => row.id), order);
});

test('neighborWordsForRow は語無し行を短い代替語へ畳む', () => {
  const fallbackRows = [
    { id: 'text', src: 'src-2', start: 0, end: 1, text: '1234567890' },
    { id: 'empty', src: 'src-2', start: 2, end: 3, text: '' }
  ];
  assert.deepEqual(neighborWordsForRow(fallbackRows, fallbackRows[0]), [
    { text: '12345678', start: 0, end: 1 },
    { text: '—', start: 2, end: 3 }
  ]);
});

test('neighborWordsForRow は全行 src 無しなら従来どおり全行を使う', () => {
  const legacy = rows.map(({ src: _src, ...row }) => row);
  assert.deepEqual(neighborWordsForRow(legacy, legacy[0]).map(word => word.text),
    ['one-a', 'two-a', 'one-b', 'two-b']);
});
