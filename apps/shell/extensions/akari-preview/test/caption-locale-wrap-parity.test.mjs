import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { splitCaptionLines as renderSplit } from '../../../../../packages/render-cut/src/captions.mjs';
import { captionLanguageDefaults } from '../../../../../packages/content-language/src/index.mjs';
import { resolveCaptionDisplay } from '../../../../../packages/edit-store/lib/caption-display.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readHandlerSource();
const defaults = JSON.parse(readFileSync(
  new URL('../../../../../packages/content-language/src/caption-defaults.json', import.meta.url), 'utf8'));
const extract = (start, end) => {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, `preview caption code missing: ${start}`);
  return source.slice(begin, finish).replaceAll('\\\\', '\\');
};

const budgetCode = extract('const captionOutput =', 'const captionDefaultFontSize =');
const splitCode = extract('const CAPTION_BOUNDARIES =', '// splitCaptionLines の分割点');
const preview = (caption, output = { width: 1920, height: 1080 }, summaryFields = {}) =>
  new Function('caption', 'initial', `const summary = initial.summary;\n${budgetCode}\n${splitCode}\nreturn {
    locale: captionLocale(caption), maximum: captionLineBudget(caption),
    lines: splitCaptionLines(caption.text, captionLineBudget(caption), false, captionLocale(caption))
  };`)(caption, { summary: { output, ...summaryFields } });

for (const [locale, output] of [
  ['en', { width: 1920, height: 1080 }],
  ['en', { width: 1080, height: 1920 }],
  ['ja', { width: 1920, height: 1080 }],
  ['ja', { width: 1080, height: 1920 }],
]) {
  for (const explicit of [undefined, 44]) {
    test(`preview wrap matches export: ${locale}, ${output.width}x${output.height}, max ${explicit ?? 'default'}`, () => {
      const text = locale === 'en'
        ? 'This is a longer English caption with several words for the preview to wrap naturally.'
        : '今日はとても良い天気なので公園まで散歩に行きましょう。次の行も表示します。';
      const caption = { text, displayPolicy: { locale },
        ...(explicit ? { textStyle: { max_characters: explicit } } : {}) };
      const actual = preview(caption, output);
      const expectedMaximum = explicit ?? (output.height > output.width
        ? captionLanguageDefaults(locale).portraitCharacters
        : captionLanguageDefaults(locale).landscapeCharacters);
      assert.equal(actual.maximum, expectedMaximum);
      assert.deepEqual(actual.lines, renderSplit(text, expectedMaximum, false, locale));
      if (locale === 'ja' && explicit === undefined) {
        assert.deepEqual(actual.lines, renderSplit(text, output.height > output.width ? 10 : 20));
      }
    });
  }
}

test('cue override wins over summary locale and resolved English cues retain their language', () => {
  const text = 'This caption should stay on complete words when its line budget is reduced.';
  const cue = { text, textStyle: { max_characters: 20 }, displayPolicy: { locale: 'en' } };
  assert.deepEqual(preview(cue, undefined, { language: 'ja' }).lines,
    renderSplit(text, 20, false, 'en'));
  const resolved = { text, resolvedTimeline: true,
    textStyleVars: { '--caption-font-family': defaults.en.fontStack } };
  assert.equal(preview(resolved).maximum, 42);
  assert.deepEqual(preview({ ...resolved, textStyle: { max_characters: 44 } }).lines,
    renderSplit(text, 44, false, 'en'));
  assert.deepEqual(preview({ text: '今日はとても良い天気なので公園まで散歩に行きます。' }).lines,
    renderSplit('今日はとても良い天気なので公園まで散歩に行きます。', 20));
});

test('English display policy reaches preview through the resolved cue', () => {
  const text = 'A complete English caption is retained as one cue and wraps at natural word boundaries.';
  const root = {
    display_policy: {
      mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
      unit_metric: 'ascii-half-other-one-v1', max_line_units: 100,
      minimum_fragment_duration_seconds: 0.1, locale: 'en',
    },
    captions: [{ id: 'c-0001', start: 0, end: 4, text,
      speaker: null, sourceRef: null, edited: true }],
  };
  for (const maximum of [undefined, 44]) {
    const input = { ...root, ...(maximum ? { default_text_style: { max_characters: maximum } } : {}) };
    const [cue] = resolveCaptionDisplay(input, { cuts: [{ in: 0, out: 4 }] }).display_cues;
    assert.ok(cue);
    const actual = preview({ text: cue.text, resolvedTimeline: true,
      textStyle: cue.text_style, textStyleVars: cue.style_vars });
    assert.equal(actual.maximum, maximum ?? 42);
    assert.deepEqual(actual.lines, renderSplit(cue.text, maximum ?? 42, false, 'en'));
  }
});
