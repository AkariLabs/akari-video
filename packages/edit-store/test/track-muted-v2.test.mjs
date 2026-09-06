import assert from 'node:assert/strict';
import test from 'node:test';

import { readEditV2 } from '../lib/edit-v2.js';
import { projectLegacyAudioView, projectLegacyEdit, readInternalEdit, serializeEdit } from '../lib/index.js';

function fixture(muted) {
  const flag = muted === undefined ? {} : { muted };
  return {
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4' }, { id: 'audio', path: 'audio.wav' }],
    tracks: [
      { id: 'visual', lane: 'visual', name: '映像', ...flag, items: [{
        id: 'cut', at: 0, duration: 60,
        source: { kind: 'media', src: 'main', in: 0, out: 2 },
      }] },
      { id: 'audio', lane: 'audio', name: '音声', ...flag, items:
        ['sfx', 'narration', 'bgm'].map(role => ({
          id: role, role, at: 0, duration: 60,
          source: { kind: 'media', src: 'audio', in: 0, out: 2 },
        })),
      },
      { id: 'captions', lane: 'visual', name: '字幕', ...flag, content: { from: 'captions.json' } },
    ],
  };
}

test('tracks[].muted accepts true and false for visual, audio, and content tracks', () => {
  for (const muted of [true, false]) {
    const edit = fixture(muted);
    assert.doesNotThrow(() => readEditV2(edit));
    assert.deepEqual(readEditV2(edit).tracks.map(track => track.muted), [muted, muted, muted]);
    assert.deepEqual(readInternalEdit(edit).tracks.map(track => track.muted), [muted, muted, muted]);
  }
});

test('tracks[].muted rejects non-booleans at the exact track field path', () => {
  for (const muted of ['yes', 1, null, [], {}, undefined]) {
    const edit = fixture();
    edit.tracks[0].muted = muted;
    assert.throws(() => readEditV2(edit), /edit\.json\.tracks\[0\]\.muted.*boolean である必要があります/u);
  }
});

test('tracks[].muted survives canonical v2 roundtrip in id lane name muted items order', () => {
  for (const muted of [true, false]) {
    const edit = fixture(muted);
    // reader が付ける派生 z は保存対象の v2 語彙から外す。
    const { tracks, ...rest } = readEditV2(edit);
    const text = serializeEdit({ ...rest, tracks: tracks.map(({ z, ...track }) => track) });
    const saved = JSON.parse(text);
    assert.deepEqual(Object.keys(saved.tracks[0]), ['id', 'lane', 'name', 'muted', 'items']);
    assert.deepEqual(Object.keys(saved.tracks[2]), ['id', 'lane', 'name', 'muted', 'content']);
    assert.deepEqual(readEditV2(text), readEditV2(edit));
    assert.equal(serializeEdit(saved), text);
  }
});

test('muted visual tracks override cut speech mute without changing timing or source declarations', () => {
  for (const mute of [undefined, false, true]) {
    const edit = fixture(true);
    const source = edit.tracks[0].items[0].source;
    if (mute !== undefined) source.mute = mute;
    const internal = readInternalEdit(edit);
    const before = structuredClone(internal.tracks[0].items[0]);
    const cut = projectLegacyEdit(internal).cuts[0];
    assert.equal(cut.mute, true);
    assert.equal(cut.in, 0);
    assert.equal(cut.out, 2);
    assert.equal(internal.tracks[0].items[0].duration, 2);
    assert.deepEqual(internal.tracks[0].items[0], before);
  }
});

test('muted audio tracks omit every role while an unmuted sibling remains projected', () => {
  const edit = fixture(true);
  edit.tracks.push({ id: 'audible', lane: 'audio', items: [{
    id: 'audible-sfx', at: 0, duration: 30,
    source: { kind: 'media', src: 'audio', in: 0, out: 1 },
  }] });
  const view = projectLegacyEdit(readInternalEdit(edit));
  assert.deepEqual(view.audioSfx.map(item => item.id), ['audible-sfx']);
  assert.deepEqual(view.audioNarration, []);
  assert.equal(view.audioBgm, undefined);
});

test('omitted and false track mute preserve audio roles and per-cut source mute', () => {
  for (const muted of [undefined, false]) {
    const edit = fixture(muted);
    const view = projectLegacyEdit(readInternalEdit(edit));
    assert.notEqual(view.cuts[0].mute, true);
    assert.equal(view.audioSfx.length, 1);
    assert.equal(view.audioNarration.length, 1);
    assert.ok(view.audioBgm);
    edit.tracks[0].items[0].source.mute = true;
    assert.equal(projectLegacyEdit(readInternalEdit(edit)).cuts[0].mute, true);
  }
});

test('muted visual tracks leave overlapping video layers unchanged', () => {
  const edit = fixture();
  edit.tracks[0].items.push({ ...structuredClone(edit.tracks[0].items[0]), id: 'overlap' });
  const original = projectLegacyEdit(readInternalEdit(edit));
  assert.equal(original.layers.length, 2);
  edit.tracks[0].muted = true;
  assert.deepEqual(projectLegacyEdit(readInternalEdit(edit)).layers, original.layers);
});

test('projectLegacyAudioView excludes muted audio tracks including nested roles and keeps unmuted siblings', () => {
  const edit = fixture(true);
  const internal = readInternalEdit(edit);
  assert.deepEqual(projectLegacyAudioView(internal), { sfx: [], narration: [] });
  // Audio groups are not v2 authoring vocabulary; descendants belong to the internal model.
  const audio = internal.tracks.find(track => track.id === 'audio');
  audio.items[0].children = structuredClone(audio.items);
  assert.deepEqual(projectLegacyAudioView(internal), { sfx: [], narration: [] });
  const sibling = fixture(false).tracks.find(track => track.id === 'audio');
  sibling.id = 'audible';
  sibling.items.forEach(item => { item.id = `audible-${item.id}`; });
  sibling.items.find(item => item.role === 'bgm').gain_db = -9;
  // A later muted BGM must not replace the audible sibling's declaration.
  edit.tracks.unshift(sibling);
  const view = projectLegacyAudioView(readInternalEdit(edit));
  assert.deepEqual(view.sfx.map(item => item.id), ['audible-sfx']);
  assert.deepEqual(view.narration.map(item => item.id), ['audible-narration']);
  assert.equal(view.bgm.gain_db, -9);
});

test('projectLegacyAudioView preserves every audio role for omitted and false mute', () => {
  const expected = projectLegacyAudioView(readInternalEdit(fixture()));
  assert.equal(expected.sfx.length, 1);
  assert.equal(expected.narration.length, 1);
  assert.ok(expected.bgm);
  for (const muted of [undefined, false]) {
    assert.deepEqual(projectLegacyAudioView(readInternalEdit(fixture(muted))), expected);
  }
});
