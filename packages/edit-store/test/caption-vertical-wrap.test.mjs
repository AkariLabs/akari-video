import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCaptionLineStyleVars } from '../lib/caption-display.js';

test('vertical wrap uses output height and never publishes horizontal plate width', () => {
  const style = { vertical: true, wrap_width_pct: 40, size_px: 60,
    background: { color: '#111111', padding_px: 14, radius_px: 10 } };
  const vars = resolveCaptionLineStyleVars(style, { width: 1920, height: 1080 });
  assert.equal(vars['--caption-vertical-wrap-height'], '432px');
  assert.equal(vars['--caption-vertical-max-height'], '432px');
  assert.equal(vars['--caption-wrap-width'], undefined);
  assert.equal(vars['--plate-pad-x'], '14px');
  assert.equal(vars['--plate-pad-y'], '14px');
  const natural = resolveCaptionLineStyleVars({ ...style, wrap_width_pct: undefined },
    { width: 1920, height: 1080 });
  assert.equal(natural['--caption-vertical-max-height'], '972px');
  assert.equal(natural['--caption-vertical-wrap-height'], undefined);
});

test('horizontal variables retain their existing wrap and never expose vertical height', () => {
  const vars = resolveCaptionLineStyleVars({ wrap_width_pct: 40, size_px: 60 },
    { width: 1920, height: 1080 });
  assert.equal(vars['--caption-wrap-width'], '40%');
  assert.equal(vars['--caption-vertical-wrap-height'], undefined);
  assert.equal(vars['--caption-vertical-max-height'], undefined);
});
