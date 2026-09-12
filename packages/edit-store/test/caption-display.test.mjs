import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CaptionDisplayError,
  captionAnchorPositionVars,
  dedupeCaptionOccurrences,
  foldCaptionLines,
  joinCaptionLines,
  measureCaptionUnits,
  mergeCaptionDisplayStyles,
  projectCaptionWords,
  resolveCaptionDisplay,
  resolveCaptionReferenceScale,
  resolveCaptionStyleForOutput,
  scaleCaptionPx,
  validateCaptionDisplayPolicy,
  validateCaptionTextStyle,
} from '../lib/caption-display.js';
import { resolveCaptionStylePreset, TEXTSTYLE_CATALOG } from '../lib/index.js';

const testRoot = dirname(fileURLToPath(import.meta.url));
const styleParity = JSON.parse(await readFile(join(testRoot, 'fixtures/caption-style-validation-parity.json'), 'utf8'));

const policy = {
  mode: 'single_line_sequential',
  algorithm: 'a4-ja-two-fragment-v1',
  unit_metric: 'ascii-half-other-one-v1',
  max_line_units: 8,
  minimum_fragment_duration_seconds: 0.72,
  locale: 'ja',
  break_hints: {
    preferred_second_starts: ['設定'],
    preferred_first_ends: ['です'],
    protected_terms: ['Claude Code'],
  },
};

function caption(id, start, end, text, extra = {}) {
  return { id, start, end, text, speaker: null, sourceRef: null, edited: true, ...extra };
}

function englishPolicy(maxLineUnits, protectedTerms = []) {
  return {
    mode: 'single_line_sequential',
    algorithm: 'a4-ja-two-fragment-v1',
    unit_metric: 'ascii-half-other-one-v1',
    max_line_units: maxLineUnits,
    minimum_fragment_duration_seconds: 0.1,
    locale: 'en',
    ...(protectedTerms.length ? { break_hints: { protected_terms: protectedTerms } } : {}),
  };
}

function wordBookRoot(text, maxLineUnits = 3, protectedTerms = []) {
  return {
    display_policy: englishPolicy(maxLineUnits, protectedTerms),
    captions: [caption('c-0001', 0, 2, text)],
  };
}

test('lines=2 wrap=multi groups two scheduled fragments into one display cue', () => {
  const root = wordBookRoot('alpha beta gamma', 5);
  root.display_policy.lines = 2;
  root.display_policy.wrap = 'multi';
  const result = resolveCaptionDisplay(root, { cuts: [{ in: 0, out: 2 }] });
  assert.equal(result.display_cues.length, 1);
  assert.deepEqual(result.display_cues[0].display_lines, ['alpha ', 'beta gamma']);
  assert.equal(result.display_cues[0].text, 'alpha beta gamma');
  assert.deepEqual([result.display_cues[0].start, result.display_cues[0].end], [0, 2]);
  assert.equal(result.display_cues[0].fragment_index, 1);
  assert.equal(result.display_cues[0].fragment_count, 1);
});

test('manual 3 fragments are accepted and grouped by lines with wrap=multi', () => {
  const root = {
    display_policy: { ...policy, max_line_units: 4, minimum_fragment_duration_seconds: 0.1, lines: 2, wrap: 'multi' },
    captions: [caption('c-0001', 0, 3, 'あいうえおか', { display_fragments: ['あい', 'うえ', 'おか'] })],
  };
  const result = resolveCaptionDisplay(root, { cuts: [] });
  assert.deepEqual(result.display_cues.map(cue => ({ text: cue.text, lines: cue.display_lines })), [
    { text: 'あいうえ', lines: ['あい', 'うえ'] },
    { text: 'おか', lines: undefined },
  ]);
});

test('manual 5 fragments are accepted and grouped sequentially with wrap=multi', () => {
  const root = {
    display_policy: { ...policy, max_line_units: 2, minimum_fragment_duration_seconds: 0.1, lines: 3, wrap: 'multi' },
    captions: [caption('c-0001', 0, 5, 'あいうえお', { display_fragments: ['あ', 'い', 'う', 'え', 'お'] })],
  };
  const result = resolveCaptionDisplay(root, { cuts: [] });
  assert.deepEqual(result.display_cues.map(cue => cue.display_lines ?? [cue.text]), [
    ['あ', 'い', 'う'], ['え', 'お']
  ]);
});

test('manual 3 and 5 fragments stay one fragment per cue with wrap=fold', () => {
  for (const fragments of [['あ', 'い', 'う'], ['あ', 'い', 'う', 'え', 'お']]) {
    const root = {
      display_policy: { ...policy, max_line_units: 2, minimum_fragment_duration_seconds: 0.1, lines: 3, wrap: 'fold' },
      captions: [caption('c-0001', 0, fragments.length, fragments.join(''), { display_fragments: fragments })],
    };
    const result = resolveCaptionDisplay(root, { cuts: [] });
    assert.deepEqual(result.display_cues.map(cue => cue.text), fragments);
    assert.ok(result.display_cues.every(cue => cue.display_lines === undefined));
  }
});

test('emphasis style_preset resolves per word, rounds partial overlap inward, and preserves cue text', () => {
  const root = {
    display_policy: { ...englishPolicy(20), lines: 2, wrap: 'multi' },
    emphasis_words: [{
      id: 'e-0001', src: 'a', t_start: 1.2, t_end: 1.3,
      word: 'AKARI Video', emotion: 'neutral', style_preset: 'neon',
    }],
    captions: [caption('c-0001', 0, 2, 'AKARI Videoworks', {
      src: 'a',
      display_fragments: ['AKARI Video', 'works'],
      words: [
        { start: 1, end: 1.5, text: 'AKARI Video' },
        { start: 1.5, end: 2, text: 'works' },
      ],
    })],
  };
  const output = { width: 1920, height: 1080 };
  const result = resolveCaptionDisplay(root, { cuts: [{ src: 'a', in: 0, out: 2 }], output }, { output });
  const cue = result.display_cues[0];
  const preset = resolveCaptionStylePreset({ style_preset: 'neon' }, TEXTSTYLE_CATALOG);
  const expectedVars = resolveCaptionStyleForOutput(preset.record.text_style, output).vars;

  assert.equal(cue.words.map(word => word.text).join(''), cue.text);
  assert.deepEqual(cue.words.map(word => word.line), [0, 1]);
  assert.deepEqual(cue.word_styles, [{ from: 0, to: 1, preset_id: 'neon', style_vars: expectedVars }]);
  assert.deepEqual([cue.words[0].start, cue.words[0].end], [1, 1.5]);
});

