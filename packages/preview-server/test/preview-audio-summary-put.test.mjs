import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PREVIEW_AUDIO_SUMMARY_DERIVED_FIELDS,
  prepareFrameEngineAudioSummary,
} from '../src/preview-audio-summary.mjs';
import { applyPreviewProjection, migratePreviewCompatibility } from '../src/preview-edit.mjs';

const declarations = {
  output: { width: 320, height: 180, fps: 30 },
  sources: [{ id: 'main', path: 'main.mp4', proxy: null }], cuts: [], overlays: [], layers: [],
  audio: {
    bgm: { path: 'bed.wav', lowcut_hz: 100 },
    sfx: [{ id: 'hit', path: 'hit.wav', t: 0, out: 2, lowcut_hz: 100 }],
    narration: [{ id: 'voice', path: 'voice.wav', t: 0, out: 2, lowcut_hz: 100,
      provenance: { provider: 'unknown' } }],
    speech: [{ id: 'speech', role: 'speech', path: 'speech.wav', t: 0, out: 2, lowcut_hz: 100 }],
  },
};

for (const state of ['ready', 'unavailable']) {
  test(`summary ${state} audio survives preview PUT migration and still rejects unknown fields`, () => {
    const summary = prepareFrameEngineAudioSummary(declarations, {
      projectRoot: '.', cacheDir: '.cache', ffmpeg: 'fixture',
      requestSidecar: () => state === 'ready'
        ? { state, path: 'sidecar.wav', durationSec: 2, bytes: 8 }
        : { state, reason: 'fixture unavailable' },
    });
    const put = JSON.parse(JSON.stringify({ ...declarations, audio: summary.audio }));
    for (const kind of ['bgm', 'sfx', 'narration', 'speech']) {
      const original = kind === 'bgm' ? declarations.audio.bgm : declarations.audio[kind][0];
      const projected = kind === 'bgm' ? put.audio.bgm : put.audio[kind][0];
      const added = Object.keys(projected).filter(key => !Object.hasOwn(original, key));
      assert.ok(added.length > 0, `${kind} received summary fields`);
      assert.ok(added.every(key => PREVIEW_AUDIO_SUMMARY_DERIVED_FIELDS.includes(key)),
        `${kind} added only listed fields: ${added}`);
    }
    assert.doesNotThrow(() => migratePreviewCompatibility(put));
    const project = { edit: { find: () => null, walk: () => {}, tracks: [] } };
    assert.doesNotThrow(() => applyPreviewProjection(project, put, put));

    for (const [kind, key] of [['bgm', 'bogusKey'], ['narration', 'anotherBogusKey']]) {
      const invalid = structuredClone(put);
      const item = kind === 'bgm' ? invalid.audio.bgm : invalid.audio.narration[0];
      item[key] = true;
      assert.throws(() => migratePreviewCompatibility(invalid), new RegExp(key));
    }
  });
}
