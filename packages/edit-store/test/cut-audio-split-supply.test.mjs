import assert from 'node:assert/strict';
import test from 'node:test';
import { readInternalEdit, projectLegacyEdit, projectLegacyAudioView, projectSpeechDeclarations,
  isAudioItemAudible, buildWebAudioSchedule, projectSpeechKeyIntervals } from '../lib/index.js';
import { splitFixture, decodedAudio, baseline } from './helpers/cut-audio-supply.mjs';
import { captureUnsplitBaseline } from './helpers/cut-audio-baseline.mjs';

test('unsplit ownership projections and schedules match commit 6b40d920 byte for byte', () => {
  const actual = captureUnsplitBaseline();
  const expected = baseline();
  for (const key of ['legacy', 'audio', 'speech', 'schedule', 'keys']) {
    assert.equal(JSON.stringify(actual[key]), JSON.stringify(expected[key]), key);
  }
});

test('split fixture supplies embedded audio zero times and independently timed speech once', () => {
  const doc = splitFixture();
  doc.tracks[0].muted = true;
  doc.tracks[0].items[0].source.gain_db = 12;
  doc.tracks[1].items[0].at = 60;
  doc.tracks[1].items[0].duration = 30;
  doc.tracks[1].items[0].source.in = 1;
  const before = JSON.stringify(doc);
  const internal = readInternalEdit(doc);
  const cuts = projectLegacyEdit(internal).cuts;
  assert.equal(cuts[0].audio, false);
  assert.equal(cuts.length, 1);
  assert.deepEqual(projectSpeechDeclarations(cuts, { fps: 30 }), []);
  assert.deepEqual(projectSpeechKeyIntervals(cuts, [{ start: 0, end: 3 }], { fps: 30, sourceId: 'main' }).intervals, []);
  const view = projectLegacyAudioView(internal);
  assert.equal(view.speech.length, 1);
  assert.equal(view.speech[0].t, 2);
  assert.equal(view.speech[0].in, 1);
  assert.equal(view.speech[0].path, 'assets/main.mp4');
  const audio = decodedAudio(view);
  const plan = buildWebAudioSchedule({ timelineDurationSec: 5, startAtSec: 0, audio: { ...audio, duck_keys: ['speech'] } });
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].kind, 'narration');
  assert.equal(plan.items[0].gainDb, 0);
  assert.deepEqual(plan.duckIntervals, [{ startSec: 2, endSec: 3 }]);
  delete doc.tracks[1].items[0].link;
  assert.deepEqual(projectLegacyAudioView(readInternalEdit(doc)), view, 'link cannot affect supply');
  assert.equal(JSON.stringify({ ...doc, tracks: JSON.parse(before).tracks }), before);
});

test('every audio role retains item mute and combines it with its owning track using OR', () => {
  for (const role of ['speech', 'narration', 'sfx', 'bgm']) {
    for (const muted of [false, true]) for (const mute of [false, true]) {
      const doc = splitFixture();
      doc.tracks[1].muted = muted;
      Object.assign(doc.tracks[1].items[0], { role, mute });
      const internal = readInternalEdit(doc);
      const view = projectLegacyAudioView(internal);
      const items = role === 'bgm' ? (view.bgm ? [view.bgm] : []) : view[role] ?? [];
      assert.equal(items.length, muted ? 0 : 1, `${role}: track projection`);
      if (!muted) assert.equal(items[0].mute, mute, 'item mute is retained, not gain=-60');
      assert.equal(items.filter(item => isAudioItemAudible(doc.tracks[1], item)).length, muted || mute ? 0 : 1);
      const plan = buildWebAudioSchedule({ timelineDurationSec: 3, startAtSec: 0, audio: decodedAudio(view) });
      assert.equal(plan.items.length, muted || mute ? 0 : 1);
      if (role === 'speech') assert.equal(plan.duckIntervals.length, muted || mute ? 0 : 1);
    }
  }
});
