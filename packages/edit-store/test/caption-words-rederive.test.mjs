import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyCaptionTextEdit,
  KARAOKE_MIN_WORD_MATCH_RATIO,
  rederiveCaptionWords,
} from '../lib/caption-words-rederive.js';

const words = [
  { start: 0.1, end: 0.7, text: 'alpha' },
  { start: 0.8, end: 1.6, text: 'beta' },
  { start: 1.7, end: 2.9, text: 'gamma' },
];

test('1 語置換は他の語の実測時刻を完全に温存する', () => {
  const result = rederiveCaptionWords({
    oldText: 'alpha beta gamma', newText: 'alpha delta gamma', words, start: 0, end: 3,
  });
  assert.equal(result.degraded, false);
  assert.deepEqual(result.words[0], words[0]);
  assert.deepEqual(result.words[2], words[2]);
  assert.equal(result.words[1].text, 'delta');
  assert.ok(result.words[1].start >= words[0].end);
  assert.ok(result.words[1].end <= words[2].start);
});

test('語の挿入は挿入語だけを前後アンカー間へ按分する', () => {
  const result = rederiveCaptionWords({
    oldText: 'alpha beta gamma', newText: 'alpha new beta gamma', words, start: 0, end: 3,
  });
  assert.deepEqual(result.words.filter(word => word.text !== 'new'), words);
  assert.deepEqual(result.words[1], { start: 0.7, end: 0.8, text: 'new' });
  assert.equal(result.derivedCount, 1);
});

test('フィラー削除は残る全トークンの実測時刻を変えない', () => {
  const tokens = ['えー', '、', '最初', 'の', '字幕', 'です', '。'];
  const timed = tokens.map((text, index) => ({
    start: Math.round(index * 400) / 1000,
    end: Math.round((index + 1) * 400) / 1000,
    text,
  }));
  const result = rederiveCaptionWords({
    oldText: 'えー、最初の字幕です。', newText: '最初の字幕です。', words: timed, start: 0, end: 2.8,
  });
  assert.deepEqual(result.words, timed.slice(2));
});

test('全半角・大小文字・句読点だけの変更は全語 keep になる', () => {
  const timed = [
    { start: 0, end: 0.8, text: 'ＡＢＣ' },
    { start: 0.8, end: 1.8, text: 'Test' },
    { start: 1.8, end: 2, text: '！' },
  ];
  const result = rederiveCaptionWords({
    oldText: 'ＡＢＣ Test！', newText: 'abc test?', words: timed, start: 0, end: 2,
  });
  assert.equal(result.keptCount, 3);
  assert.deepEqual(result.words.map(({ start, end }) => ({ start, end })),
    timed.map(({ start, end }) => ({ start, end })));
});

test('一致率が閾値未満の意訳は words を空にして degrade する', () => {
  const result = rederiveCaptionWords({
    oldText: 'alpha beta gamma', newText: 'entirely different meaning', words, start: 0, end: 3,
  });
  assert.equal(KARAOKE_MIN_WORD_MATCH_RATIO, 0.5);
  assert.equal(result.degraded, true);
  assert.deepEqual(result.words, []);
  assert.equal(result.matchRatio, 0);
});

test('旧 words 数と旧トークン数が違っても新トークン数へ単調に再マップする', () => {
  const result = rederiveCaptionWords({
    oldText: 'one two three four', newText: 'one two plus three four',
    words: [
      { start: 10, end: 11.5, text: 'one two' },
      { start: 11.5, end: 14, text: 'three four' },
    ],
    start: 10, end: 14,
  });
  assert.equal(result.words.length, 5);
  for (let index = 0; index < result.words.length; index++) {
    assert.ok(result.words[index].start >= 10);
    assert.ok(result.words[index].end <= 14);
    assert.ok(result.words[index].start <= result.words[index].end);
    if (index > 0) assert.ok(result.words[index].start >= result.words[index - 1].end);
  }
});

test('NFC と trim 後に同じ text なら元レコードを同一参照で返す', () => {
  const record = { text: 'Café', start: 0, end: 1, words, edited: false };
  const result = applyCaptionTextEdit(record, '  Cafe\u0301  ');
  assert.equal(result.record, record);
  assert.equal(result.record.edited, false);
  assert.equal(result.rederive, undefined);
});

test('words が無い行には synthetic words を追加しない', () => {
  const record = { text: 'before', start: 0, end: 1, edited: false };
  const result = applyCaptionTextEdit(record, 'after');
  assert.equal(Object.hasOwn(result.record, 'words'), false);
  assert.equal(result.record.edited, true);
});

test('派生整文だけを削除し style・text_style・sourceRef を保持する', () => {
  const record = {
    id: 'c-0001', text: 'alpha beta gamma', start: 0, end: 3, words,
    display_text: 'old display', display_fragments: ['old ', 'display'],
    style: 'karaoke', text_style: { color: '#fff' }, sourceRef: { segment: 4 }, edited: false,
  };
  const result = applyCaptionTextEdit(record, 'alpha delta gamma').record;
  assert.equal(Object.hasOwn(result, 'display_text'), false);
  assert.equal(Object.hasOwn(result, 'display_fragments'), false);
  assert.equal(result.style, 'karaoke');
  assert.deepEqual(result.text_style, { color: '#fff' });
  assert.deepEqual(result.sourceRef, { segment: 4 });
});

test('Intl.Segmenter 不在でも grapheme fallback が保持アンカーを守る', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
  Object.defineProperty(Intl, 'Segmenter', { configurable: true, writable: true, value: undefined });
  try {
    const timed = [
      { start: 0, end: 0.5, text: 'A' },
      { start: 0.5, end: 1, text: 'B' },
      { start: 1, end: 1.5, text: 'C' },
    ];
    const result = rederiveCaptionWords({
      oldText: 'A B C', newText: 'A X C', words: timed, start: 0, end: 1.5,
    });
    assert.deepEqual(result.words[0], timed[0]);
    assert.deepEqual(result.words[2], timed[2]);
    assert.ok(result.words[1].start >= timed[0].end && result.words[1].end <= timed[2].start);
  } finally {
    if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
  }
});

test('出力は ms 丸めした schema の三フィールドだけを持つ', () => {
  const result = rederiveCaptionWords({
    oldText: 'alpha beta gamma', newText: 'alpha delta gamma',
    words: [
      { start: 0.12345, end: 0.76549, text: 'alpha', extra: 'drop' },
      { start: 0.8, end: 1.6, text: 'beta' },
      { start: 1.7, end: 2.9999, text: 'gamma' },
    ],
    start: 0, end: 3,
  });
  assert.deepEqual(Object.keys(result.words[0]), ['start', 'end', 'text']);
  assert.deepEqual(result.words[0], { start: 0.123, end: 0.765, text: 'alpha' });
});

test('空文字への編集は拒否する', () => {
  assert.throws(
    () => applyCaptionTextEdit({ text: 'before', start: 0, end: 1 }, ' \n '),
    /空にできません/,
  );
});
