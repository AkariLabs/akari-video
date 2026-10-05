import assert from 'node:assert/strict';
import test from 'node:test';
import { audioFadeProgress, audioFadeMultiplier, audioFadeGainEvents, audioFadeFfmpegCurve,
  projectAudioFadeShapes } from '../lib/envelope.js';

const curves = [
  ['linear', 'tri', 0.5],
  ['equal_power', 'qsin', Math.SQRT1_2],
  ['s_curve', 'hsin', 0.5],
  ['slow', 'qua', 0.25],
];

for (const [shape, ffmpeg, midpoint] of curves) {
  test(`${shape}: endpoints, monotonicity, mirrored fade and export curve`, () => {
    assert.equal(audioFadeProgress(shape, 0), 0);
    assert.equal(audioFadeProgress(shape, 1), 1);
    assert.ok(Math.abs(audioFadeProgress(shape, 0.5) - midpoint) < 1e-12);
    assert.equal(audioFadeFfmpegCurve(shape), ffmpeg);
    for (let index = 1; index <= 100; index++) {
      assert.ok(audioFadeProgress(shape, index / 100) >= audioFadeProgress(shape, (index - 1) / 100));
      assert.ok(Math.abs(audioFadeMultiplier(index / 100, 2, 1, 1, shape, shape)
        - audioFadeMultiplier(2 - index / 100, 2, 1, 1, shape, shape)) < 1e-12);
    }
    const events = audioFadeGainEvents(2, 1, 1, shape, shape);
    assert.ok(events.length >= 33);
    assert.ok(Math.abs(events.find(event => event.offsetSec === 0.5).value - midpoint) < 1e-12);
  });
}

test('omitted shape keeps linear progress', () => {
  assert.equal(audioFadeProgress(undefined, 0.37), 0.37);
  assert.equal(audioFadeFfmpegCurve(undefined), 'tri');
});

test('v2 shape overlay reaches projected audio without changing shape-less bytes', () => {
  const audio = { bgm: { id: 'bgm', fadeIn: 1 }, sfx: [{ id: 'hit', fade_in: 1 }] };
  const ordinary = [{ lane: 'audio', items: [{ id: 'music', role: 'bgm' }, { id: 'hit' }] }];
  assert.equal(projectAudioFadeShapes(audio, ordinary), audio);
  const shaped = [{ lane: 'audio', items: [
    { id: 'music', role: 'bgm', fade_in_shape: 'slow' },
    { id: 'hit', fade_out_shape: 'equal_power' }
  ] }];
  const next = projectAudioFadeShapes(audio, shaped);
  assert.equal(next.bgm.fade_in_shape, 'slow');
  assert.equal(next.sfx[0].fade_out_shape, 'equal_power');
  assert.equal(audio.bgm.fade_in_shape, undefined);
});
