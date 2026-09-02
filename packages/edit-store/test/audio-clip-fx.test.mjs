import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWebAudioSchedule, projectLegacyAudioView, readInternalEdit } from '../lib/index.js';
import { migrateEditToV2 } from '../lib/migrate/index.js';

function legacyEdit() {
  return {
    version: 1,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4', proxy: null }],
    cuts: [{ src: 'main', in: 0, out: 5 }], overlays: [],
    audio: {
      sfx: [{
        id: 'hit', t: 0, path: 'hit.wav', in: 1, out: 5,
        speed: 2, pitch_semitones: 7, formant: 'shift',
        denoise: { method: 'fft', strength: 0.6 }, lowcut_hz: 120,
      }],
      narration: [{
        id: 'n-0001', t: 0, path: 'voice.wav',
        denoise: { method: 'nlm', strength: 0.2 }, lowcut_hz: 80,
        provenance: { provider: 'human' },
      }],
      bgm: {
        path: 'music.wav', speed: 1.25, pitch_semitones: -3, formant: 'preserve',
        denoise: { method: 'fft', strength: 0.1 }, lowcut_hz: 40,
      },
    },
  };
}

test('legacy -> v2 places time/pitch fields on source and cleanup fields on item', () => {
  const result = migrateEditToV2(legacyEdit());
  assert.equal(result.ok, true, result.blockers?.join('\n'));
  const items = result.doc.tracks.flatMap(track => 'items' in track ? track.items : []);
  const sfx = items.find(item => item.id === 'hit');
  assert.deepEqual({
    speed: sfx.source.speed,
    pitch_semitones: sfx.source.pitch_semitones,
    formant: sfx.source.formant,
    denoise: sfx.denoise,
    lowcut_hz: sfx.lowcut_hz,
  }, {
    speed: 2, pitch_semitones: 7, formant: 'shift',
    denoise: { method: 'fft', strength: 0.6 }, lowcut_hz: 120,
  });
});

test('legacy speed 2 projects a four-second source window to a two-second v2 duration', () => {
  const result = migrateEditToV2(legacyEdit());
  assert.equal(result.ok, true, result.blockers?.join('\n'));
  const sfx = result.doc.tracks.flatMap(track => 'items' in track ? track.items : [])
    .find(item => item.id === 'hit');
  assert.equal(sfx.duration, 60);
});

test('v2 -> legacy projection preserves all clip FX declarations', () => {
  const migrated = migrateEditToV2(legacyEdit());
  assert.equal(migrated.ok, true, migrated.blockers?.join('\n'));
  const projected = projectLegacyAudioView(readInternalEdit(migrated.doc));
  for (const [actual, expected] of [
    [projected.sfx[0], legacyEdit().audio.sfx[0]],
    [projected.narration[0], legacyEdit().audio.narration[0]],
    [projected.bgm, legacyEdit().audio.bgm],
  ]) {
    for (const key of ['speed', 'pitch_semitones', 'formant', 'denoise', 'lowcut_hz']) {
      assert.deepEqual(actual[key], expected[key]);
    }
  }
});

test('source fallback keeps speed timing with a two-second effective window', () => {
  const schedule = buildWebAudioSchedule({
    timelineDurationSec: 10, startAtSec: 0,
    audio: { sfx: [{ id: 'hit', t: 0, durationSec: 4, speed: 2 }] },
  });
  assert.equal(schedule.items[0].durationSec, 2);
  assert.equal(schedule.items[0].playbackRate, 2);
  assert.equal(schedule.items[0].sourceDurationSec, 4);
});

test('baked clip FX sidecar schedules at playbackRate 1 and sidecar duration', () => {
  const schedule = buildWebAudioSchedule({
    timelineDurationSec: 10, startAtSec: 0,
    audio: { sfx: [{
      id: 'hit', t: 0, durationSec: 4, speed: 2,
      sidecar: { path: 'hit.flac', durationSec: 2, padBeforeSec: 0, padAfterSec: 0 },
    }] },
  });
  assert.equal(schedule.items[0].durationSec, 2);
  assert.equal(schedule.items[0].playbackRate, 1);
  assert.equal(schedule.items[0].sourceDurationSec, 2);
});
