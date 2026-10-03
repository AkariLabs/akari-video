import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCaptionLineStyleVars } from '../lib/caption-display.js';

test('vertical captions with an explicit x keep the same left edge as horizontal captions', () => {
  const position = { x: 0.4351, y: 0.5556 };
  const horizontal = resolveCaptionLineStyleVars({ text_anchor: 'tl', position, scale: 3 },
    { width: 1920, height: 1080 });
  const vertical = resolveCaptionLineStyleVars({ text_anchor: 'tl', position, scale: 3, vertical: true },
    { width: 1920, height: 1080 });
  assert.equal(horizontal['--caption-left'], '43.51%');
  assert.equal(horizontal['--caption-right'], '-35.51%');
  assert.equal(vertical['--caption-left'], horizontal['--caption-left']);
  assert.equal(vertical['--caption-right'], 'auto');
});

test('vertical captions without x have a frame-side placement', () => {
  for (const style of [{ text_anchor: 'tl' }, { zone: 'top-left' }, {}]) {
    const vars = resolveCaptionLineStyleVars({ ...style, vertical: true }, { width: 1920, height: 1080 });
    assert.notEqual(vars['--caption-left'], 'auto');
    assert.ok(vars['--caption-right'] === '4%' || vars['--caption-right'] === 'auto' || vars['--caption-right'] === undefined);
  }
});

test('vertical captions without x resolve an ambiguous horizontal edge to the export left edge', () => {
  const output = { width: 1920, height: 1080 };
  for (const style of [
    { text_anchor: 'tl', position: { y: 0.3 } },
    { zone: 'top-left' },
    { zone: 'top-left', position: { y: 0.3 } },
    { text_anchor: 'tr', position: { y: 0.3 }, scale: 3 },
  ]) {
    const vars = resolveCaptionLineStyleVars({ ...style, vertical: true }, output);
    assert.equal(vars['--caption-left'], '4%', JSON.stringify(style));
    assert.equal(vars['--caption-right'], 'auto', JSON.stringify(style));
  }
  const top = resolveCaptionLineStyleVars({ vertical: true, vertical_align: 'top' }, output);
  assert.equal(top['--caption-left'], 'auto');
  assert.equal(top['--caption-right'], '4%');
  const centered = resolveCaptionLineStyleVars({ vertical: true }, output);
  assert.equal(centered['--caption-left'], '50%');
  assert.equal(centered['--caption-right'], 'auto');
  const explicit = resolveCaptionLineStyleVars({ vertical: true, text_anchor: 'tl', position: { x: 0.4351, y: 0.3 } }, output);
  assert.equal(explicit['--caption-left'], '43.51%');
  assert.equal(explicit['--caption-right'], 'auto');
  const horizontal = resolveCaptionLineStyleVars({ text_anchor: 'tl', position: { y: 0.3 } }, output);
  assert.equal(horizontal['--caption-left'], '4%');
  assert.equal(horizontal['--caption-right'], '4%');
});
