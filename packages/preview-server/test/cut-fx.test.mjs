import assert from 'node:assert/strict';
import test from 'node:test';

import { FX_IDS as RENDER_FX_IDS } from '../../render-cut/src/fx.mjs';
import {
  APPROXIMATE_FX_IDS,
  FX_IDS,
  approximateBadgeLabel,
  flareVisual,
  intensityToOpacity,
  isApproximateFx,
  normalizeCutFxList,
  normalizePreviewColor,
  vignetteVisual,
} from '../public/cut-fx.js';

test('preview supports exactly the render-cut FX vocabulary', () => {
  assert.deepEqual([...FX_IDS].sort(), [...RENDER_FX_IDS].sort());
});

test('normalization defaults intensity to one, clamps it, and ignores unknown entries', () => {
  assert.deepEqual(normalizeCutFxList([
    { id: 'noise' },
    { id: 'vignette', intensity: -2, params: { color: 'white' } },
    { id: 'color-overlay', intensity: 2 },
    { id: 'unknown', intensity: 0.5 },
    null,
  ]), [
    { id: 'noise', intensity: 1, params: {}, sourceIndex: 0 },
    { id: 'vignette', intensity: 0, params: { color: 'white' }, sourceIndex: 1 },
    { id: 'color-overlay', intensity: 1, params: {}, sourceIndex: 2 },
  ]);
  assert.deepEqual(normalizeCutFxList(undefined), []);
});

test('intensity maps linearly to CSS opacity and zero is the identity boundary', () => {
  assert.equal(intensityToOpacity(0), 0);
  assert.equal(intensityToOpacity(0.22), 0.22);
  assert.equal(intensityToOpacity(0.32), 0.32);
  assert.equal(intensityToOpacity(1), 1);
  assert.equal(intensityToOpacity(-1), 0);
  assert.equal(intensityToOpacity(4), 1);
  assert.equal(intensityToOpacity(undefined), 1);
});

test('only procedural approximations receive the visible approximation badge', () => {
  assert.deepEqual(APPROXIMATE_FX_IDS, ['noise', 'particles', 'flare']);
  for (const id of FX_IDS) {
    assert.equal(isApproximateFx(id), APPROXIMATE_FX_IDS.includes(id));
    assert.equal(approximateBadgeLabel(id), APPROXIMATE_FX_IDS.includes(id) ? '[FX ≈ 近似]' : '');
  }
});

test('ffmpeg 0x colors become browser CSS colors and missing color falls back to black', () => {
  assert.equal(normalizePreviewColor('0xff0000'), '#ff0000');
  assert.equal(normalizePreviewColor('0x112233aa'), '#112233aa');
  assert.equal(normalizePreviewColor('#abcdef'), '#abcdef');
  assert.equal(normalizePreviewColor(undefined), 'black');
});

test('vignette visual uses the requested edge color and linear intensity', () => {
  const black = vignetteVisual(0.32);
  assert.equal(black.opacity, 0.32);
  assert.match(black.background, /rgba\(0,0,0,/);
  const white = vignetteVisual(0.5, 'white');
  assert.equal(white.opacity, 0.5);
  assert.match(white.background, /rgba\(255,255,255,/);
});

test('flare visual is a seek-safe CSS radial gradient whose position changes over time', () => {
  const atStart = flareVisual(0, 42);
  assert.match(atStart, /^radial-gradient\(circle at /);
  assert.notEqual(flareVisual(1, 42), atStart);
  assert.equal(flareVisual(0, 42), atStart);
});