test('word presets ignore src mismatch, missing style_preset, unknown ids, and output-domain captions', () => {
  const base = {
    display_policy: englishPolicy(20),
    captions: [caption('c-0001', 0, 2, 'AKARI', {
      src: 'a', words: [{ start: 1, end: 1.5, text: 'AKARI' }],
    })],
  };
  const edit = { cuts: [{ src: 'a', in: 0, out: 2 }] };
  const cases = [
    [{ id: 'e-0001', src: 'b', t_start: 1, t_end: 1.5, word: 'AKARI', emotion: 'neutral', style_preset: 'neon' }],
    [{ id: 'e-0001', src: 'a', t_start: 1, t_end: 1.5, word: 'AKARI', emotion: 'joy' }],
    [{ id: 'e-0001', src: 'a', t_start: 1, t_end: 1.5, word: 'AKARI', emotion: 'neutral', style_preset: 'missing-preset' }],
  ];
  const baseline = JSON.stringify(resolveCaptionDisplay(base, edit).display_cues);
  for (const emphasis_words of cases) {
    const cues = resolveCaptionDisplay({ ...base, emphasis_words }, edit).display_cues;
    assert.equal(JSON.stringify(cues), baseline);
    assert.equal(cues[0].words, undefined);
    assert.equal(cues[0].word_styles, undefined);
  }
  const outputRoot = {
    ...base,
    emphasis_words: cases[0].map(value => ({ ...value, src: 'a' })),
    captions: [{ ...base.captions[0], time_domain: 'output' }],
  };
  assert.equal(resolveCaptionDisplay(outputRoot, edit).display_cues[0].word_styles, undefined);
});

test('lines=2 wrap=fold keeps one effective fragment and folds it into two lines', () => {
  const root = wordBookRoot('alpha beta', 3);
  root.display_policy.lines = 2;
  root.display_policy.wrap = 'fold';
  const result = resolveCaptionDisplay(root, { cuts: [{ in: 0, out: 2 }] });
  assert.equal(result.display_cues.length, 1);
  assert.deepEqual(result.display_cues[0].display_lines, ['alpha ', 'beta']);
  assert.equal(result.display_cues[0].text, 'alpha beta');
});

test('manual display_fragments remain sequential and are not folded under wrap=fold', () => {
  const root = wordBookRoot('今回設定', 3);
  root.display_policy.lines = 2;
  root.display_policy.wrap = 'fold';
  root.captions[0].display_fragments = ['今回', '設定'];
  const result = resolveCaptionDisplay(root, { cuts: [{ in: 0, out: 2 }] });
  assert.deepEqual(result.display_cues.map(cue => cue.text), ['今回', '設定']);
  assert.ok(result.display_cues.every(cue => cue.display_lines === undefined));
});

test('manual display_fragments with lines=2 wrap=multi become one simultaneous two-line cue', () => {
  const text = 'あいうえおかきくけこさしすせそたちつてと';
  const fragments = ['あいうえおかきくけこ', 'さしすせそたちつてと'];
  const root = {
    display_policy: { ...policy, max_line_units: 10, lines: 2, wrap: 'multi' },
    captions: [caption('c-0002', 0, 6, text, { display_fragments: fragments })],
  };
  const result = resolveCaptionDisplay(root, { cuts: [{ in: 0, out: 6 }] });
  assert.equal(result.display_cues.length, 1);
  assert.deepEqual(result.display_cues[0].display_lines, fragments);
  assert.deepEqual([result.display_cues[0].start, result.display_cues[0].end], [0, 6]);
  assert.equal(result.display_cues[0].text, text);
  assert.equal(result.display_cues[0].line_override, true);

  delete root.display_policy.lines;
  const singleLine = resolveCaptionDisplay(root, { cuts: [{ in: 0, out: 6 }] });
  assert.deepEqual(singleLine.display_cues.map(cue => cue.text), fragments);
  assert.ok(singleLine.display_cues.every(cue => cue.display_lines === undefined));
});

test('manual display_fragments with lines=2 wrap=fold stay as two unfolded cues', () => {
  const text = 'あいうえおかきくけこさしすせそたちつてと';
  const fragments = ['あいうえおかきくけこ', 'さしすせそたちつてと'];
  const root = {
    display_policy: { ...policy, max_line_units: 10, lines: 2, wrap: 'fold' },
    captions: [caption('c-0002', 0, 6, text, { display_fragments: fragments })],
  };
  const result = resolveCaptionDisplay(root, { cuts: [{ in: 0, out: 6 }] });
  assert.deepEqual(result.display_cues.map(cue => cue.text), fragments);
  assert.deepEqual(result.display_cues.map(cue => [cue.start, cue.end]), [[0, 3], [3, 6]]);
  assert.ok(result.display_cues.every(cue => cue.display_lines === undefined && cue.line_override));
});

test('undeclared lines/wrap preserve the policy echo and single-line cue shape', () => {
  const root = wordBookRoot('alpha beta', 3);
  const result = resolveCaptionDisplay(root, { cuts: [{ in: 0, out: 2 }] });
  assert.equal(Object.hasOwn(result.policy, 'lines'), false);
  assert.equal(Object.hasOwn(result.policy, 'wrap'), false);
  assert.ok(result.display_cues.every(cue => cue.display_lines === undefined));
});

test('joinCaptionLines preserves source slices and foldCaptionLines is greedy and lossless', () => {
  assert.equal(joinCaptionLines(['日本', '語字幕'], 'ja-JP'), '日本語字幕');
  assert.equal(joinCaptionLines(['alpha ', 'beta'], 'en'), 'alpha beta');
  assert.deepEqual(foldCaptionLines('alpha beta', 3, 2, 'en'), ['alpha ', 'beta']);
  assert.deepEqual(foldCaptionLines('abcdefghi', 1, 2, 'en'), ['ab', 'cdefghi']);
});

