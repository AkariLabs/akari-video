import assert from 'node:assert/strict';
import test from 'node:test';
import { groupTokensIntoWords } from '../lib/common/daihon-word-units.js';
import { expandCaptionRangeToAdjacentWhitespace, wordSelectionToCaptionRange } from '../lib/common/daihon-word-caption-range.js';

const reasons = { words: '語が合わない', display: '表示に対応しない', empty: '空' };
const make = (text, tokens, display_text) => {
  const words = tokens.map((word, index) => ({ text: word, start: index, end: index + 1 }));
  return { caption: { text, display_text, words }, units: groupTokensIntoWords(text, words) };
};
const selected = (fixture, a, b = a) => wordSelectionToCaptionRange(fixture.caption, fixture.units, { a, b }, reasons);

test('日本語の語を表示文字の書記素範囲にする', () => {
  assert.deepEqual(selected(make('赤い猫', ['赤い', '猫']), 1), { range: { from: 2, to: 3 }, text: '猫' });
});

test('英語の語の頭の空白を範囲から外す', () => {
  assert.deepEqual(selected(make('Hello world', ['Hello', ' world']), 1),
    { range: { from: 6, to: 11 }, text: 'world' });
});

test('置き換えた語を選ぶと表示側の置き換え文字を指す', () => {
  assert.deepEqual(selected(make('あかりは便利', ['あかり', 'は', '便利'], 'AKARIは便利'), 0),
    { range: { from: 0, to: 5 }, text: 'AKARI' });
});

test('置き換えの後ろの語を選ぶと表示側へずらす', () => {
  assert.deepEqual(selected(make('あかりは便利', ['あかり', 'は', '便利'], 'AKARIは便利'), 2),
    { range: { from: 6, to: 8 }, text: '便利' });
});

test('ZWJ の絵文字と結合濁点を一つずつ数える', () => {
  assert.deepEqual(selected(make('👩‍🚀が', ['👩‍🚀', 'が']), 1),
    { range: { from: 1, to: 2 }, text: 'が' });
});

test('語と本文が対応しない行は理由を返す', () => {
  assert.deepEqual(selected(make('赤い猫', ['青い', '猫']), 0), { reason: reasons.words });
});

test('置き換えで消えた語は別の文字に当てない', () => {
  assert.deepEqual(selected(make('赤い猫', ['赤い', '猫'], '赤い'), 1), { reason: reasons.display });
});

test('二語を続けて選ぶと内側の空白を含める', () => {
  assert.deepEqual(selected(make('Hello world', ['Hello', ' world']), 0, 1),
    { range: { from: 0, to: 11 }, text: 'Hello world' });
});

test('英語の中間二語を戻すと左右の空白も含めて [6,19) にする', () => {
  const fixture = make('I will explain how the transcript gets a',
    ['I', ' will', ' explain', ' how', ' the', ' transcript', ' gets', ' a']);
  const mapped = selected(fixture, 2, 3);
  assert.deepEqual(mapped, { range: { from: 7, to: 18 }, text: 'explain how' });
  assert.deepEqual(expandCaptionRangeToAdjacentWhitespace(fixture.caption.text, mapped.range),
    { from: 6, to: 19 });
});

test('空白のない日本語の語を戻す範囲は広がらない', () => {
  assert.deepEqual(expandCaptionRangeToAdjacentWhitespace('赤い猫', { from: 2, to: 3 }),
    { from: 2, to: 3 });
});

test('行の頭と末尾の語を戻す範囲は行の外へ広がらない', () => {
  assert.deepEqual(expandCaptionRangeToAdjacentWhitespace('hello world', { from: 0, to: 5 }),
    { from: 0, to: 6 });
  assert.deepEqual(expandCaptionRangeToAdjacentWhitespace('hello world', { from: 6, to: 11 }),
    { from: 5, to: 11 });
});
