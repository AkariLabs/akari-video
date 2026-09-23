import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWebAudioSchedule, projectLegacyAudioView, readInternalEdit } from '../lib/index.js';

function v2Edit({ provenance = false, bgmAt = 0, narration = true, mute = false, duckKeys, ducking = true } = {}) {
  return {
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'voice', path: 'voice.wav' }, { id: 'music', path: 'music.wav' }],
    ...(duckKeys === undefined ? {} : { audio: { duck_keys: duckKeys } }),
    tracks: [
      { id: 'a1', lane: 'audio', items: narration ? [{
        id: 'voice-item', role: 'narration', at: 5, duration: 173, mute,
        source: { kind: 'media', src: 'voice', in: 0, out: 173 / 30 },
        ...(provenance ? { provenance: { provider: 'human' } } : {}),
      }] : [] },
      { id: 'a2', lane: 'audio', items: [{
        id: 'music-item', role: 'bgm', at: bgmAt, duration: 786, gain_db: -6,
        ...(ducking === 'omit' ? {} : { ducking }),
        source: { kind: 'media', src: 'music', in: 0, out: 786 / 30 },
      }] },
    ],
  };
}

function scheduleFor(doc, startAtSec = 0) {
  const view = projectLegacyAudioView(readInternalEdit(doc));
  return buildWebAudioSchedule({
    timelineDurationSec: 60, startAtSec,
    audio: {
      ...view,
      duck_keys: doc.audio?.duck_keys,
      bgm: { ...view.bgm, durationSec: 60 },
      narration: view.narration.map(item => ({ ...item, durationSec: 60 })),
    },
  });
}

test('v2 narration with and without provenance gives the export duck interval in preview', () => {
  for (const provenance of [false, true]) {
    const schedule = scheduleFor(v2Edit({ provenance }));
    assert.deepEqual(schedule.duckIntervals, [{ startSec: 5 / 30, endSec: 178 / 30 }]);
    assert.ok(schedule.items.find(item => item.kind === 'bgm').envelopeEvents.length > 0);
    assert.equal(schedule.warnings.filter(warning => warning.includes('audio ducking target')).length, 0);
  }
});

test('v2 nonoverlap warns and keeps the duck key interval', () => {
  const schedule = scheduleFor(v2Edit({ bgmAt: 969 }));
  assert.deepEqual(schedule.duckIntervals, [{ startSec: 5 / 30, endSec: 178 / 30 }]);
  assert.match(schedule.warnings.join('\n'), /audio ducking target bgm \(duck_keys: \["narration","speech"\]\): duck key intervals do not overlap the clip/);
  assert.match(scheduleFor(v2Edit({ bgmAt: 969 }), 59).warnings.join('\n'),
    /audio ducking target bgm .*duck key intervals do not overlap the clip/);
});

test('v2 absent or muted narration warns for zero keys; explicit empty keys do not', () => {
  for (const doc of [
    v2Edit({ narration: false, duckKeys: ['narration'] }),
    v2Edit({ mute: true, duckKeys: ['narration'] }),
  ]) {
    const schedule = scheduleFor(doc);
    assert.deepEqual(schedule.duckIntervals, []);
    assert.match(schedule.warnings.join('\n'), /audio ducking target bgm \(duck_keys: \["narration"\]\): no duck key intervals are available/);
  }
  assert.equal(scheduleFor(v2Edit({ narration: false, duckKeys: [] })).warnings
    .filter(warning => warning.includes('audio ducking target')).length, 0);
});

test('v2 BGM ducking omission survives projection and warns only on overlap', () => {
  const warning = /audio bgm bgm overlaps duck key intervals \(duck_keys: \["narration","speech"\]\) but ducking is not enabled; set "ducking": true on the item to duck it under narration/;
  for (const ducking of ['omit', false, true]) {
    const view = projectLegacyAudioView(readInternalEdit(v2Edit({ ducking })));
    assert.equal(view.bgm.ducking, ducking === 'omit' ? undefined : ducking);
    const schedule = scheduleFor(v2Edit({ ducking }));
    if (ducking === 'omit') assert.match(schedule.warnings.join('\n'), warning);
    else assert.doesNotMatch(schedule.warnings.join('\n'), warning);
    const bgm = schedule.items.find(item => item.kind === 'bgm');
    assert.equal(bgm.envelopeEvents.length > 0, ducking === true);
  }
  assert.doesNotMatch(scheduleFor(v2Edit({ ducking: 'omit', bgmAt: 969 })).warnings.join('\n'), warning);
});