test('foldCaptionLines falls back to greedy code points when Intl.Segmenter is unavailable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
  try {
    Object.defineProperty(Intl, 'Segmenter', { ...descriptor, value: undefined });
    assert.deepEqual(foldCaptionLines('abcdef', 1.5, 2, 'en'), ['abc', 'def']);
  } finally {
    Object.defineProperty(Intl, 'Segmenter', descriptor);
  }
});

test('display policy validates declared lines and wrap without materializing defaults', () => {
  const normalized = validateCaptionDisplayPolicy({ ...policy, lines: 6, wrap: 'fold' });
  assert.equal(normalized.lines, 6);
  assert.equal(normalized.wrap, 'fold');
  const omitted = validateCaptionDisplayPolicy(policy);
  assert.equal(Object.hasOwn(omitted, 'lines'), false);
  assert.equal(Object.hasOwn(omitted, 'wrap'), false);
  for (const patch of [{ lines: 0 }, { lines: 7 }, { lines: 1.5 }, { wrap: 'none' }]) {
    assert.throws(
      () => validateCaptionDisplayPolicy({ ...policy, ...patch }),
      error => error instanceof CaptionDisplayError && error.code === 'INVALID_POLICY',
    );
  }
});

test('word_book_fallbacks は fallback が無い結果にも空配列で載る', () => {
  const result = resolveCaptionDisplay(wordBookRoot('alpha', 3), { cuts: [{ in: 0, out: 2 }] });
  assert.deepEqual(result.word_book_fallbacks, []);
});

test('extra_protected_terms は候補境界への硬い veto として効く', () => {
  const root = wordBookRoot('one two three', 4.5);
  root.display_policy.break_hints = { preferred_second_starts: ['two'] };
  const without = resolveCaptionDisplay(root, { cuts: [{ in: 0, out: 2 }] });
  const withExtra = resolveCaptionDisplay(root, { cuts: [{ in: 0, out: 2 }] }, {
    extra_protected_terms: ['one two'],
  });
  assert.deepEqual(without.display_cues.map(cue => cue.text), ['one ', 'two three']);
  assert.deepEqual(withExtra.display_cues.map(cue => cue.text), ['one two', ' three']);
  assert.deepEqual(withExtra.word_book_fallbacks, []);
});

test('extra で分割不能なら extra だけ外して成功し fallback を返す', () => {
  const result = resolveCaptionDisplay(wordBookRoot('alpha beta'), { cuts: [{ in: 0, out: 2 }] }, {
    extra_protected_terms: ['alpha beta'],
  });
  assert.deepEqual(result.display_cues.map(cue => cue.text), ['alpha', ' beta']);
  assert.deepEqual(result.word_book_fallbacks, [{ caption_id: 'c-0001', dropped_terms: ['alpha beta'] }]);
});

test('fallback の dropped_terms は入力順・重複除去・本文出現だけを保つ', () => {
  const result = resolveCaptionDisplay(wordBookRoot('alpha beta'), { cuts: [{ in: 0, out: 2 }] }, {
    extra_protected_terms: ['missing', 'alpha beta', 'alpha beta'],
  });
  assert.deepEqual(result.word_book_fallbacks, [{ caption_id: 'c-0001', dropped_terms: ['alpha beta'] }]);
});

test('policy 明示の protected_terms だけで不能なら従来どおり throw する', () => {
  assert.throws(
    () => resolveCaptionDisplay(wordBookRoot('alpha beta', 3, ['alpha beta']), { cuts: [{ in: 0, out: 2 }] }),
    error => error instanceof CaptionDisplayError && error.code === 'NO_WORD_BOUNDARY_SPLIT',
  );
});

test('本文が二行上限を超える :660 の失敗は extra があっても再試行しない', () => {
  assert.throws(
    () => resolveCaptionDisplay(wordBookRoot('abcdefghijklm', 3), { cuts: [{ in: 0, out: 2 }] }, {
      extra_protected_terms: ['abc'],
    }),
    error => error instanceof CaptionDisplayError
      && error.code === 'NO_WORD_BOUNDARY_SPLIT'
      && /cannot fit in two/u.test(error.message),
  );
});

test('不正な extra_protected_terms は INVALID_POLICY', () => {
  for (const value of ['not-array', [''], [' e'], ['e\u0301']]) {
    assert.throws(
      () => resolveCaptionDisplay(wordBookRoot('alpha beta'), { cuts: [{ in: 0, out: 2 }] }, {
        extra_protected_terms: value,
      }),
      error => error instanceof CaptionDisplayError && error.code === 'INVALID_POLICY',
    );
  }
});

test('display_policy が無ければ extra_protected_terms を検証せず null', () => {
  assert.equal(resolveCaptionDisplay({ captions: [] }, {}, { extra_protected_terms: [''] }), null);
});

test('ASCII counts as half units and other code points as one', () => {
  assert.equal(measureCaptionUnits('AIです'), 3);
});

test('projects repeated/crossing/speed/multi-source occurrences before splitting', () => {
  const root = {
    display_policy: policy,
    captions: [caption('c-0001', 1, 5, '前半です設定後半', {
      src: 'a',
      display_fragments: ['前半です', '設定後半'],
    })],
  };
  const result = resolveCaptionDisplay(root, {
    version: 1,
    output: { width: 1920, height: 1080 },
    sources: [{ id: 'a' }, { id: 'b' }],
    cuts: [
      { src: 'a', in: 0, out: 3 },
      { src: 'b', in: 0, out: 1 },
      { src: 'a', in: 2, out: 6, speed: 2 },
    ],
  });
  assert.equal(result.occurrence_count, 2);
  assert.equal(result.display_cue_count, 4);
  assert.deepEqual(result.display_cues.map(cue => cue.occurrence_index), [1, 1, 2, 2]);
  assert.deepEqual(result.display_cues.map(cue => cue.cut_index), [0, 0, 2, 2]);
  assert.equal(result.display_cues[0].id, 'c-0001-occ-0001-part-1');
  assert.equal(result.display_cues.at(-1).end, 5.5);
});

