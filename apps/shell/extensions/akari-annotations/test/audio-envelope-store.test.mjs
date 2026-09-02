import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeAudioKeyframes,
  setAudioDuckInSource,
  setAudioKeyframesInSource
} from '../lib/common/audio-envelope-store.js';
import {
  updateAudioItemEnvelope,
  updateAudioSfxPreferV2
} from '../lib/common/edit-v2-mutations.js';

const source = `{
  "version": 0,
  "audio": {
    "bgm": { "path": "bed.mp3", "gain_db": -4 },
    "sfx": [
      { "path": "a.wav", "t": 1 },
      { "path": "b.wav", "t": 2, "ducking": true, "duck_db": -6 }
    ],
    "narration": [
      { "path": "vo.wav", "t": 0, "keyframes": [{ "t": 0, "gain_db": -2 }] }
    ]
  }
}
`;

test('bgm duck fields append with fixed defaults without reordering existing fields', () => {
  const updated = setAudioDuckInSource(source, { kind: 'bgm' }, {
    ducking: true, duckDb: -12, duckAttack: 0.05, duckRelease: 0.3
  });
  const bgm = JSON.parse(updated).audio.bgm;
  assert.deepEqual(bgm, {
    path: 'bed.mp3', gain_db: -4, ducking: true,
    duck_db: -12, duck_attack: 0.05, duck_release: 0.3
  });
  assert.ok(updated.indexOf('"gain_db"') < updated.indexOf('"ducking"'));
});

test('bgm duck field replaces only the requested value', () => {
  const initial = setAudioDuckInSource(source, { kind: 'bgm' }, { duckDb: -12, duckAttack: 0.05 });
  const updated = setAudioDuckInSource(initial, { kind: 'bgm' }, { duckDb: -3 });
  assert.equal(JSON.parse(updated).audio.bgm.duck_db, -3);
  assert.equal(JSON.parse(updated).audio.bgm.duck_attack, 0.05);
  assert.equal(updated.replace('-3', '-12'), initial);
});

test('bgm duck null removes fields and preserves sibling text', () => {
  const initial = setAudioDuckInSource(source, { kind: 'bgm' }, { duckDb: -12, duckRelease: 0.3 });
  const updated = setAudioDuckInSource(initial, { kind: 'bgm' }, { duckDb: null });
  assert.equal('duck_db' in JSON.parse(updated).audio.bgm, false);
  assert.equal(JSON.parse(updated).audio.bgm.duck_release, 0.3);
  assert.match(updated, /"path": "bed\.mp3", "gain_db": -4/u);
});

test('sfx duck append targets one array element only', () => {
  const updated = setAudioDuckInSource(source, { kind: 'sfx', index: 0 }, {
    ducking: true, duckDb: -12
  });
  const sfx = JSON.parse(updated).audio.sfx;
  assert.equal(sfx[0].ducking, true);
  assert.equal(sfx[0].duck_db, -12);
  assert.equal(sfx[1].duck_db, -6);
});

test('sfx duck replace and null removal are minimal', () => {
  const replaced = setAudioDuckInSource(source, { kind: 'sfx', index: 1 }, { duckDb: -9 });
  assert.equal(JSON.parse(replaced).audio.sfx[1].duck_db, -9);
  const removed = setAudioDuckInSource(replaced, { kind: 'sfx', index: 1 }, { ducking: null });
  assert.equal('ducking' in JSON.parse(removed).audio.sfx[1], false);
  assert.equal(JSON.parse(removed).audio.sfx[1].duck_db, -9);
});

test('bgm keyframes append in ascending t order', () => {
  const updated = setAudioKeyframesInSource(source, { kind: 'bgm' }, [
    { t: 3, gain_db: -6, easing: 'hold' }, { t: 1, gain_db: 0 }
  ]);
  assert.deepEqual(JSON.parse(updated).audio.bgm.keyframes.map(point => point.t), [1, 3]);
});

