import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectExcludedCaptionIds, filterCaptionRootByExcludedIds, normalizeWords,
  findMatchingEmphasis, resolveEmphasisStyle, renderRevealGroupsMarkup, getActiveCaptions,
} from '../public/caption-markup.js';

test('caption-markup collectExcludedCaptionIds visits nested caption sources', () => {
  const cases = [
    [undefined, new Set()],
    [{ tracks: [{ items: [{ source: { kind: 'captions', exclude: ['a', 7] }, children: [{ source: { kind: 'captions', exclude: ['b'] } }] }] }] }, new Set(['a', 'b'])],
    [{ tracks: [{ items: [{ source: { kind: 'media', exclude: ['a'] } }] }] }, new Set()],
    [{ tracks: [{ children: [{ source: { kind: 'captions', exclude: ['a', 'a'] } }] }] }, new Set(['a'])],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(collectExcludedCaptionIds(input), expected);
});

test('caption-markup filterCaptionRootByExcludedIds retains root shape', () => {
  const cases = [
    [[[{ id: 'a' }, { id: 'b' }], new Set(['b'])], [{ id: 'a' }]],
    [[{ captions: [{ id: 'a' }, { id: 'b' }], schema: 'v1' }, new Set(['a'])], { captions: [{ id: 'b' }], schema: 'v1' }],
    [[null, new Set(['a'])], null],
    [[{ other: true }, new Set(['a'])], { other: true }],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(filterCaptionRootByExcludedIds(...input), expected);
});

test('caption-markup normalizeWords resolves aliases and duration defaults', () => {
  const cases = [
    [undefined, []],
    [[], []],
    [[{ t: 1, d: 0.5, w: 'A' }], [{ start: 1, end: 1.5, text: 'A' }]],
    [[{ start: 2, end: 3, text: 'B' }], [{ start: 2, end: 3, text: 'B' }]],
    [[{ t: 0, d: 0, word: 'C' }, {}], [{ start: 0, end: 0, text: 'C' }, { start: 0, end: 0.3, text: '' }]],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(normalizeWords(input), expected);
});

test('caption-markup findMatchingEmphasis requires time overlap and matching text', () => {
  const word = { start: 1, end: 2, text: 'hello' };
  const exact = { t_start: 1.5, t_end: 2.5, word: 'hello', emotion: 'joy' };
  const longer = { t_start: 1.5, t_end: 2.5, word: 'hello!', emotion: 'surprise' };
  const cases = [
    [[word, undefined], null],
    [[word, [{ ...exact, t_start: 2 }]], null],
    [[word, [{ ...exact, word: 'other' }]], null],
    [[word, [exact]], exact],
    [[word, [longer]], longer],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(findMatchingEmphasis(...input), expected);
});

test('caption-markup resolveEmphasisStyle respects hints and emotion defaults', () => {
  const cases = [
    [{ emotion: 'pain' }, 'one-char-bang'],
    [{ emotion: 'joy' }, 'size-pulse'],
    [{ emotion: 'unknown' }, 'color-accent'],
    [{ emotion: 'pain', style_hint: 'custom' }, 'custom'],
  ];
  for (const [input, expected] of cases) assert.strictEqual(resolveEmphasisStyle(input), expected);
});

test('caption-markup renderRevealGroupsMarkup groups equal starts and fixes timing', () => {
  const renderLine = line => line.map(word => word.text).join('');
  const cases = [
    [[[], 0, 3, renderLine], ''],
    [[[[{ start: 1, text: 'A' }]], 0, 3, renderLine], '<div class="akari-caption__reveal-group" style="--akari-reveal-delay:1.000s;--akari-reveal-dur:2.000s"><p class="akari-caption__line">A</p></div>'],
    [[[[{ start: 0, text: 'A' }], [{ start: 0, text: 'B' }], [{ start: 2, text: 'C' }]], 0, 3, renderLine], '<div class="akari-caption__reveal-group" style="--akari-reveal-delay:0.000s;--akari-reveal-dur:2.000s"><p class="akari-caption__line">A</p><p class="akari-caption__line">B</p></div><div class="akari-caption__reveal-group" style="--akari-reveal-delay:2.000s;--akari-reveal-dur:1.000s"><p class="akari-caption__line">C</p></div>'],
  ];
  for (const [input, expected] of cases) assert.strictEqual(renderRevealGroupsMarkup(...input), expected);
});

test('caption-markup getActiveCaptions prefers file cues and applies exclusions', () => {
  const edit = [{ id: 'c-1', text: 'edit 1' }, { id: 'c-2', text: 'edit 2' }];
  const file = [{ id: 'c-1', text: 'file 1' }, { id: 'c-2', text: 'file 2' }, { id: 'c-3', text: 'file 3' }];
  const exclude = ids => [{ items: [{ source: { kind: 'captions', exclude: ids } }] }];
  const cases = [
    [[{ captions: edit }, file], [{ id: 'c-1', text: 'file 1' }, { id: 'c-2', text: 'file 2' }, { id: 'c-3', text: 'file 3' }]],
    [[{ captions: edit, tracks: exclude(['c-2']) }, file], [{ id: 'c-1', text: 'file 1' }, { id: 'c-3', text: 'file 3' }]],
    [[{ captions: edit, tracks: exclude(['zzz']) }, file], [{ id: 'c-1', text: 'file 1' }, { id: 'c-2', text: 'file 2' }, { id: 'c-3', text: 'file 3' }]],
    [[{ captions: edit, tracks: [{ items: [{ source: { kind: 'media', exclude: ['c-2'] } }] }] }, file], [{ id: 'c-1', text: 'file 1' }, { id: 'c-2', text: 'file 2' }, { id: 'c-3', text: 'file 3' }]],
    [[{ captions: edit }, []], [{ id: 'c-1', text: 'edit 1' }, { id: 'c-2', text: 'edit 2' }]],
    [[{ captions: edit }, null], [{ id: 'c-1', text: 'edit 1' }, { id: 'c-2', text: 'edit 2' }]],
    [[{ captions: edit }, { captions: file }], [{ id: 'c-1', text: 'edit 1' }, { id: 'c-2', text: 'edit 2' }]],
    [[{ captions: edit, tracks: exclude(['c-2']) }, null], [{ id: 'c-1', text: 'edit 1' }]],
    [[{ captions: { captions: edit } }, []], []],
    [[{}, null], []],
    [[undefined, []], []],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(getActiveCaptions(...input), expected);
});
