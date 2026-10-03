import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCaptions, serializeCaptions } from '../lib/browser/caption-store.js';

const row = id => ({ id, start: 0, end: 1, text: id, speaker: null, sourceRef: null,
  edited: false, text_style: { size_px: 56, reference_height_px: 1080 } });

test('transcript caption serializer retains raw rich style and default style', () => {
  const rich = { fill: { type: 'solid', color: '#ff0000' },
    strokes: [{ color: '#000000', width_px: 2 }, { color: '#ffffff', width_px: 4 }] };
  const parsed = parseCaptions(JSON.stringify({ default_text_style: rich,
    captions: [{ ...row('a'), text_style: { ...row('a').text_style, ...rich } }] }));
  const result = JSON.parse(serializeCaptions(parsed.captions, parsed.shape));
  assert.deepEqual(result.default_text_style, rich);
  assert.deepEqual(result.captions[0].text_style.fill, rich.fill);
  assert.deepEqual(result.captions[0].text_style.strokes, rich.strokes);
});
