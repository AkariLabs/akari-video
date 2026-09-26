import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateCaptionOverlays, generateResolvedCaptionOverlays,
} from '../src/captions.mjs';

const base = { id: 'size', start: 0, end: 2, text: '今日はいい天気',
  runs: [{ from: 3, to: 5, style: { scale: 1.5, baseline_shift_em: -0.15 } }] };

test('legacy export reserves run width and grows an unwrapped plate', () => {
  const [overlay] = generateCaptionOverlays([base], [], { width: 1280, height: 720 });
  assert.match(overlay.html, /font-size:1.5em/);
  assert.match(overlay.html, /letter-spacing:var\(--caption-letter-spacing,normal\)/);
  assert.match(overlay.html, /translateY\(-0.09999999999999999em\)/);
  assert.doesNotMatch(overlay.html, /scale\(1\.5\)/);
  assert.match(overlay.html, /width: var\(--caption-width, max-content\)/);
  assert.match(overlay.html, /margin-inline: var\(--caption-plate-margin, auto\)/);
});

test('declared wrap width fixes the plate and allows multiline layout', () => {
  const [overlay] = generateCaptionOverlays([{ ...base, text_style: { wrap_width_pct: 30 } }], [],
    { width: 1280, height: 720 });
  assert.equal(overlay.vars['--caption-wrap-width'], '30%');
  assert.match(overlay.html, /\.akari-caption__plate \{ width: var\(--caption-wrap-width\); \}/);
  assert.match(overlay.html, /white-space: pre-wrap; overflow-wrap: anywhere/);
});

test('resolved export shares run sizing and wrap rule', () => {
  const [overlay] = generateResolvedCaptionOverlays({ display_cues: [{ ...base,
    style_vars: { '--caption-wrap-width': '30%' }, source_cue_id: base.id }] });
  assert.match(overlay.html, /font-size:1.5em/);
  assert.match(overlay.html, /width: var\(--caption-wrap-width\)/);
  assert.match(overlay.html, /white-space: pre-wrap; overflow-wrap: anywhere/);
});
