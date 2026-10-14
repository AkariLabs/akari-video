import assert from 'node:assert/strict';
import test from 'node:test';
import { generateCaptionOverlays, generateResolvedCaptionOverlays } from '../src/captions.mjs';

const style = { size_px: 64, stroke: { color: '#000000', width_px: 8 } };
const cue = { id: 'c-0005', start: 3, end: 6, text: 'Placed text', time_domain: 'output', text_style: style };
const cuts = [{ id: 'cut-1', src: 'a', in: 0, out: 12, at: 0 }];

test('placed and spoken captions retain the same CSS stroke', () => {
  const plain = generateCaptionOverlays([cue], cuts)[0];
  const resolved = generateResolvedCaptionOverlays({ display_cues: [{
    id: 'c-0005-occ-0001-part-1', source_cue_id: cue.id, cut_index: -1,
    start: 3, end: 6, text: cue.text, text_style: style,
    style_vars: { ...plain.vars, '--caption-webkit-text-stroke': plain.vars['--caption-stroke'] },
  }] })[0];
  const spoken = generateCaptionOverlays([{ ...cue, time_domain: 'source' }], [])[0];
  for (const overlay of [plain, resolved, spoken]) {
    assert.equal(overlay.vars['--caption-stroke'], '16px #000000');
    assert.equal(overlay.vars['--caption-rounded-stroke'], undefined);
    assert.doesNotMatch(overlay.html, /caption-rounded-stroke|text-shadow:var\(--caption-rounded-stroke\)/u);
    assert.match(overlay.html, /-webkit-text-stroke:\s*var\(--caption-(?:webkit-text-stroke|stroke),/u);
  }
});
