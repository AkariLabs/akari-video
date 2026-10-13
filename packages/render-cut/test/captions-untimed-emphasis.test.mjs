import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolveCaptionPlan } from '../src/caption-resolve.mjs';
import { generateCaptionOverlays, renderCaptionFragment } from '../src/captions.mjs';

const { resolveCaptionWordStyleVars, TEXTSTYLE_CATALOG } = createRequire(import.meta.url)('../../edit-store/lib/index.js');
const policy = { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
  unit_metric: 'ascii-half-other-one-v1', max_line_units: 20,
  minimum_fragment_duration_seconds: 0.72, locale: 'ja', lines: 1, wrap: 'multi' };
const output = { width: 1280, height: 720 };
const edit = { version: 1, output, sources: [{ id: 'main', path: 'main.mp4' }],
  cuts: [{ id: 'cut', src: 'main', in: 0, out: 3, at: 0, track: 0 }] };
const cue = { id: 'c-0001', src: 'main', start: 0, end: 3, text: '同じ 同じ', style: 'karaoke' };
const word = marked => ({ id: 'e-0001', src: 'main', t_start: 1, t_end: 2,
  word: '同じ', emotion: 'emphasis', style_preset: 'emphasis-red',
  ...(marked ? { inherit_caption_size: true } : {}) });

test('untimed legacy captions paint both repeated matches statically', () => {
  for (const marked of [false, true]) {
    const [overlay] = generateCaptionOverlays([cue], edit.cuts, { output, emphasisWords: [word(marked)] });
    assert.equal((overlay.html.match(/data-emphasis-id="e-0001"/gu) ?? []).length, 2);
    assert.match(overlay.html, /color:#ff1744/u);
    assert.equal(overlay.html.includes('font-size:92px'), !marked);
    if (marked) assert.match(overlay.html, /-webkit-text-stroke:[^;]*em/u);
  }
});

test('resolved captions carry untimed emphasis into their exported HTML', () => {
  for (const marked of [false, true]) {
    const captionsRoot = { display_policy: policy, captions: [cue], emphasis_words: [word(marked)] };
    const plan = resolveCaptionPlan({ captionsRoot, edit });
    assert.equal((plan.overlays[0].html.match(/data-emphasis-id="e-0001"/gu) ?? []).length, 2);
    const vars = resolveCaptionWordStyleVars(TEXTSTYLE_CATALOG['emphasis-red'].style, output, marked);
    assert.equal(plan.overlays[0].html.includes(`font-size:${vars['--caption-tok-font-size']}`), !marked);
    assert.match(plan.overlays[0].html, /color:#ff1744/u);
  }
});

test('untimed emphasis obeys source and partial time overlap', () => {
  const candidate = { ...word(false), t_start: 2, t_end: 4 };
  const [match] = generateCaptionOverlays([cue], edit.cuts, { output, emphasisWords: [candidate] });
  assert.equal((match.html.match(/data-emphasis-id="e-0001"/gu) ?? []).length, 2);
  const [miss] = generateCaptionOverlays([cue], edit.cuts,
    { output, emphasisWords: [{ ...candidate, src: 'other' }] });
  assert.doesNotMatch(miss.html, /data-emphasis-id/u);
  const [late] = generateCaptionOverlays([cue], edit.cuts,
    { output, emphasisWords: [{ ...candidate, t_start: 3, t_end: 4 }] });
  assert.doesNotMatch(late.html, /data-emphasis-id/u);
});

test('untimed emphasis keeps plain rich segments inside token wrappers', () => {
  const html = renderCaptionFragment('前同じ後', { maximum: 20, contextStyle: {
    fill: { type: 'solid', color: '#ffffff' }
  }, untimedEmphasisWords: [word(false)] });
  assert.match(html, /class="akari-caption__tok">前<\/span>/u);
  assert.match(html, /data-emphasis-id="e-0001"/u);
  assert.match(html, /class="akari-caption__tok">後<\/span>/u);
});
