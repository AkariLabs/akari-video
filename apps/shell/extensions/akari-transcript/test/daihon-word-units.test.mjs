import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { groupTokensIntoWords } from '../lib/common/daihon-word-units.js';

const testRoot = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(join(
  testRoot, '..', 'evidence', 'daihon-word-unit', 'fixtures', 'captions-c0005.json'
), 'utf8')).captions[0];

test('実データ c-0005 の 13 トークンを 5 単位にまとめる', () => {
  const units = groupTokensIntoWords(fixture.text, fixture.words);
  assert.equal(fixture.words.length, 13);
  assert.deepEqual(units.map(unit => unit.text), ['これ', 'ゴールデンウィーク', '明け', 'に', 'You']);
  assert.deepEqual(units[1], {
    text: 'ゴールデンウィーク', start: 14.54, end: 17.51, tokenFrom: 1, tokenTo: 8
  });
});

test('すべての単位境界は元のトークン境界である', () => {
  const units = groupTokensIntoWords(fixture.text, fixture.words);
  const tokenBoundaries = new Set(fixture.words.map((_word, index) => index));
  for (const unit of units) {
    assert.ok(tokenBoundaries.has(unit.tokenFrom));
    assert.ok(tokenBoundaries.has(unit.tokenTo));
    assert.equal(unit.text, fixture.words.slice(unit.tokenFrom, unit.tokenTo + 1)
      .map(token => token.text).join(''));
  }
  assert.equal(units.map(unit => unit.text).join(''), fixture.text);
});

test('トークン連結が本文と一致しなければ 1 トークンを 1 単位にする', () => {
  const words = [
    { text: 'ab', start: 0, end: 1 },
    { text: 'c', start: 1, end: 2 }
  ];
  assert.deepEqual(groupTokensIntoWords('abc!', words), [
    { ...words[0], tokenFrom: 0, tokenTo: 0 },
    { ...words[1], tokenFrom: 1, tokenTo: 1 }
  ]);
});

test('Intl.Segmenter が無ければ 1 トークンを 1 単位にする', () => {
  const originalIntl = globalThis.Intl;
  try {
    globalThis.Intl = {};
    const words = [
      { text: 'You', start: 0, end: 1 },
      { text: 'Tube', start: 1, end: 2 }
    ];
    assert.deepEqual(groupTokensIntoWords('YouTube', words), [
      { ...words[0], tokenFrom: 0, tokenTo: 0 },
      { ...words[1], tokenFrom: 1, tokenTo: 1 }
    ]);
  } finally {
    globalThis.Intl = originalIntl;
  }
});

test('Latin と数字の連続をそれぞれ 1 語にまとめる', () => {
  const latin = groupTokensIntoWords('YouTube', [
    { text: 'You', start: 0, end: 1 },
    { text: 'Tube', start: 1, end: 2 }
  ]);
  const digits = groupTokensIntoWords('2026', [
    { text: '20', start: 2, end: 3 },
    { text: '26', start: 3, end: 4 }
  ]);
  assert.deepEqual(latin, [{ text: 'YouTube', start: 0, end: 2, tokenFrom: 0, tokenTo: 1 }]);
  assert.deepEqual(digits, [{ text: '2026', start: 2, end: 4, tokenFrom: 0, tokenTo: 1 }]);
});
