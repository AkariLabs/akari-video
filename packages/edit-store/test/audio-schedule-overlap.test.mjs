import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWebAudioSchedule, projectSpeechDeclarations } from '../lib/index.js';

const project = cuts => projectSpeechDeclarations(cuts, { fps: 30 });
const timing = speech => speech.map(item => [
  item.id, item.atSec, item.durationSec, item.inSec, item.outSec, item.speed, item.track,
]);

test('fully covered clips on V1/V2 or V2/V3 each supply the same source once', () => {
  for (const tracks of [[0, 1], [1, 0], [1, 2], [2, 1]]) {
    const cuts = tracks.map((track, index) => ({
      id: `clip-${index}`, src: 'shared', at: 1, in: 2, out: 6, track,
      gain_db: index === 0 ? -6 : -3,
    }));
    const before = JSON.stringify(cuts);
    const speech = project(cuts);
    assert.deepEqual(timing(speech), [
      ['clip-0-speech', 1, 4, 2, 6, 1, tracks[0]],
      ['clip-1-speech', 1, 4, 2, 6, 1, tracks[1]],
    ]);
    assert.deepEqual(speech.map(item => [item.src, item.gainDb]), [['shared', -6], ['shared', -3]]);
    const plan = buildWebAudioSchedule({ timelineDurationSec: 5, startAtSec: 2, audio: { speech } });
    assert.deepEqual(plan.warnings, []);
    assert.deepEqual(plan.items.map(item => [item.id, item.timelineStartSec, item.timelineEndSec, item.sourceOffsetSec]), [
      ['clip-0-speech', 2, 5, 3], ['clip-1-speech', 2, 5, 3],
    ]);
    assert.deepEqual(plan.items.map(item => item.gainDb), [-6, -3]);
    assert.equal(JSON.stringify(cuts), before);
  }
});

test('partial coverage leaves one continuous declaration across the hidden middle', () => {
  const speech = project([
    { id: 'back', src: 'shared', at: 0, in: 2, out: 18, speed: 2, track: 1 },
    { id: 'front', src: 'shared', at: 2, in: 1, out: 4, track: 0 },
  ]);
  assert.deepEqual(timing(speech), [
    ['back-speech', 0, 8, 2, 18, 2, 1],
    ['front-speech', 2, 3, 1, 4, 1, 0],
  ]);
  for (const startAtSec of [1, 3, 6]) {
    const plan = buildWebAudioSchedule({ timelineDurationSec: 8, startAtSec, audio: { speech } });
    const back = plan.items.find(item => item.id === 'back-speech');
    assert.equal(back.timelineStartSec, startAtSec);
    assert.equal(back.timelineEndSec, 8);
    assert.equal(back.sourceOffsetSec, 2 + startAtSec * 2);
    assert.equal(plan.items.length, startAtSec < 5 ? 2 : 1);
  }
});

test('three overlapping clips retain every full window and schedule concurrently', () => {
  const speech = project([
    { id: 'back', src: 'shared', at: 0, in: 0, out: 8, track: 2 },
    { id: 'middle', src: 'shared', at: 1, in: 2, out: 8, track: 1 },
    { id: 'front', src: 'shared', at: 2, in: 4, out: 8, track: 0 },
  ]);
  assert.deepEqual(timing(speech), [
    ['back-speech', 0, 8, 0, 8, 1, 2],
    ['middle-speech', 1, 6, 2, 8, 1, 1],
    ['front-speech', 2, 4, 4, 8, 1, 0],
  ]);
  const plan = buildWebAudioSchedule({ timelineDurationSec: 8, startAtSec: 3, audio: { speech } });
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.items.map(item => [item.timelineStartSec, item.timelineEndSec, item.sourceOffsetSec]), [
    [3, 8, 3], [3, 7, 4], [3, 6, 5],
  ]);
});

