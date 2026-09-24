import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCaptionOverlays, generateResolvedCaptionOverlays, renderResolvedSingleLineCaption } from '../src/captions.mjs';

test('resolved caption HTML keeps the no-runs result byte-for-byte', () => {
  const cue = { id: 'c-0001', source_cue_id: 'c-0001', start: 0, end: 2,
    text: 'これは最高です', display_lines: ['これは最', '高です'] };
  const expected = renderResolvedSingleLineCaption(cue.text, cue.display_lines, cue);
  assert.equal(generateResolvedCaptionOverlays({ display_cues: [cue] })[0].html, expected);
});

test('resolved caption wraps a run across lines and retains text style', () => {
  const cue = { id: 'c-0001', source_cue_id: 'c-0001', start: 0, end: 2,
    text: 'これは最高です', display_lines: ['これは最', '高です'],
    runs: [{ from: 3, to: 5, role: 'emphasis', style: {
      color: '#ff5a5f', font_weight: 900, scale: 1.3,
      baseline_shift_em: -0.1, rotate_deg: 8
    } }] };
  const html = generateResolvedCaptionOverlays({ display_cues: [cue] })[0].html;
  assert.equal((html.match(/data-role="emphasis"/g) ?? []).length, 2);
  assert.match(html, /color:#ff5a5f/);
  assert.match(html, /font-weight:900/);
  assert.match(html, /translateY\(-0.1em\) rotate\(8deg\) scale\(1.3\)/);
});

test('legacy fragments project a run to both windows', () => {
  const caption = { id: 'c-0001', start: 0, end: 2, text: '最高です',
    speaker: null, sourceRef: null, edited: false,
    display_fragments: ['最高', 'です'],
    runs: [{ from: 1, to: 3, role: 'keyword', style: { letter_spacing_em: 0.05 } }] };
  const overlays = generateCaptionOverlays([caption], []);
  assert.equal(overlays.length, 2);
  assert.equal((overlays[0].html.match(/data-role="keyword"/g) ?? []).length, 1);
  assert.equal((overlays[1].html.match(/data-role="keyword"/g) ?? []).length, 1);
  assert.match(overlays[0].html, /letter-spacing:0.05em/);
});
