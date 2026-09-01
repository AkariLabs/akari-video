import assert from 'node:assert/strict';
import test from 'node:test';

import {
  layoutPercent,
  panTranslatePx,
  shouldReanchorPan,
} from '../lib/browser/timeline-pan-transform.js';

test('layout percent はアンカー窓を基準に -60%..160% へクランプする', () => {
  assert.equal(layoutPercent(40, 100, 50), -60);
  assert.equal(layoutPercent(100, 100, 50), 0);
  assert.equal(layoutPercent(125, 100, 50), 50);
  assert.equal(layoutPercent(180, 100, 50), 160);
  assert.equal(layoutPercent(200, 100, 50), 160);
  assert.equal(layoutPercent(125, 100, 0), 0);
});

test('パン量をアンカー窓の幅に対する translateX px へ換算する', () => {
  assert.equal(panTranslatePx(110, 100, 50, 1000), -200);
  assert.equal(panTranslatePx(90, 100, 50, 1000), 200);
  assert.equal(panTranslatePx(110, 100, 0, 1000), 0);
});

test('再アンカーは絶対ドリフトが比率しきい値を超えたときだけ必要になる', () => {
  assert.equal(shouldReanchorPan(25, 100, 0.25), false);
  assert.equal(shouldReanchorPan(-25, 100, 0.25), false);
  assert.equal(shouldReanchorPan(25.001, 100, 0.25), true);
  assert.equal(shouldReanchorPan(-25.001, 100, 0.25), true);
  assert.equal(shouldReanchorPan(1, 0, 0.25), false);
});
