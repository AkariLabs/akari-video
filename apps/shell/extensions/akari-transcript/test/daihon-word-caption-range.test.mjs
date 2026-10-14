import assert from 'node:assert/strict';
import test from 'node:test';
import { groupTokensIntoWords } from '../lib/common/daihon-word-units.js';
import { expandCaptionRangeToAdjacentWhitespace, wordSelectionToCaptionRange } from '../lib/common/daihon-word-caption-range.js';
import { captionGraphemes, inferCaptionDisplayToSource } from '@akari-video/edit-store';

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

test('語を丸ごと置換した隣の語まで選ぶと従来の表示範囲を保つ', () => {
  assert.deepEqual(selected(make('あかりは便利', ['あかり', 'は', '便利'], 'AKARI Videoは便利'), 0, 1),
    { range: { from: 0, to: 12 }, text: 'AKARI Videoは' });
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

const replacementCases = [
  ['後ろに伸ばす置換の隣', 'あかりは便利', ['あかり', 'は', '便利'], 'あかり（AKARI）は便利',
    [[0, 3, 'あかり'], [10, 11, 'は'], [11, 13, '便利']]],
  ['前に伸ばす置換の隣', 'ビデオは便利', ['ビデオ', 'は', '便利'], 'AKARIビデオは便利',
    [[5, 8, 'ビデオ'], [8, 9, 'は'], [9, 11, '便利']]],
  ['英語の挿入の隣', 'Claude is good', ['Claude', ' is', ' good'], 'Claude Code is good',
    [[0, 6, 'Claude'], [12, 14, 'is'], [15, 19, 'good']]],
  ['語の一部だけ置換', '以外と便利', ['以外', 'と', '便利'], '意外と便利',
    [[0, 2, '意外'], [2, 3, 'と'], [3, 5, '便利']]],
  ['語の一部だけ削除', 'すごーく便利', ['すごーく', '便利'], 'すごく便利',
    [[0, 3, 'すごく'], [3, 5, '便利']]],
  ['句読点の削除', 'はい、そうです。', ['はい', '、', 'そう', 'です', '。'], 'はいそうです',
    [[0, 2, 'はい'], null, [2, 4, 'そう'], [4, 6, 'です'], null]],
  ['句読点を含む語', 'はい、そうです。', ['はい、', 'そうです。'], 'はい そうです',
    [[0, 2, 'はい'], null]],
  ['読点を空白に置換', '赤い猫、青い犬', ['赤い', '猫', '、', '青い', '犬'], '赤い猫 青い犬',
    [[0, 2, '赤い'], [2, 3, '猫'], null, [4, 6, '青い'], [6, 7, '犬']]],
  ['フィラーを二か所削除', 'えーと赤い猫とえーと青い犬',
    ['えーと', '赤い', '猫', 'と', 'えーと', '青い', '犬'], '赤い猫と青い犬',
    [null, [0, 2, '赤い'], [2, 3, '猫'], [3, 4, 'と'], null, [4, 6, '青い'], [6, 7, '犬']]],
  ['同じ語の片方を削除', 'まあまあ良い', ['まあ', 'まあ', '良い'], 'まあ良い',
    [[0, 2, 'まあ'], [2, 4, '良い']]],
  ['繰り返しの片方を削除', 'はいはいそうです', ['はい', 'はい', 'そう', 'です'], 'はいそうです',
    [[0, 2, 'はい'], null, [2, 4, 'そう'], [4, 6, 'です']]],
  ['同じ字が隣の語の頭にある削除', 'たたかう', ['た', 'たかう'], 'たかう',
    [[0, 3, 'たかう']]],
  ['削除の隣が同じ字', 'ここのこと', ['ここ', 'の', 'こと'], 'このこと',
    [[0, 1, 'こ'], [1, 2, 'の'], [2, 4, 'こと']]]
];
for (const [name, text, tokens, display, expected] of replacementCases) {
  test(`${name}では語ごとに表示の文字へ当てるか理由を返す`, () => {
    const fixture = make(text, tokens, display);
    assert.equal(fixture.units.length, expected.length);
    expected.forEach((entry, index) => {
      const result = selected(fixture, index);
      if (entry === null) assert.deepEqual(result, { reason: reasons.display });
      else assert.deepEqual(result, { range: { from: entry[0], to: entry[1] }, text: entry[2] });
    });
  });
}

const restoredSelections = [
  ['「以外」の一字を「意外」に直す', '以外と便利', ['以外', 'と', '便利'], '意外と便利', 0, 0, 0, 2, '意外'],
  ['「すごーく」の中の一字を消す', 'すごーく便利', ['すごーく', '便利'], 'すごく便利', 0, 0, 0, 3, 'すごく'],
  ['「はい、」の読点を消す', 'はい、そうです。', ['はい、', 'そうです。'], 'はい そうです', 0, 0, 0, 2, 'はい'],
  ['「まあまあ」の繰り返しを消す', 'まあまあ良い', ['まあ', 'まあ', '良い'], 'まあ良い', 0, 0, 0, 2, 'まあ'],
  ['「たたかう」の重複字を消す', 'たたかう', ['た', 'たかう'], 'たかう', 0, 0, 0, 3, 'たかう'],
  ['「ここ」の重複字を消す', 'ここのこと', ['ここ', 'の', 'こと'], 'このこと', 0, 0, 0, 1, 'こ'],
  ['同じ語を二つ置き換えた「あかりと」', 'あかりとあかり', ['あかり', 'と', 'あかり'], 'AKARIとAKARI', 0, 1, 0, 6, 'AKARIと'],
  ['同じ語を二つ置き換えた「とあかり」', 'あかりとあかり', ['あかり', 'と', 'あかり'], 'AKARIとAKARI', 1, 2, 5, 11, 'とAKARI'],
  ['英語を大文字に置き換えた行全体', 'hello world', ['hello', ' world'], 'HELLO WORLD', 0, 1, 0, 11, 'HELLO WORLD'],
  ['二か所を置き換えた「あい」', 'あいうえお', ['あい', 'うえ', 'お'], 'あXうYお', 0, 0, 0, 2, 'あX'],
  ['二か所を置き換えた「あいうえ」', 'あいうえお', ['あい', 'うえ', 'お'], 'あXうYお', 0, 1, 0, 4, 'あXうY'],
  ['二か所を置き換えた「あいうえお」', 'あいうえお', ['あい', 'うえ', 'お'], 'あXうYお', 0, 2, 0, 5, 'あXうYお'],
  ['二か所を置き換えた「うえ」', 'あいうえお', ['あい', 'うえ', 'お'], 'あXうYお', 1, 1, 2, 4, 'うY'],
  ['二か所を置き換えた「うえお」', 'あいうえお', ['あい', 'うえ', 'お'], 'あXうYお', 1, 2, 2, 5, 'うYお'],
  ['語の中に改行が入った「赤い猫と青い」', '赤い猫と青い犬', ['赤い', '猫', 'と', '青い', '犬'], '赤い猫と青\nい犬', 0, 3, 0, 7, '赤い猫と青\nい'],
  ['語の中に改行が入った「赤い猫と青い犬」', '赤い猫と青い犬', ['赤い', '猫', 'と', '青い', '犬'], '赤い猫と青\nい犬', 0, 4, 0, 8, '赤い猫と青\nい犬'],
  ['語の中に改行が入った「猫と青い」', '赤い猫と青い犬', ['赤い', '猫', 'と', '青い', '犬'], '赤い猫と青\nい犬', 1, 3, 2, 7, '猫と青\nい'],
  ['語の中に改行が入った「と青い」', '赤い猫と青い犬', ['赤い', '猫', 'と', '青い', '犬'], '赤い猫と青\nい犬', 2, 3, 3, 7, 'と青\nい'],
  ['語の中に改行が入った「青い」', '赤い猫と青い犬', ['赤い', '猫', 'と', '青い', '犬'], '赤い猫と青\nい犬', 3, 3, 4, 7, '青\nい'],
  ['語の中に改行が入った「青い犬」', '赤い猫と青い犬', ['赤い', '猫', 'と', '青い', '犬'], '赤い猫と青\nい犬', 3, 4, 4, 8, '青\nい犬'],
];
for (const [name, text, tokens, display, a, b, from, to, shown] of restoredSelections) {
  test(`${name}を表示の範囲に当てる`, () => {
    assert.deepEqual(selected(make(text, tokens, display), a, b), { range: { from, to }, text: shown });
  });
}

test('繰り返しを一字消しても変わらない「かか」は二字に当てる', () => {
  const fixture = { caption: { text: 'かかかの', display_text: 'かかの',
    words: [{ text: 'か' }, { text: 'かか' }, { text: 'の' }] },
  units: [{ text: 'か', tokenFrom: 0, tokenTo: 0 }, { text: 'かか', tokenFrom: 1, tokenTo: 1 },
    { text: 'の', tokenFrom: 2, tokenTo: 2 }] };
  assert.deepEqual(selected(fixture, 1), { range: { from: 0, to: 2 }, text: 'かか' });
});

test('固定種の単一置換では触れていない語に別の字を当てず従来より拒否を減らす', () => {
  let seed = 12345;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const alphabet = ['あ', 'か', 'り', 'は', 'の', '猫', '犬', 'A', 'b', ' ', '👩‍🚀', 'が'];
  const pick = () => alphabet[Math.floor(random() * alphabet.length)];
  let oldRefused = 0, refused = 0, checked = 0;
  for (let iteration = 0; iteration < 1500; iteration++) {
    const length = 2 + Math.floor(random() * 8);
    const graphemes = Array.from({ length }, pick);
    const tokens = [], offsets = [];
    for (let index = 0; index < length;) {
      const size = Math.min(length - index, 1 + Math.floor(random() * 3));
      offsets.push(index); tokens.push(graphemes.slice(index, index + size).join('')); index += size;
    }
    offsets.push(length);
    const fromToken = Math.floor(random() * tokens.length);
    const toToken = Math.min(tokens.length - 1, fromToken + Math.floor(random() * 2));
    const replacement = Array.from({ length: Math.floor(random() * 4) }, pick);
    const sourceFrom = offsets[fromToken], sourceTo = offsets[toToken + 1];
    const text = graphemes.join('');
    const display = [...graphemes.slice(0, sourceFrom), ...replacement, ...graphemes.slice(sourceTo)].join('');
    if (captionGraphemes(text).length !== length
        || captionGraphemes(display).length !== length + replacement.length - (sourceTo - sourceFrom)
        || text === display) continue;
    const fixture = { caption: { text, display_text: display, words: tokens.map(text => ({ text })) },
      units: tokens.map((text, index) => ({ text, tokenFrom: index, tokenTo: index })) };
    const map = inferCaptionDisplayToSource(display, text);
    for (let a = 0; a < tokens.length; a++) for (let b = a; b < tokens.length; b++) {
      if (!(offsets[b + 1] <= sourceFrom || offsets[a] >= sourceTo)) continue;
      checked++;
      const want = tokens.slice(a, b + 1).join('').trim();
      const result = selected(fixture, a, b);
      if ('reason' in result) refused++;
      else assert.equal(captionGraphemes(display).slice(result.range.from, result.range.to).join(''), want);
      const starts = map.filter(value => value === offsets[a]).length;
      const ends = map.filter(value => value === offsets[b + 1]).length;
      if (starts !== 1 || ends !== 1) oldRefused++;
    }
  }
  assert.ok(checked > 1000);
  assert.ok(refused < oldRefused, `${refused} >= ${oldRefused}`);
});