test('sfx keyframes replace as one array value in ascending order', () => {
  const appended = setAudioKeyframesInSource(source, { kind: 'sfx', index: 0 }, [
    { t: 2, gain_db: -8 }, { t: 0, gain_db: 0 }
  ]);
  const replaced = setAudioKeyframesInSource(appended, { kind: 'sfx', index: 0 }, [
    { t: 1.5, gain_db: -3 }, { t: 0.5, gain_db: 2 }
  ]);
  assert.deepEqual(JSON.parse(replaced).audio.sfx[0].keyframes, [
    { t: 0.5, gain_db: 2 }, { t: 1.5, gain_db: -3 }
  ]);
});

test('narration keyframes append and null removes the key', () => {
  const appended = setAudioKeyframesInSource(source, { kind: 'narration', index: 0 }, [
    { t: 2, gain_db: 0 }, { t: 1, gain_db: -4 }
  ]);
  assert.deepEqual(JSON.parse(appended).audio.narration[0].keyframes.map(point => point.t), [1, 2]);
  const removed = setAudioKeyframesInSource(appended, { kind: 'narration', index: 0 }, null);
  assert.equal('keyframes' in JSON.parse(removed).audio.narration[0], false);
});

test('empty keyframe arrays remove the key', () => {
  const updated = setAudioKeyframesInSource(source, { kind: 'narration', index: 0 }, []);
  assert.equal('keyframes' in JSON.parse(updated).audio.narration[0], false);
});

test('duck and gain contracts reject out-of-range values', () => {
  assert.throws(() => setAudioDuckInSource(source, { kind: 'bgm' }, { duckDb: -40.1 }), /-40〜0/u);
  assert.throws(() => setAudioDuckInSource(source, { kind: 'bgm' }, { duckAttack: 2.01 }), /0〜2/u);
  assert.throws(() => setAudioDuckInSource(source, { kind: 'bgm' }, { duckRelease: 5.01 }), /0〜5/u);
  assert.throws(() => normalizeAudioKeyframes([{ t: 0, gain_db: 12.1 }]), /-60〜12/u);
});

const v2 = {
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  tracks: [{ id: 'A1', lane: 'audio', items: [{
    id: 'bed', role: 'bgm', at: 0, duration: 300,
    source: { kind: 'media', path: 'bed.mp3', in: 0, out: 10 }
  }] }]
};

test('v2 item keyframe patch sorts integer frames and null deletes the key', () => {
  const updated = updateAudioItemEnvelope(v2, {
    itemId: 'bed', patch: { keyframes: [{ t: 60, gain_db: -6 }, { t: 0, gain_db: 0 }] }
  });
  assert.deepEqual(updated.tracks[0].items[0].keyframes.map(point => point.t), [0, 60]);
  const removed = updateAudioItemEnvelope(updated, { itemId: 'bed', patch: { keyframes: null } });
  assert.equal('keyframes' in removed.tracks[0].items[0], false);
  assert.throws(() => updateAudioItemEnvelope(v2, {
    itemId: 'bed', patch: { keyframes: [{ t: 0.5, gain_db: 0 }] }
  }), /整数フレーム/u);
});

test('v2 legacy audio.sfx patch carries duck and keyframe keys through the whitelist', () => {
  const doc = {
    version: 2, output: { width: 1920, height: 1080, fps: 30 }, tracks: [],
    audio: { sfx: [{ id: 'sfx-0', path: 'hit.wav', t: 0 }] }
  };
  const patch = {
    ducking: true, duck_db: -12, duck_attack: 0.05, duck_release: 0.3,
    keyframes: [{ t: 2, gain_db: -2 }, { t: 1, gain_db: 0 }]
  };
  const updated = updateAudioSfxPreferV2(doc, { sfxId: 'sfx-0', itemPatch: patch, legacyPatch: patch });
  assert.deepEqual(updated.audio.sfx[0].keyframes.map(point => point.t), [1, 2]);
  assert.deepEqual(
    Object.fromEntries(['ducking', 'duck_db', 'duck_attack', 'duck_release'].map(key => [key, updated.audio.sfx[0][key]])),
    { ducking: true, duck_db: -12, duck_attack: 0.05, duck_release: 0.3 }
  );
});
