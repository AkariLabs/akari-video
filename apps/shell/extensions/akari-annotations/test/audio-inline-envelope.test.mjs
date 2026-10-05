import assert from 'node:assert/strict';
import test from 'node:test';
import { audioFadeProgress } from '@akari-video/edit-store';
import {
  AUDIO_FADE_SHAPE_UNAVAILABLE, canPersistAudioFadeShape,
  inlineAddPoint, inlineAudioExpanded, inlineFadeCurve, inlineFadeSeconds,
  inlineGainFromDrag, inlineGainY, inlineMovePoint, inlinePointGainAt, inlineRemovePoints, inlineTimeFrame,
  patchInlineAudioItem, patchInlineAudioItemForWrite, INLINE_FADE_HANDLE_TOP_PX
} from '../lib/common/audio-inline-envelope.js';

test('fade handle and gain line coordinates', () => {
  assert.equal(inlineFadeSeconds(80, 400, 4, 'in', 30), 0.8);
  assert.equal(inlineFadeSeconds(320, 400, 4, 'out', 30), 0.8);
  assert.equal(inlineFadeSeconds(400, 400, 4, 'in', 30), 2);
  assert.ok(inlineGainFromDrag(0, -20, 72, false) < 12);
  assert.ok(inlineGainFromDrag(0, -1, 72, false) <= 0.5);
  assert.ok(inlineGainFromDrag(0, -1, 72, false) > 0);
  assert.ok(inlineGainFromDrag(0, -10, 72, true) < inlineGainFromDrag(0, -10, 72, false) / 5);
  assert.ok(inlineGainY(12, 72) < inlineGainY(-60, 72));
  assert.equal(inlineTimeFrame(50, 100, 2, 30), 30);
});

test('64px gate and first point obey existing two-point guard', () => {
  assert.equal(inlineAudioExpanded(63), false);
  assert.equal(inlineAudioExpanded(64), true);
  assert.equal(inlineAudioExpanded(72), true);
  assert.deepEqual(inlineAddPoint([], 15, 60, 0).map(point => point.t), [0, 15]);
  assert.equal(inlineAddPoint([{ t: 0, gain_db: 0 }, { t: 15, gain_db: 0 }], 15, 60, 0).length, 2);
});

test('point move clamps to adjacent integer frames and gain range', () => {
  const points = [{ t: 0, gain_db: 0 }, { t: 15, gain_db: 0 }, { t: 30, gain_db: 0 }];
  assert.deepEqual(inlineMovePoint(points, 1, 100, 99, 30)[1], { t: 29, gain_db: 12 });
  assert.deepEqual(inlineMovePoint(points, 1, -9, -100, 30)[1], { t: 1, gain_db: -60 });
  assert.equal(points[1].t, 15);
  assert.deepEqual(inlineRemovePoints(points, [15]).map(point => point.t), [0, 30]);
  assert.deepEqual(inlineRemovePoints(points.slice(0, 2), [15]), []);
});

test('gain line evaluates the declared keyframe easing', () => {
  const points = [{ t: 0, gain_db: 0 }, { t: 30, gain_db: -12, easing: 'hold' }];
  assert.equal(inlinePointGainAt(points, 15), 0);
  assert.equal(inlinePointGainAt(points, 30), -12);
  assert.equal(inlinePointGainAt(points, 31), -12);
});

test('fade curve geometry follows named shapes', () => {
  assert.ok(Math.abs(inlineFadeCurve('slow', 'in')[8] - 0.25) < 1e-12);
  assert.ok(Math.abs(inlineFadeCurve('equal_power', 'out')[8] - Math.SQRT1_2) < 1e-12);
  assert.equal(inlineFadeCurve('slow', 'in')[8], audioFadeProgress('slow', 0.5));
});

test('shape patch is pure; preflight rejects current reader and accepts a future reader', () => {
  const doc = { tracks: [{ items: [{ id: 'a', fade_in: 0 }] }] };
  const patch = patchInlineAudioItem(doc, 'a', { fade_in_shape: 'slow' });
  assert.equal(patch.tracks[0].items[0].fade_in_shape, 'slow');
  assert.deepEqual(doc.tracks[0].items[0], { id: 'a', fade_in: 0 });
  assert.equal(canPersistAudioFadeShape(patch), false);
  assert.throws(() => patchInlineAudioItemForWrite(doc, 'a', { fade_in_shape: 'slow' }),
    error => error.message === AUDIO_FADE_SHAPE_UNAVAILABLE);
  const accepted = patchInlineAudioItemForWrite(doc, 'a', { fade_in_shape: 'slow' }, () => true);
  assert.equal(accepted.tracks[0].items[0].fade_in_shape, 'slow');
  assert.equal(canPersistAudioFadeShape(accepted, () => true), true);
});

test('zero-fade dot stays above the badge text while keeping a 20px hit target', () => {
  const hitHeight = 20, dotHeight = 10, badgeTextTop = 6;
  const dotBottom = INLINE_FADE_HANDLE_TOP_PX + (hitHeight + dotHeight) / 2;
  assert.ok(dotBottom < badgeTextTop);
});
