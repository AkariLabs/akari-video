import assert from 'node:assert/strict';
import test from 'node:test';
import { generateCaptionOverlays, generateResolvedCaptionOverlays,
  roundedCaptionStrokeShadows } from '../src/captions.mjs';

const style = { size_px: 64, stroke: { color: '#000000', width_px: 8 } };
const cue = { id: 'c-0005', start: 3, end: 6, text: 'こんにちは', time_domain: 'output', text_style: style };
const cuts = [{ id: 'cut-1', src: 'a', in: 0, out: 12, at: 0 }];

test('placed text uses a round 8px outer radius in plain and resolved HTML', () => {
  const plain = generateCaptionOverlays([cue], cuts)[0];
  const resolved = generateResolvedCaptionOverlays({ display_cues: [{
    id: 'c-0005-occ-0001-part-1', source_cue_id: cue.id, cut_index: -1,
    start: 3, end: 6, text: cue.text, text_style: style,
    style_vars: plain.vars,
  }] })[0];
  for (const overlay of [plain, resolved]) {
    assert.match(overlay.html, /-webkit-text-stroke:0 transparent;text-shadow:var\(--caption-rounded-stroke\);/u);
    assert.equal(overlay.vars['--caption-rounded-stroke'], roundedCaptionStrokeShadows('16px #000000'));
  }
});

test('a declared shadow is kept, while none leaves a valid shadow list', () => {
  const circle = roundedCaptionStrokeShadows('16px #000000');
  assert.equal(roundedCaptionStrokeShadows('16px #000000', 'none'), circle);
  assert.equal(roundedCaptionStrokeShadows('16px #000000', '0 2px 8px #333333'),
    `${circle},0 2px 8px #333333`);
});

test('spoken captions keep their existing stroke CSS', () => {
  const spoken = generateCaptionOverlays([{ ...cue, time_domain: 'source' }], [])[0];
  assert.equal(spoken.vars['--caption-rounded-stroke'], undefined);
  assert.doesNotMatch(spoken.html, /var\(--caption-rounded-stroke\)/u);
});
