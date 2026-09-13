import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  resolveCaptionDisplay,
  resolveCaptionStylePreset,
  resolveCaptionWordStyleVars,
  TEXTSTYLE_CATALOG,
} from '../lib/index.js';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const loadFixture = async name => JSON.parse(await readFile(join(fixtureRoot, name), 'utf8'));

test('character tokens inherit the leftmost preset across the whole segmented Japanese word', async () => {
  const fixture = await loadFixture('caption-word-char-tokens.json');
  const result = resolveCaptionDisplay(fixture.captionsRoot, fixture.edit, { output: fixture.edit.output });
  const cue = result.display_cues.find(entry => entry.source_cue_id === 'c-0005');
  assert.ok(cue);
  const targetIndexes = cue.words
    .map((word, index) => ({ word, index }))
    .filter(({ word }) => ['ゴ', 'ール', 'デ', 'ン', 'ウ', 'ィ', 'ー', 'ク'].includes(word.text))
    .map(({ index }) => index);
  assert.equal(targetIndexes.length, 8, '9 文字の語は 8 個の入力トークンにまたがる');
  const styles = targetIndexes.map(index => cue.word_styles.find(style => style.from <= index && index < style.to));
  assert.ok(styles.every(style => style?.preset_id === 'verdict-badge'));
  assert.equal(cue.style_vars['--caption-word-line-height'], '80px');
});

test('title-impact uses an outside webkit stroke and no four-corner stroke shadow', () => {
  const preset = resolveCaptionStylePreset({ style_preset: 'title-impact' }, TEXTSTYLE_CATALOG);
  const vars = resolveCaptionWordStyleVars(preset.record.text_style, { width: 1920, height: 1080 });
  assert.equal(vars['--caption-tok-paint-order'], 'stroke fill');
  assert.equal(vars['--caption-tok-webkit-text-stroke'], '10px #000000');
  assert.equal(vars['--caption-tok-text-shadow'], '0px 8px 14px rgba(0,0,0,0.7)');
  assert.doesNotMatch(vars['--caption-tok-text-shadow'], /-10px -10px/u);
  const strokeOnly = resolveCaptionWordStyleVars({ stroke: { width_px: 10, color: '#000000' } }, undefined);
  assert.equal(strokeOnly['--caption-tok-text-shadow'], 'none');

  const subtitleNews = resolveCaptionStylePreset({ style_preset: 'subtitle-news' }, TEXTSTYLE_CATALOG);
  const subtitleNewsVars = resolveCaptionWordStyleVars(subtitleNews.record.text_style, undefined);
  assert.equal(Object.hasOwn(subtitleNewsVars, '--caption-tok-text-shadow'), false);

  const emphasisRed = resolveCaptionStylePreset({ style_preset: 'emphasis-red' }, TEXTSTYLE_CATALOG);
  const emphasisRedVars = resolveCaptionWordStyleVars(emphasisRed.record.text_style, undefined);
  assert.equal(emphasisRedVars['--caption-tok-text-shadow'], 'none');
});

test('the existing emphasis fixture is stable apart from the intentional cue line-height variable', async () => {
  const fixture = await loadFixture('caption-consumer-parity-emphasis.json');
  const result = resolveCaptionDisplay(fixture.captionsRoot, fixture.edit, { output: fixture.edit.output });
  for (const cue of result.display_cues) {
    if (!cue.style_vars) continue;
    delete cue.style_vars['--caption-word-line-height'];
    if (Object.keys(cue.style_vars).length === 0) delete cue.style_vars;
  }
  // 基点 b59d368a との差分は本票で足した --caption-word-line-height のみ。
  const digest = createHash('sha256').update(JSON.stringify(result.display_cues)).digest('hex');
  assert.equal(digest, '9d2171dd7d7f070da2d95a0115dcbf27626280d636dafd2fa5b4f6edee97a435');
});

test('missing Intl.Segmenter safely keeps the original token-level preset', async () => {
  const fixture = await loadFixture('caption-word-char-tokens.json');
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
  Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
  try {
    const result = resolveCaptionDisplay(fixture.captionsRoot, fixture.edit, { output: fixture.edit.output });
    const cue = result.display_cues.find(entry => entry.source_cue_id === 'c-0005');
    assert.deepEqual(cue.word_styles.map(style => style.preset_id), ['verdict-badge', 'title-impact']);
    assert.deepEqual(cue.word_styles.map(style => style.to - style.from), [1, 1]);
  } finally {
    Object.defineProperty(Intl, 'Segmenter', descriptor);
  }
});
