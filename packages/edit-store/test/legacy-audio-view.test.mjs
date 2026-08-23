import assert from 'node:assert/strict';
import test from 'node:test';

import { projectLegacyAudioView, readInternalEdit } from '../lib/index.js';
import { migrateEditToV2 } from '../lib/migrate/index.js';

const legacyFixture = version => ({
  version,
  output: { width: 1280, height: 720, fps: 30 },
  ...(version === 0
    ? { source: { path: 'main.mp4', proxy: null } }
    : { sources: [{ id: 'main', path: 'main.mp4', proxy: null }] }),
  cuts: [{ ...(version === 1 ? { src: 'main' } : {}), in: 0, out: 2 }],
  overlays: [],
  audio: {
    sfx: [{
      id: 'hit', t: 0.5, path: 'hit.wav', track: 0, gain_db: -6,
      in: 0.25, out: 0.75, fade_in: 0.1, fade_out: 0.2,
    }],
    narration: [{
      id: 'n-0001', t: 0.3, path: 'voice.wav', gain_db: -3,
      provenance: { provider: 'human' },
    }],
    bgm: {
      path: 'music.wav', in: 4, fadeIn: 1.25, fadeOut: 2.5,
      gain_db: -18, ducking: true,
    },
  },
});

const previewConsumerFields = audio => ({
  ...(audio.bgm ? {
    bgm: Object.fromEntries(['path', 'gain_db', 'ducking', 'fadeIn', 'fadeOut', 'in']
      .filter(key => audio.bgm[key] !== undefined).map(key => [key, audio.bgm[key]])),
  } : {}),
  sfx: audio.sfx.map(item => Object.fromEntries(
    ['path', 't', 'gain_db', 'track', 'in', 'out', 'fade_in', 'fade_out']
      .filter(key => item[key] !== undefined).map(key => [key, item[key]]),
  )),
  narration: audio.narration.map(item => Object.fromEntries(
    ['id', 'path', 't', 'gain_db']
      .filter(key => item[key] !== undefined).map(key => [key, item[key]]),
  )),
});

test('v0/v1 のプレビュー消費フィールドは tracks 射影への差し替え前後で同一', () => {
  for (const version of [0, 1]) {
    const legacy = legacyFixture(version);
    const migrated = migrateEditToV2(legacy);
    assert.equal(migrated.ok, true, migrated.blockers?.join('\n'));
    const projected = projectLegacyAudioView(readInternalEdit(migrated.doc));
    assert.deepEqual(previewConsumerFields(projected), previewConsumerFields(legacy.audio));
  }
});

test('トップレベル audio 併存形 v2 は bgm/sfx/narration を一度ずつ射影する', () => {
  const audio = legacyFixture(1).audio;
  const internal = readInternalEdit({
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [],
    tracks: [{ id: 'v1', lane: 'visual', items: [] }],
    audio,
  });
  const projected = projectLegacyAudioView(internal);
  assert.deepEqual(previewConsumerFields(projected), previewConsumerFields(audio));
  assert.equal(projected.bgm ? 1 : 0, 1);
  assert.equal(projected.sfx.length, 1);
  assert.equal(projected.narration.length, 1);
});

test('tracks-only v2 は bgm/sfx/narration と trim/fade/ducking/track を損失なく射影する', () => {
  const internal = readInternalEdit({
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [
      { id: 'hit', path: 'audio/hit.wav', proxy: null },
      { id: 'voice', path: 'audio/voice.wav', proxy: null },
      { id: 'music', path: 'audio/music.wav', proxy: null },
    ],
    tracks: [
      { id: 'a-sfx', lane: 'audio', items: [{
        id: 'hit-1', at: 45, duration: 15, gain_db: -6, fade_in: 0.1, fade_out: 0.2,
        source: { kind: 'media', src: 'hit', in: 0.25, out: 0.75 },
      }] },
      { id: 'a-narration', lane: 'audio', items: [{
        id: 'n-0001', at: 30, duration: 60, role: 'narration', gain_db: -3,
        source: { kind: 'media', src: 'voice', in: 0, out: 2 },
      }] },
      { id: 'a-bgm', lane: 'audio', items: [{
        id: 'music-item', at: 0, duration: 300, role: 'bgm', gain_db: -18,
        fade_in: 1.25, fade_out: 2.5, ducking: true,
        source: { kind: 'media', src: 'music', in: 4, out: 14 },
      }] },
    ],
  });

  assert.deepEqual(projectLegacyAudioView(internal), {
    bgm: {
      path: 'audio/music.wav', in: 4, fadeIn: 1.25, fadeOut: 2.5, gain_db: -18,
      ducking: true, id: 'bgm', track: 2, gainDb: -18,
    },
    sfx: [{
      id: 'hit-1', t: 1.5, duration: 0.5, path: 'audio/hit.wav', track: 0,
      in: 0.25, out: 0.75, gain_db: -6, fade_in: 0.1, fade_out: 0.2, gainDb: -6,
    }],
    narration: [{
      id: 'n-0001', t: 1, path: 'audio/voice.wav', gain_db: -3, track: 1, gainDb: -3,
    }],
  });
});

test('legacy.index 順・宣言とのマージ・snake_case 保持・gainDb 正規化が render 互換', () => {
  const item = (id, index, declaration, value) => ({
    id, atFrames: 0, durationFrames: 30, at: 0, duration: 1,
    source: { kind: 'media', sourceId: id, path: `${id}.wav`, in: 0, out: 1 },
    declaration,
    legacy: { collection: 'sfx', index, value },
  });
  const projected = projectLegacyAudioView({
    tracks: [{ items: [
      item('late', 1, { id: 'late', path: 'late-declared.wav', t: 2 }, { path: 'late.wav', gainDb: -4 }),
      item('early', 0, {
        id: 'early', path: 'early-declared.wav', t: 1, track: 7, in: 0.2, out: 0.8,
        gain_db: -99, fade_in: 0.05, fade_out: 0.1, ducking: false, loop: true,
      }, { path: 'early.wav', gainDb: -8 }),
    ] }],
  });

  assert.deepEqual(projected.sfx.map(entry => entry.id), ['early', 'late']);
  assert.deepEqual(projected.sfx[0], {
    id: 'early', path: 'early.wav', t: 1, track: 7, in: 0.2, out: 0.8,
    gain_db: -8, fade_in: 0.05, fade_out: 0.1, ducking: false, loop: true, gainDb: -8,
  });
});

test('tracks とトップレベル audio.bgm が同時に存在しても bgm は単数', () => {
  const internal = readInternalEdit({
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: 'music', path: 'track.wav', proxy: null }],
    tracks: [{ id: 'a1', lane: 'audio', items: [{
      id: 'track-bgm', at: 0, duration: 0, role: 'bgm',
      source: { kind: 'media', src: 'music', in: 0 },
    }] }],
    audio: { bgm: { path: 'fallback.wav', gain_db: -20 } },
  });
  const projected = projectLegacyAudioView(internal);
  assert.equal(projected.bgm ? 1 : 0, 1);
  assert.equal(projected.bgm.path, 'fallback.wav');
});