test('mute and audio:false suppress either covered or covering clips without affecting others', () => {
  const cuts = [0, 1, 2].map(track => ({ id: `c${track}`, src: 'shared', in: 0, out: 4, track }));
  const original = project(cuts);
  for (const suppressed of [0, 1, 2]) {
    for (const flag of [{ mute: true }, { audio: false }, { mute: true, audio: false }]) {
      const speech = project(cuts.map((cut, index) => index === suppressed ? { ...cut, ...flag } : cut));
      assert.deepEqual(speech, original.filter(item => item.id !== `c${suppressed}-speech`));
      const plan = buildWebAudioSchedule({ timelineDurationSec: 4, startAtSec: 1, audio: { speech } });
      assert.equal(plan.items.length, 2);
    }
  }
  assert.deepEqual(project(cuts.map(cut => ({ ...cut, mute: true }))), []);
});

test('a fully covered freeze retains pre/post speech and its track cursor', () => {
  const speech = project([
    { id: 'frozen', src: 'shared', in: 2, out: 10, speed: 2, track: 1,
      freeze: { at_sec: 1, duration_sec: 2 } },
    { id: 'front', src: 'shared', in: 0, out: 8, track: 0 },
    { id: 'tail', src: 'shared', in: 10, out: 12, track: 1 },
  ]);
  assert.deepEqual(timing(speech), [
    ['frozen-speech-pre', 0, 1, 2, 4, 2, 1],
    ['frozen-speech-post', 3, 3, 4, 10, 2, 1],
    ['front-speech', 0, 8, 0, 8, 1, 0],
    ['tail-speech', 6, 2, 10, 12, 1, 1],
  ]);
  const plan = buildWebAudioSchedule({ timelineDurationSec: 8, startAtSec: 2, audio: { speech } });
  assert.deepEqual(plan.items.map(item => [item.id, item.timelineStartSec]), [
    ['frozen-speech-post', 3], ['front-speech', 2], ['tail-speech', 6],
  ]);
});

test('covered transitions preserve single-track declaration bytes, including hidden handles', () => {
  for (const explicitAt of [false, true]) {
    for (const speed of [1, 2]) {
      const cuts = [
        { id: 'a', src: 'shared', in: 1, out: 1 + 4 * speed, speed,
          transition_out: { type: 'dissolve', duration: 0.5 }, ...(explicitAt ? { at: 0 } : {}) },
        { id: 'b', src: 'shared', in: 2, out: 2 + 4 * speed, speed, ...(explicitAt ? { at: 4 } : {}) },
      ];
      // These complete declarations capture the pre-fix single-track output.
      const expected = [
        { id: 'a-speech', src: 'shared', atSec: 0, durationSec: 4, inSec: 1, outSec: 1 + 4 * speed,
          speed, gainDb: 0, track: 0, materialDurationSec: 1 + 4 * speed,
          ...(!explicitAt ? { padAfterSec: 0.5, crossfadeOutSec: 0.5 } : {}) },
        { id: 'b-speech', src: 'shared', atSec: explicitAt ? 4.25 : 4, durationSec: explicitAt ? 3.75 : 3.5,
          inSec: 2 + (explicitAt ? 0.25 : 0.5) * speed, outSec: 2 + 4 * speed,
          speed, gainDb: 0, track: 0, materialDurationSec: 2 + 4 * speed,
          padBeforeSec: 0.5, crossfadeInSec: 0.5 },
      ];
      assert.equal(JSON.stringify(project(cuts)), JSON.stringify(expected));
      for (const cover of [{ at: 0, out: 8 }, { at: 3, out: 2 }]) {
        const speech = project([
          ...cuts.map(cut => ({ ...cut, track: 1 })),
          { id: 'cover', src: 'shared', in: 0, track: 0, ...cover },
        ]);
        assert.equal(speech.length, 3);
        assert.equal(JSON.stringify(speech.slice(0, 2)), JSON.stringify(expected.map(item => ({ ...item, track: 1 }))));
      }
    }
  }
});

test('invalid cuts do not poison implicit placement or renumber fallback ids', () => {
  const speech = project([
    { src: 'shared', in: 0, out: Number.NaN, track: 1 },
    { src: 'shared', in: 0, out: 2, track: 1 },
    { src: 'shared', in: 2, out: 4, track: 1 },
    { src: 'shared', in: 0, out: 4, track: 0 },
  ]);
  assert.deepEqual(timing(speech), [
    ['cut-1-speech', 0, 2, 0, 2, 1, 1],
    ['cut-2-speech', 2, 2, 2, 4, 1, 1],
    ['cut-3-speech', 0, 4, 0, 4, 1, 0],
  ]);
});