test('output-domain cue bypasses src cut filtering and keeps one continuous output interval', () => {
  const root = {
    display_policy: policy,
    captions: [caption('c-0001', 0.5, 3.5, 'C2まで表示', {
      src: 'a', time_domain: 'output',
    })],
  };
  const result = resolveCaptionDisplay(root, {
    version: 1,
    output: { width: 1920, height: 1080 },
    sources: [{ id: 'a' }, { id: 'b' }],
    cuts: [
      { src: 'a', in: 0, out: 2 },
      { src: 'b', in: 0, out: 2 },
    ],
  });
  assert.equal(result.occurrence_count, 1);
  assert.equal(result.display_cue_count, 1);
  assert.equal(result.display_cues[0].start, 0.5);
  assert.equal(result.display_cues[0].end, 3.5);
  assert.equal(result.display_cues[0].src, 'a');
  assert.equal(result.display_cues[0].cut_index, -1);
});

test('output-domain cue may omit provenance src in a multi-source edit', () => {
  const root = {
    display_policy: policy,
    captions: [caption('c-0001', 0.5, 3.5, '出力字幕', { time_domain: 'output' })],
  };
  assert.doesNotThrow(() => resolveCaptionDisplay(root, {
    sources: [{ id: 'a' }, { id: 'b' }],
    cuts: [{ src: 'a', in: 0, out: 2 }, { src: 'b', in: 0, out: 2 }],
  }));
});

test('output-domain cue is clamped to the linear cuts duration', () => {
  const root = {
    display_policy: policy,
    captions: [caption('c-0001', 3, 7, '字幕です', { time_domain: 'output' })],
  };
  const result = resolveCaptionDisplay(root, {
    sources: [{ id: 'a' }, { id: 'b' }],
    cuts: [{ src: 'a', in: 0, out: 2 }, { src: 'b', in: 0, out: 2 }],
  });
  assert.equal(result.occurrence_count, 1);
  assert.equal(result.display_cues[0].start, 3);
  assert.equal(result.display_cues[0].end, 4);
});

test('output-domain cue at or beyond the linear cuts end produces no occurrence', () => {
  const root = {
    display_policy: policy,
    captions: [caption('c-0001', 4, 7, '字幕です', { time_domain: 'output' })],
  };
  const result = resolveCaptionDisplay(root, {
    sources: [{ id: 'a' }, { id: 'b' }],
    cuts: [{ src: 'a', in: 0, out: 2 }, { src: 'b', in: 0, out: 2 }],
  });
  assert.equal(result.occurrence_count, 0);
  assert.deepEqual(result.display_cues, []);
});

test('source reference validation is driven by normalized sources, not edit.version', () => {
  const root = {
    display_policy: policy,
    captions: [caption('c-0001', 0, 1, '正常です', { src: 'a' })],
  };
  const normalized = {
    output: { width: 1920, height: 1080 },
    sources: [{ id: 'a' }],
    cuts: [{ src: 'a', in: 0, out: 1 }],
  };
  assert.equal(resolveCaptionDisplay(root, normalized).occurrence_count, 1);
  assert.throws(
    () => resolveCaptionDisplay(root, { ...normalized, sources: [] }),
    /non-empty sources/u
  );
});

test('accepts at/track projection and fails closed for transitions, normalization, style, overlap, and impossible split', () => {
  const base = { display_policy: policy, captions: [caption('c-0001', 0, 1, '正常です')] };
  assert.equal(resolveCaptionDisplay(base, { cuts: [{ in: 0, out: 1, at: 0, track: 0 }] }).occurrence_count, 1);
  assert.throws(() => resolveCaptionDisplay(base, { cuts: [{ in: 0, out: 1, transition_out: null }] }), /does not support/);
  assert.throws(() => resolveCaptionDisplay({ ...base, captions: [caption('c-0001', 0, 1, ' é')] }, { cuts: [] }), /NFC/);
  assert.throws(() => resolveCaptionDisplay({ ...base, captions: [caption('c-0001', 0, 1, '正常です', { style: 'pop' })] }, { cuts: [] }), /cannot be combined/);
  assert.throws(() => resolveCaptionDisplay({ ...base, captions: [caption('c-0001', 0, 1, '正常'), caption('c-0001', 1, 2, '重複')] }, { cuts: [] }), /duplicated/);
  assert.throws(() => resolveCaptionDisplay(base, { cuts: [], emphasis_words: [{ t_start: 0.2, t_end: 0.4 }] }), /emphasis_words cannot act/);
  assert.throws(() => resolveCaptionDisplay({ ...base, captions: [caption('c-0001', -1, 1, '範囲不正')] }, { cuts: [] }), /0 <= start < end/);
  assert.throws(() => resolveCaptionDisplay({ ...base, captions: [caption('c-0001', 0, 2, '重なり'), caption('c-0002', 1, 3, '重なる')] }, { cuts: [] }), /overlap/);
  assert.throws(() => resolveCaptionDisplay({ ...base, captions: [caption('c-0001', 0, 1, 'abcdefghijklmnopq')] }, { cuts: [] }), /provide display_fragments/);
});

test('(a) same cue is deduped on overlapping tracks while non-overlapping occurrences remain', () => {
  const root = {
    display_policy: { ...policy, max_line_units: 20 },
    captions: [caption('c-0001', 0, 2, '重複しない字幕', { src: 'a' })],
  };
  const common = { sources: [{ id: 'a' }] };
  const overlapping = resolveCaptionDisplay(root, {
    ...common,
    cuts: [
      { src: 'a', in: 0, out: 2, at: 0, track: 0 },
      { src: 'a', in: 0, out: 2, at: 0, track: 1 },
    ],
  });
  assert.equal(overlapping.occurrence_count, 1);
  assert.equal(overlapping.display_cues[0].cut_index, 1, 'upper/later track wins');

  const separated = resolveCaptionDisplay(root, {
    ...common,
    cuts: [
      { src: 'a', in: 0, out: 2, at: 0, track: 0 },
      { src: 'a', in: 0, out: 2, at: 2, track: 1 },
    ],
  });
  assert.equal(separated.occurrence_count, 2);
  assert.deepEqual(separated.display_cues.map(cue => [cue.start, cue.end]), [[0, 2], [2, 4]]);

  const partial = dedupeCaptionOccurrences([
    { source_cue_id: 'c-0001', start: 0, end: 3, track: 0, source_start: 0, source_end: 3 },
    { source_cue_id: 'c-0001', start: 1, end: 2, track: 1, source_start: 1, source_end: 2 },
  ], [0, 1]);
  assert.deepEqual(partial.map(({ start, end, track }) => ({ start, end, track })), [
    { start: 0, end: 1, track: 0 },
    { start: 1, end: 2, track: 1 },
    { start: 2, end: 3, track: 0 },
  ]);
});

