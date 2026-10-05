import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { readEditV2 } from '../lib/edit-v2.js';
import { serializeEdit } from '../lib/canonical.js';
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

const fixture = () => JSON.parse(readFileSync(new URL(
  '../../schemas/examples/edit-v2-cut-audio-split-valid/edit.json', import.meta.url
), 'utf8'));

test('all four v2 shapes survive reader and canonical round-trip; omitted shape keeps bytes', () => {
  const base = fixture();
  const original = serializeEdit(base);
  assert.doesNotThrow(() => readEditV2(base));
  assert.equal(serializeEdit(base), original);
  for (const shape of ['linear', 'equal_power', 's_curve', 'slow']) {
    const doc = fixture();
    const item = doc.tracks.find(track => track.lane === 'audio').items[0];
    item.fade_in_shape = shape;
    item.fade_out_shape = shape;
    const before = serializeEdit(doc);
    const read = readEditV2(before);
    const parsed = JSON.parse(before);
    const after = readEditV2(serializeEdit(parsed));
    const readItem = value => value.tracks.find(track => track.lane === 'audio').items[0];
    assert.equal(readItem(read).fade_in_shape, shape);
    assert.equal(readItem(after).fade_out_shape, shape);
    assert.equal(serializeEdit(parsed), before);
  }
});

test('v2 reader rejects unknown fade shapes at the exact field', () => {
  for (const field of ['fade_in_shape', 'fade_out_shape']) {
    const doc = fixture();
    doc.tracks.find(track => track.lane === 'audio').items[0][field] = 'exp';
    assert.throws(() => readEditV2(doc), new RegExp(`${field}.*linear/equal_power/s_curve/slow`));
  }
});
