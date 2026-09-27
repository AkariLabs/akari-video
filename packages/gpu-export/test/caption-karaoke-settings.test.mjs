import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGpuEligibility } from '../src/eligibility.mjs';
import { generateCaptionOverlays } from '../../render-cut/src/captions.mjs';
import { readFileSync } from 'node:fs';

const cue = { id: 'c-0001', style: 'karaoke', start: 0, end: 2, text: '字幕',
  words: [{ text: '字幕', start: 0, end: 2 }] };
const classify = (style, inherited) => evaluateGpuEligibility({ edit: { output: { width: 1920, height: 1080 } },
  captions: [{ ...cue, ...(style ? { text_style: { karaoke: style } } : {}) }],
  ...(inherited ? { defaultTextStyle: { karaoke: inherited } } : {}) }).entries.find(entry => entry.kind === 'caption');

test('legacy and color-only karaoke retain GPU; fill and start position route to OSR', () => {
  assert.equal(classify().classification, 'same');
  assert.equal(classify({ done_color: '#fb923c' }).classification, 'same');
  for (const fill of ['char', 'word', 'smooth']) {
    assert.deepEqual([classify({ fill }).classification, classify({ fill }).reason],
      ['unsupported', 'caption-karaoke-fill-osr']);
  }
  assert.equal(classify({ start_index: 1 }).reason, 'caption-karaoke-fill-osr');
  assert.equal(classify({ done_color: '#fb923c' }, { fill: 'smooth' }).reason, 'caption-karaoke-fill-osr');
  const [overlay] = generateCaptionOverlays([{ ...cue, text_style: { karaoke: { done_color: '#fb923c' } } }], [],
    { output: { width: 1920, height: 1080 } });
  assert.equal(overlay.vars['--caption-highlight-color'], '#fb923c');
  const runtime = readFileSync(new URL('../src/page-runtime.js', import.meta.url), 'utf8');
  assert.match(runtime, /highlightCss[^;]*--caption-highlight-color,#ffd94a/u);
});