test('(b) captions off contributes no occurrence', () => {
  const result = resolveCaptionDisplay({
    display_policy: policy,
    captions: [caption('c-0001', 0, 1, '表示しない', { src: 'a' })],
  }, {
    sources: [{ id: 'a' }],
    cuts: [{ src: 'a', in: 0, out: 1, captions: 'off' }],
  });
  assert.equal(result.occurrence_count, 0);
  assert.deepEqual(result.display_cues, []);
});

test('(c) fully cut words disappear, partially intersecting words remain, and source data is immutable', () => {
  const source = caption('c-0001', 0, 2, '前消残後', {
    src: 'a',
    words: [
      { text: '前', start: 0, end: 0.5 },
      { text: '消', start: 0.5, end: 0.9 },
      { text: '残', start: 0.9, end: 1.2 },
      { text: '後', start: 1.2, end: 2 },
    ],
  });
  const before = JSON.stringify(source);
  const projected = projectCaptionWords(source, [
    { src: 'a', in: 0, out: 0.5 },
    { src: 'a', in: 1, out: 2 },
  ]);
  assert.equal(projected.displayText, '前残後');
  assert.deepEqual(projected.words.map(word => word.text), ['前', '残', '後']);
  assert.equal(JSON.stringify(source), before, 'text/words[] source bytes');

  const empty = projectCaptionWords(source, [{ src: 'a', in: 2, out: 3 }]);
  assert.equal(empty.renderable, false);
  const removed = resolveCaptionDisplay({
    display_policy: { ...policy, max_line_units: 2 },
    captions: [{ ...source, text: '長すぎる字幕本文', words: [
      { text: '長すぎる字幕本文', start: 0.5, end: 0.9 },
    ] }],
  }, { sources: [{ id: 'a' }], cuts: [
    { src: 'a', in: 0, out: 0.5 },
    { src: 'a', in: 1, out: 2 },
  ] });
  assert.equal(removed.display_cue_count, 0, 'an entirely removed cue is not validated as visible text');
});

test('(d) no dedupe/off/cut case preserves existing occurrence bytes', () => {
  const occurrence = {
    source_cue_id: 'c-0001', start: 0, end: 1, track: 0,
    source_start: 0, source_end: 1, sentinel: { keep: 'bytes' },
  };
  const before = JSON.stringify([occurrence]);
  const after = dedupeCaptionOccurrences([occurrence], [0]);
  assert.equal(JSON.stringify(after), before);
  assert.equal(after[0], occurrence);
});

test('display-policy caption styles accept omission, preserve known conflicts, and name unknown values', () => {
  const withStyle = (...style) => ({
    display_policy: styleParity.display_policy,
    captions: [{ ...styleParity.caption, ...(style.length === 0 ? {} : { style: style[0] }) }],
  });
  assert.doesNotThrow(() => resolveCaptionDisplay(withStyle(), styleParity.edit));

  for (const style of ['karaoke', 'pop', 'reveal', 'reveal-word']) {
    assert.throws(() => resolveCaptionDisplay(withStyle(style), styleParity.edit), error => {
      assert.equal(error.code, 'STYLE_CONFLICT');
      assert.equal(error.message, 'captions[0].style cannot be combined with display_policy');
      return true;
    }, style);
  }

  for (const style of [
    styleParity.caption_style_contract.rejected_with_display_policy.style,
    'REVEAL',
    'reveal_word',
    '',
  ]) {
    assert.throws(() => resolveCaptionDisplay(withStyle(style), styleParity.edit), error => {
      assert.equal(error.code, styleParity.caption_style_contract.rejected_with_display_policy.error_code);
      assert.ok(error.message.includes(JSON.stringify(style)));
      assert.match(error.message, /expected one of: karaoke, pop, reveal, reveal-word/u);
      assert.doesNotMatch(error.message, /display_policy/u);
      return true;
    }, JSON.stringify(style));
  }
});

test('fails closed for malformed source cues and every version 1 source reference mismatch', () => {
  const root = { display_policy: policy, captions: [caption('c-0001', 0, 1, '正常です', { src: 'ghost' })] };
  const edit = {
    version: 1,
    output: { width: 1920, height: 1080 },
    sources: [{ id: 'a' }, { id: 'b' }],
    cuts: [{ src: 'a', in: 0, out: 1 }],
  };
  assert.throws(() => resolveCaptionDisplay(root, edit), /captions\[0\]\.src does not reference/u);
  assert.throws(() => resolveCaptionDisplay({ ...root, captions: [caption('c-0001', 0, 1, '正常です')] }, edit), /captions\[0\]\.src is required/u);
  assert.throws(() => resolveCaptionDisplay(root, { ...edit, cuts: [{ in: 0, out: 1 }] }), /cuts\[0\]\.src is required/u);
  assert.throws(() => resolveCaptionDisplay(root, { ...edit, cuts: [{ src: 'ghost', in: 0, out: 1 }] }), /cuts\[0\]\.src does not reference/u);
  assert.throws(() => resolveCaptionDisplay(root, { ...edit, sources: [{ id: 'a' }, { id: 'a' }] }), /sources\[\]\.id is duplicated/u);
  assert.throws(() => resolveCaptionDisplay(root, { ...edit, sources: [{ id: '' }, { id: 'b' }] }), /sources\[0\]\.id must be/u);
  assert.throws(() => resolveCaptionDisplay({ ...root, captions: [
    caption('c-0001', 0, 1, '正常です', { src: 'a' }),
    caption('c-0001', 1, 2, '重複です', { src: 'a' }),
  ] }, edit), /captions\[\]\.id is duplicated/u);
  assert.throws(() => resolveCaptionDisplay({ ...root, captions: [caption('c-0001', 1, 1, '時刻不正', { src: 'a' })] }, edit), /0 <= start < end/u);
});

test('opt-in kernel accepts every captions.schema-valid text style in the shared parity fixture', () => {
  for (const item of styleParity.valid_style_cases) {
    const root = {
      display_policy: styleParity.display_policy,
      default_text_style: item.style,
      captions: [styleParity.caption],
    };
    assert.doesNotThrow(() => resolveCaptionDisplay(root, styleParity.edit), item.id);
  }
  assert.doesNotThrow(() => resolveCaptionDisplay({
    display_policy: styleParity.display_policy,
    default_text_style: styleParity.valid_default_style,
    captions: [{ ...styleParity.caption, text_style: { color: '#FFF4D6' } }],
  }, styleParity.edit));
});

