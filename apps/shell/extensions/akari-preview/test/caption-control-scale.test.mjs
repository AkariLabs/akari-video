import assert from 'node:assert/strict';
import test from 'node:test';
import { captionControlScale } from '../lib/common/caption-control-scale.js';

test('caption controls remain 11, 14×5 and 25 display pixels at a 0.173 stage scale', () => {
  const vars = captionControlScale(1920, 332, 1080, 187);
  const sx = 332 / 1920, sy = 187 / 1080;
  assert.ok(Math.abs(11 * Number(vars['--akari-caption-control-inverse-x']) * sx - 11) < 1e-9);
  assert.ok(Math.abs(14 * Number(vars['--akari-caption-control-inverse-x']) * sx - 14) < 1e-9);
  assert.ok(Math.abs(5 * Number(vars['--akari-caption-control-inverse-y']) * sy - 5) < 1e-9);
  assert.ok(Math.abs(25 * Number(vars['--akari-caption-control-inverse-x']) * sx - 25) < 1e-9);
  assert.ok(Math.abs(Number.parseFloat(vars['--akari-caption-control-pair']) * sx - 14) < 1e-9);
});
