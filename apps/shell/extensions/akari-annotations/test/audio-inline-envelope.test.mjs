import assert from 'node:assert/strict';
import test from 'node:test';
import { audioFadeProgress } from '@akari-video/edit-store';
import {
  AUDIO_FADE_SHAPE_UNAVAILABLE, canPersistAudioFadeShape,
  inlineAddPoint, inlineAudioExpanded, inlineFadeCurve, inlineFadeSeconds,
  inlineGainFromDrag, inlineGainY, inlineMovePoint, inlinePointGainAt, inlineRemovePoints,
  inlineRoundedDb, inlineTimeFrame,
  patchInlineAudioItem, patchInlineAudioItemForWrite, INLINE_FADE_HANDLE_TOP_PX
} from '../lib/common/audio-inline-envelope.js';

test('fade handle and gain line coordinates', () => {
  assert.equal(inlineFadeSeconds(80, 400, 4, 'in', 30), 0.8);
  assert.equal(inlineFadeSeconds(320, 400, 4, 'out', 30), 0.8);
  assert.equal(inlineFadeSeconds(400, 400, 4, 'in', 30), 2);
  assert.equal(inlineFadeSeconds(38, 120, 4, 'in', 30), 1.266667);
  assert.equal(inlineFadeSeconds(100, 100, 1.05, 'in', 30), 0.5);
  assert.ok(inlineGainFromDrag(0, -20, 72, false) < 12);
  assert.ok(inlineGainFromDrag(0, -1, 72, false) <= 0.5);
  assert.ok(inlineGainFromDrag(0, -1, 72, false) > 0);
  assert.ok(inlineGainFromDrag(0, -10, 72, true) < inlineGainFromDrag(0, -10, 72, false) / 5);
  assert.ok(inlineGainY(12, 72) < inlineGainY(-60, 72));
  assert.equal(inlineTimeFrame(50, 100, 2, 30), 30);
  assert.equal(inlineRoundedDb(9.600000000000001), 9.6);
  assert.equal(inlineRoundedDb(-28.700000000000003), -28.7);
  assert.equal(inlineRoundedDb(0.8500000000000001, true), 0.85);
});

test('64px gate and first point obey existing two-point guard', () => {
  assert.equal(inlineAudioExpanded(63), false);
  assert.equal(inlineAudioExpanded(64), true);
  assert.equal(inlineAudioExpanded(72), true);
  assert.equal(inlineAudioExpanded(Math.round(28 * 1)), false);
  assert.equal(inlineAudioExpanded(Math.round(28 * 2.3)), true);
  assert.deepEqual(inlineAddPoint([], 15, 60, 0).map(point => point.t), [0, 15]);
  assert.equal(inlineAddPoint([{ t: 0, gain_db: 0 }, { t: 15, gain_db: 0 }], 15, 60, 0).length, 2);
});

test('point move clamps to adjacent integer frames and gain range', () => {
  const points = [{ t: 0, gain_db: 0 }, { t: 15, gain_db: 0 }, { t: 30, gain_db: 0 }];
  assert.deepEqual(inlineMovePoint(points, 1, 100, 99, 30)[1], { t: 29, gain_db: 12 });
  assert.deepEqual(inlineMovePoint(points, 1, -9, -100, 30)[1], { t: 1, gain_db: -60 });
  assert.equal(points[1].t, 15);
  assert.equal(inlineMovePoint(points, 1, 16, -28.700000000000003, 30)[1].gain_db, -28.7);
  assert.equal(inlineMovePoint(points, 1, 16, 0.8500000000000001, 30, true)[1].gain_db, 0.85);
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

test('shape patch is pure; real reader accepts it and injected rejection prevents writes', () => {
  const doc = {
    version: 2, output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: 'music', path: 'music.wav' }],
    tracks: [{ id: 'audio', lane: 'audio', items: [{
      id: 'a', at: 0, duration: 30, source: { kind: 'media', src: 'music', in: 0, out: 1 }, fade_in: 0
    }] }]
  };
  const originalItem = structuredClone(doc.tracks[0].items[0]);
  const patch = patchInlineAudioItem(doc, 'a', { fade_in_shape: 'slow' });
  assert.equal(patch.tracks[0].items[0].fade_in_shape, 'slow');
  assert.deepEqual(doc.tracks[0].items[0], originalItem);
  assert.equal(canPersistAudioFadeShape(patch), true);
  assert.equal(patchInlineAudioItemForWrite(doc, 'a', { fade_in_shape: 'slow' })
    .tracks[0].items[0].fade_in_shape, 'slow');
  assert.equal(canPersistAudioFadeShape(patch, () => { throw new Error('reader rejected'); }), false);
  assert.throws(() => patchInlineAudioItemForWrite(doc, 'a', { fade_in_shape: 'slow' },
    () => { throw new Error('reader rejected'); }),
    error => error.message === AUDIO_FADE_SHAPE_UNAVAILABLE);
});

test('zero-fade dot stays above the badge text while keeping a 20px hit target', () => {
  const hitHeight = 20, dotHeight = 10, badgeTextTop = 6;
  const dotBottom = INLINE_FADE_HANDLE_TOP_PX + (hitHeight + dotHeight) / 2;
  assert.ok(dotBottom < badgeTextTop);
});