test('opt-in kernel rejects the complete shared style matrix before merge', () => {
  for (const item of styleParity.invalid_cases) {
    assert.throws(() => resolveCaptionDisplay(styleRootForCase(item), styleParity.edit), undefined, item.id);
  }
  for (const [id, style] of [
    ['size-nan', { size_px: Number.NaN }],
    ['line-height-infinity', { line_height: Number.POSITIVE_INFINITY }],
    ['stroke-width-nan', { stroke: { width_px: Number.NaN } }],
    ['background-opacity-infinity', { background: { opacity: Number.POSITIVE_INFINITY } }],
    ['layout-left-nan', { layout: {
      mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
      left_px: Number.NaN, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1,
    } }],
  ]) {
    assert.throws(() => resolveCaptionDisplay({
      display_policy: styleParity.display_policy,
      captions: [{ ...styleParity.caption, text_style: style }],
    }, styleParity.edit), undefined, id);
  }
});

test('reference-pixel geometry resolves A4 numeric oracle and scales only pixel fields', () => {
  const resolved = resolveCaptionStyleForOutput({
    size_px: 82,
    font_weight: 600,
    line_height: 1.08,
    stroke: { method: 'webkit-outline', color: '#050505', width_px: 5 },
    background: { radius_px: 18 },
    layout: {
      mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
      left_px: 261, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1,
    },
  }, { width: 1920, height: 1080 });
  assert.deepEqual(resolved.layout, {
    mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
    left_px: 261, width_px: 1120, right_px: 539, center_x_px: 821,
    bottom_px: 29, text_align: 'center', max_lines: 1, scale: 1,
  });
  assert.equal(resolved.vars['--caption-font-size'], '82px');
  assert.equal(resolved.vars['--caption-font-weight'], '600');
  assert.equal(resolved.vars['--caption-line-height'], '1.08');
  assert.equal(resolved.vars['--caption-webkit-text-stroke'], '5px #050505');
  assert.equal(resolved.vars['--caption-text-shadow'], 'none');
  assert.throws(() => resolveCaptionStyleForOutput({ layout: {
    mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
    left_px: 261, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1,
  } }, { width: 1080, height: 1920 }), /aspect ratio/);
});

// 2026-08-26 akari-reel 実機: text_anchor + position の位置変数はこれまで render-cut 側の
// ローカル複製だけが実装し、プレビューは落としていた（明示位置付き字幕がプレビューだけ
// 既定下段 7% に出る出力不一致）。単一定義 captionAnchorPositionVars を正とする。
test('captionAnchorPositionVars maps the nine anchors and 0..1 positions like the render pipeline', () => {
  assert.deepEqual(captionAnchorPositionVars('tc', { y: 0.386458 }, undefined), {
    '--caption-top': '38.65%',
    '--caption-bottom': 'auto',
    '--caption-left': '4%',
    '--caption-right': '4%',
    '--caption-align-items': 'center',
    '--caption-text-align': 'center',
    '--caption-line-margin': '0',
    '--caption-line-max-width': '100%',
  });
  assert.deepEqual(captionAnchorPositionVars('bc', undefined, undefined), {
    '--caption-top': 'auto',
    '--caption-bottom': '7%',
    '--caption-left': '4%',
    '--caption-right': '4%',
    '--caption-align-items': 'center',
    '--caption-text-align': 'center',
    '--caption-line-margin': '0',
    '--caption-line-max-width': '100%',
  });
  assert.deepEqual(captionAnchorPositionVars('mc', undefined, undefined)['--caption-justify-content'], 'center');
  const withX = captionAnchorPositionVars('tl', { x: 0.25, y: 1.5 }, undefined);
  assert.equal(withX['--caption-left'], '25%');
  assert.equal(withX['--caption-align-items'], 'flex-start');
  assert.equal(withX['--caption-top'], '100%', 'position.y is clamped to 0..1');
  assert.deepEqual(captionAnchorPositionVars(undefined, undefined, 'middle')['--caption-top'], '0');
  assert.deepEqual(captionAnchorPositionVars('zz', undefined, undefined), {}, 'invalid anchor is ignored');
  assert.deepEqual(captionAnchorPositionVars(undefined, undefined, undefined), {});
});

test('captionAnchorPositionVars places bc position.y at the plate bottom edge', () => {
  assert.deepEqual(captionAnchorPositionVars('bc', { y: 0.905 }, undefined), {
    '--caption-top': 'auto',
    '--caption-bottom': '9.5%',
    '--caption-left': '4%',
    '--caption-right': '4%',
    '--caption-align-items': 'center',
    '--caption-text-align': 'center',
    '--caption-line-margin': '0',
    '--caption-line-max-width': '100%',
  });
});

test('captionAnchorPositionVars combines bl bottom-edge y with explicit x', () => {
  assert.deepEqual(captionAnchorPositionVars('bl', { x: 0.1, y: 0.9 }, undefined), {
    '--caption-top': 'auto',
    '--caption-bottom': '10%',
    '--caption-left': '10%',
    '--caption-right': '4%',
    '--caption-align-items': 'flex-start',
    '--caption-line-margin': '0',
  });
});

test('captionAnchorPositionVars uses bottom-edge y for explicit bottom vertical alignment', () => {
  assert.deepEqual(captionAnchorPositionVars(undefined, { y: 0.905 }, 'bottom'), {
    '--caption-top': 'auto',
    '--caption-bottom': '9.5%',
  });
});

test('captionAnchorPositionVars keeps position-only y top-based', () => {
  assert.deepEqual(captionAnchorPositionVars(undefined, { y: 0.38 }, undefined), {
    '--caption-top': '38%',
    '--caption-bottom': 'auto',
  });
});

