import assert from 'node:assert/strict';
import test from 'node:test';
import { captionTextStyleVars } from '../src/captions.mjs';
import { resolveCaptionLineStyleVars } from '../../edit-store/lib/caption-display.js';

test('render-cut uses the shared left-edge variables for placed vertical captions', () => {
  const output = { width: 1920, height: 1080 };
  const style = { text_anchor: 'tl', position: { x: 0.4351, y: 0.5556 }, vertical: true, size_px: 45 };
  const exported = captionTextStyleVars(style, output);
  const preview = resolveCaptionLineStyleVars(style, output);
  assert.deepEqual(exported, preview);
  assert.equal(exported['--caption-left'], '43.51%');
  assert.equal(exported['--caption-right'], 'auto');
  for (const placement of [
    { text_anchor: 'tl', position: { y: 0.3 } },
    { zone: 'top-left' },
  ]) {
    const noX = { ...placement, vertical: true, size_px: 45 };
    const outputVars = captionTextStyleVars(noX, output);
    assert.deepEqual(outputVars, resolveCaptionLineStyleVars(noX, output));
    assert.equal(outputVars['--caption-left'], '4%');
    assert.equal(outputVars['--caption-right'], 'auto');
  }
});
