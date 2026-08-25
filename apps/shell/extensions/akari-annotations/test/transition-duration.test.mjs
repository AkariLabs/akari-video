import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatTransitionSeconds,
  roundTransitionDurationForWrite,
} from '../lib/common/transition-duration.js';

test('UI のクランプ値は 6 桁へ丸まり、通知文言と同じ 0.2 を書く', () => {
  const rounded = roundTransitionDurationForWrite(0.1999999999999993);
  assert.equal(rounded, 0.2);
  assert.equal(formatTransitionSeconds(rounded), '0.2');
});

test('丸め後 0 以下は none 扱いにできる 0 を返す', () => {
  assert.equal(roundTransitionDurationForWrite(0.0000004), 0);
  assert.equal(roundTransitionDurationForWrite(-1), 0);
  assert.equal(roundTransitionDurationForWrite(Number.NaN), 0);
});