test('captionAnchorPositionVars centers middle-anchor y and leaves other anchor modes unchanged', () => {
  assert.deepEqual(captionAnchorPositionVars('mc', { y: 0.5 }, undefined), {
    '--caption-top': '50%',
    '--caption-bottom': 'auto',
    '--caption-translate': '0 -50%',
    '--caption-left': '4%',
    '--caption-right': '4%',
    '--caption-align-items': 'center',
    '--caption-text-align': 'center',
    '--caption-line-margin': '0',
    '--caption-line-max-width': '100%',
  });
  assert.equal(captionAnchorPositionVars('mc', undefined, undefined)['--caption-translate'], undefined);
  assert.equal(captionAnchorPositionVars('tc', { y: 0.5 }, undefined)['--caption-translate'], undefined);
  assert.equal(captionAnchorPositionVars('bc', { y: 0.5 }, undefined)['--caption-translate'], undefined);
  assert.deepEqual(captionAnchorPositionVars(undefined, { y: 0.5 }, 'middle'), {
    '--caption-top': '50%',
    '--caption-bottom': 'auto',
    '--caption-translate': '0 -50%',
  });
});

test('captionAnchorPositionVars clamps bottom-anchor y before computing the bottom offset', () => {
  assert.equal(captionAnchorPositionVars('bc', { y: 1.5 }, undefined)['--caption-bottom'], '0%');
});

test('resolveCaptionStyleForOutput emits anchor/position vars unless a reference-pixel layout owns the geometry', () => {
  const anchored = resolveCaptionStyleForOutput({ text_anchor: 'tc', position: { y: 0.5 } }, undefined);
  assert.equal(anchored.vars['--caption-top'], '50%');
  assert.equal(anchored.vars['--caption-bottom'], 'auto');
  const withLayout = resolveCaptionStyleForOutput({
    text_anchor: 'tc',
    position: { y: 0.5 },
    layout: {
      mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
      left_px: 261, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1,
    },
  }, { width: 1920, height: 1080 });
  assert.equal(withLayout.vars['--caption-top'], undefined, 'layout keeps exclusive ownership of geometry');
  assert.equal(withLayout.vars['--caption-bottom'], '29px');
});

test('legacy shadow preserves non-integer width bytes while reference-pixel scaling rounds to six places', () => {
  const width = 1.23456789;
  const legacy = resolveCaptionStyleForOutput({ stroke: { color: '#000000', width_px: width } }, undefined);
  assert.equal(legacy.vars['--caption-text-shadow'],
    '-1.23456789px -1.23456789px 0 #000000, 1.23456789px -1.23456789px 0 #000000, '
    + '-1.23456789px 1.23456789px 0 #000000, 1.23456789px 1.23456789px 0 #000000, '
    + '0 0 8px rgba(0,0,0,.6)');
  const scaled = resolveCaptionStyleForOutput({
    stroke: { color: '#000000', width_px: width },
    layout: {
      mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
      left_px: 261, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1,
    },
  }, { width: 960, height: 540 });
  assert.match(scaled.vars['--caption-text-shadow'], /0\.617284px/u);
});

test('omitting display_policy leaves the legacy path untouched', () => {
  const legacyArray = [caption('c-0001', 0, 1, 'legacy', {
    style: styleParity.caption_style_contract.rejected_with_display_policy.style,
    text_style: { font_weight: '600', stroke: { method: 'invented' } },
  })];
  const legacyObject = { default_text_style: { color: 17, invented: true }, captions: legacyArray };
  const before = JSON.stringify(legacyObject);
  assert.equal(resolveCaptionDisplay(legacyArray, { cuts: [] }), null);
  assert.equal(resolveCaptionDisplay(legacyObject, { cuts: [] }), null);
  assert.equal(JSON.stringify(legacyObject), before);
});

function styleRootForCase(item) {
  const root = {
    display_policy: styleParity.display_policy,
    default_text_style: styleParity.valid_default_style,
    captions: [{ ...styleParity.caption, text_style: { color: '#FFF4D6' } }],
  };
  if (Object.hasOwn(item, 'default_text_style')) root.default_text_style = item.default_text_style;
  if (Object.hasOwn(item, 'caption_text_style')) root.captions[0].text_style = item.caption_text_style;
  return root;
}

// issue #40 §2（2026-09-01）: zone 方式の px 系フィールドは reference_height_px を宣言すると
// output.height / reference_height_px で自動追随する。宣言なしは従来値バイト同一。
const REFERENCE_PIXEL_LAYOUT = {
  mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
  left_px: 261, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1,
};

