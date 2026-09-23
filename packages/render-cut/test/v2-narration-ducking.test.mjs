import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readRenderEdit } from '../src/internal-render.mjs';
import { buildAudioMixCommand } from '../src/plan.mjs';

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

function mixFor(doc) {
  const root = mkdtempSync(join(tmpdir(), 'v2-narration-ducking-'));
  const originalProbe = childProcess.spawnSync;
  childProcess.spawnSync = () => ({ status: 0, stdout: JSON.stringify({
    streams: [{ codec_type: 'audio' }], format: { duration: '60' },
  }) });
  syncBuiltinESMExports();
  try {
    writeFileSync(join(root, 'voice.wav'), 'probe fixture');
    const { edit } = readRenderEdit(doc, join(root, '.akari', 'render-tmp'), { projectRoot: root });
    assert.equal(edit.audio.bgm.ducking, doc.tracks[1].items[0].ducking);
    return buildAudioMixCommand({
      edit, projectRoot: root, inputPath: join(root, 'input.mp4'),
      outputPath: join(root, 'output.mp4'), workDirectory: root, duration: 60,
      ffmpegCommand: 'ffmpeg', ffprobeCommand: 'ffprobe',
    });
  } finally {
    childProcess.spawnSync = originalProbe;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
}

test('v2 narration with and without provenance counts the actual duck key and ducks BGM', () => {
  for (const provenance of [false, true]) {
    const mix = mixFor(v2Edit({ provenance }));
    assert.ok(mix.envelope.speech_intervals >= 1);
    assert.deepEqual(mix.envelope.ducked_items, ['bgm']);
    assert.equal(mix.warnings.filter(warning => warning.includes('audio ducking target')).length, 0);
  }
});

test('v2 nonoverlapping BGM reports its id and duck keys without claiming ducking', () => {
  const mix = mixFor(v2Edit({ bgmAt: 969 }));
  assert.deepEqual(mix.envelope.ducked_items, []);
  assert.ok(mix.envelope.speech_intervals >= 1);
  assert.match(mix.warnings.join('\n'), /audio ducking target bgm \(duck_keys: \["narration","speech"\]\): duck key intervals do not overlap the clip/);
});

test('v2 missing or muted narration warns for zero keys; explicit empty keys stay quiet', () => {
  for (const doc of [
    v2Edit({ narration: false, duckKeys: ['narration'] }),
    v2Edit({ mute: true, duckKeys: ['narration'] }),
  ]) {
    const mix = mixFor(doc);
    assert.equal(mix.envelope.speech_intervals, 0);
    assert.deepEqual(mix.envelope.ducked_items, []);
    assert.match(mix.warnings.join('\n'), /audio ducking target bgm \(duck_keys: \["narration"\]\): no duck key intervals are available/);
  }
  assert.equal(mixFor(v2Edit({ narration: false, duckKeys: [] })).warnings
    .filter(warning => warning.includes('audio ducking target')).length, 0);
});

test('v2 BGM without ducking warns only when its clip overlaps narration', () => {
  const warning = /audio bgm bgm overlaps duck key intervals \(duck_keys: \["narration","speech"\]\) but ducking is not enabled; set "ducking": true on the item to duck it under narration/;
  const overlapping = mixFor(v2Edit({ ducking: 'omit' }));
  assert.match(overlapping.warnings.join('\n'), warning);
  assert.deepEqual(overlapping.envelope.ducked_items, []);

  for (const doc of [v2Edit({ ducking: false }), v2Edit({ ducking: 'omit', bgmAt: 969 }), v2Edit({ ducking: true })]) {
    const mix = mixFor(doc);
    assert.doesNotMatch(mix.warnings.join('\n'), warning);
    assert.deepEqual(mix.envelope.ducked_items, doc.tracks[1].items[0].ducking === true ? ['bgm'] : []);
  }
});