test('reference_height_px scales zone-style px fields by output height and leaves undeclared styles byte-identical', () => {
  const style = {
    zone: 'bottom', size_px: 36, reference_height_px: 720,
    stroke: { color: '#000000', width_px: 3 }, background: { radius_px: 8 },
  };
  const hd = resolveCaptionStyleForOutput(style, { width: 1280, height: 720 });
  assert.equal(hd.vars['--caption-font-size'], '36px');
  assert.equal(hd.vars['--plate-radius'], '8px');
  assert.match(hd.vars['--caption-text-shadow'], /^-3px -3px 0 #000000, 3px -3px 0 #000000/u);
  const uhd = resolveCaptionStyleForOutput(style, { width: 3840, height: 2160 });
  assert.equal(uhd.vars['--caption-font-size'], '108px');
  assert.equal(uhd.vars['--plate-radius'], '24px');
  assert.equal(uhd.vars['--plate-block-radius'], '24px');
  assert.match(uhd.vars['--caption-text-shadow'], /^-9px -9px 0 #000000, 9px -9px 0 #000000/u);
  assert.equal(uhd.layout, undefined, 'zone 方式なので reference-pixel layout は生まれない');
  const outline = resolveCaptionStyleForOutput(
    { ...style, stroke: { method: 'webkit-outline', color: '#000000', width_px: 3 } },
    { width: 3840, height: 2160 },
  );
  assert.equal(outline.vars['--caption-webkit-text-stroke'], '9px #000000');
  // 基準は高さ: 縦型 1080×1920 でも scale = 1920 / 720
  assert.equal(resolveCaptionStyleForOutput(style, { width: 1080, height: 1920 }).vars['--caption-font-size'], '96px');
  // 宣言なしは 4K でも従来値（720p の vars と同一 = 従来どおり追随しない）
  const { reference_height_px: _omitted, ...plain } = style;
  assert.deepEqual(resolveCaptionStyleForOutput(plain, { width: 3840, height: 2160 }).vars, hd.vars);
  assert.deepEqual(resolveCaptionStyleForOutput(plain, undefined).vars, hd.vars);
});

test('reference_height_px requires output height, an integer >= 1, and no reference-pixel layout', () => {
  const style = { size_px: 36, reference_height_px: 720 };
  assert.throws(() => resolveCaptionStyleForOutput(style, undefined), error => error.code === 'INVALID_OUTPUT_GEOMETRY');
  assert.throws(() => resolveCaptionStyleForOutput(style, { width: 1920 }), error => error.code === 'INVALID_OUTPUT_GEOMETRY');
  assert.equal(resolveCaptionReferenceScale({ size_px: 36 }, undefined), 1);
  assert.equal(resolveCaptionReferenceScale(style, { width: 3840, height: 2160 }), 3);
  assert.equal(resolveCaptionReferenceScale(style, { width: 1280, height: 720 }), 1);
  for (const value of [0, -1, 1.5, '720', Number.NaN, Number.POSITIVE_INFINITY, null, true]) {
    assert.throws(() => validateCaptionTextStyle({ reference_height_px: value }), error => error.code === 'INVALID_TEXT_STYLE', String(value));
    assert.throws(() => resolveCaptionReferenceScale({ reference_height_px: value }, { width: 1920, height: 1080 }), error => error.code === 'INVALID_TEXT_STYLE', String(value));
  }
  assert.deepEqual(validateCaptionTextStyle({ reference_height_px: 1 }), { reference_height_px: 1 });
  // layout（reference-pixel）との併用は kernel の 3 入口（validate / merge / resolve）全てで拒否
  assert.throws(() => validateCaptionTextStyle({ reference_height_px: 720, layout: REFERENCE_PIXEL_LAYOUT }), error => error.code === 'STYLE_LAYOUT_CONFLICT');
  assert.throws(() => mergeCaptionDisplayStyles({ layout: REFERENCE_PIXEL_LAYOUT }, { reference_height_px: 720 }), error => error.code === 'STYLE_LAYOUT_CONFLICT');
  assert.throws(() => mergeCaptionDisplayStyles({ reference_height_px: 720 }, { layout: REFERENCE_PIXEL_LAYOUT }), error => error.code === 'STYLE_LAYOUT_CONFLICT');
  assert.throws(() => resolveCaptionStyleForOutput({ reference_height_px: 720, layout: REFERENCE_PIXEL_LAYOUT }, { width: 1920, height: 1080 }), error => error.code === 'STYLE_LAYOUT_CONFLICT');
  assert.throws(() => resolveCaptionReferenceScale({ reference_height_px: 720, layout: REFERENCE_PIXEL_LAYOUT }, { width: 1920, height: 1080 }), error => error.code === 'STYLE_LAYOUT_CONFLICT');
  assert.throws(() => resolveCaptionDisplay({
    display_policy: policy,
    default_text_style: { layout: REFERENCE_PIXEL_LAYOUT },
    captions: [caption('c-0001', 0, 1, '併用です', { text_style: { reference_height_px: 720 } })],
  }, { output: { width: 1920, height: 1080 }, cuts: [] }), error => error.code === 'STYLE_LAYOUT_CONFLICT');
  // layout 経路は従来どおり output.width / reference_width_px
  const layoutOnly = resolveCaptionStyleForOutput({ size_px: 82, layout: REFERENCE_PIXEL_LAYOUT }, { width: 3840, height: 2160 });
  assert.equal(layoutOnly.vars['--caption-font-size'], '164px');
  assert.equal(layoutOnly.layout.scale, 2);
});

test('cue-level reference_height_px overrides default_text_style field by field through the display kernel', () => {
  const result = resolveCaptionDisplay({
    display_policy: policy,
    default_text_style: { size_px: 36, reference_height_px: 720, stroke: { color: '#000000', width_px: 3 } },
    captions: [
      caption('c-0001', 0, 1, '既定です'),
      caption('c-0002', 1, 2, '上書きです', { text_style: { reference_height_px: 1080 } }),
      caption('c-0003', 2, 3, '色だけです', { text_style: { color: '#FFF4D6' } }),
    ],
  }, { output: { width: 3840, height: 2160 }, cuts: [] });
  const [byDefault, overridden, colorOnly] = result.display_cues;
  assert.equal(byDefault.style_vars['--caption-font-size'], '108px');
  assert.match(byDefault.style_vars['--caption-text-shadow'], /^-9px -9px 0 #000000/u);
  assert.equal(overridden.style_vars['--caption-font-size'], '72px');
  assert.match(overridden.style_vars['--caption-text-shadow'], /^-6px -6px 0 #000000/u);
  assert.deepEqual(overridden.text_style, { size_px: 36, reference_height_px: 1080, stroke: { color: '#000000', width_px: 3 } });
  assert.equal(colorOnly.style_vars['--caption-font-size'], '108px', 'cue が reference_height_px を持たなければ default を継承する');
  assert.equal(colorOnly.style_vars['--caption-color'], '#FFF4D6');
});

test('scaleCaptionPx keeps scale 1 values untouched and rounds scaled values to six places', () => {
  assert.equal(scaleCaptionPx(1.23456789, 1), 1.23456789);
  assert.equal(scaleCaptionPx(0.1, 3), 0.3);
  assert.equal(scaleCaptionPx(36, 1.5), 54);
  assert.equal(scaleCaptionPx(1.23456789, 0.5), 0.617284);
});

test('max_characters accepts positive integers through the display policy kernel', () => {
  assert.deepEqual(validateCaptionTextStyle({ max_characters: 1 }), { max_characters: 1 });
  const result = resolveCaptionDisplay({
    display_policy: policy,
    default_text_style: { max_characters: 12 },
    captions: [caption('c-0001', 0, 2, '正常です', { text_style: { max_characters: 8 } })],
  }, { output: { width: 1920, height: 1080 }, cuts: [] });
  assert.equal(result.display_cues[0].text_style.max_characters, 8);
});

test('max_characters rejects non-positive integers and invalid types', () => {
  for (const value of [0, -1, 1.5, '12', NaN, Infinity, null, true]) {
    assert.throws(() => validateCaptionTextStyle({ max_characters: value }), error =>
      error.code === 'INVALID_TEXT_STYLE'
      && /max_characters must be an integer greater than zero/u.test(error.message), String(value));
  }
});
