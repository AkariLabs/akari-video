import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LegacyEditVersionError,
  projectLegacyEdit,
  readInternalEdit,
  readInternalSources,
} from '../lib/index.js';

const base = () => ({
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  sources: [
    { id: 'main', path: 'main.mp4', proxy: null },
    { id: 'pip', path: 'pip.mp4', proxy: null },
  ],
  tracks: [
    { id: 'base', lane: 'visual', items: [
      { id: 'c1', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
    ] },
    { id: 'upper', lane: 'visual', items: [
      { id: 'l1', at: 15, duration: 30, source: { kind: 'media', src: 'pip', in: 0, out: 1 } },
    ] },
  ],
});
test('readInternalEdit accepts v2 and keeps integer frames authoritative', () => {
  const internal = readInternalEdit(base());
  assert.equal(internal.output.fps, 30);
  assert.equal(internal.tracks[0].items[0].atFrames, 0);
  assert.equal(internal.tracks[0].items[0].durationFrames, 60);
  assert.equal(internal.tracks[0].items[0].duration, 2);
});

test('readInternalEdit and readInternalSources reject legacy versions', () => {
  for (const version of [0, 1]) {
    assert.throws(() => readInternalEdit({ version }), LegacyEditVersionError);
    assert.throws(() => readInternalSources({ version }), LegacyEditVersionError);
  }
});

test('lowest visual media track projects to cuts and upper visual media projects to layers', () => {
  const view = projectLegacyEdit(readInternalEdit(base()));
  assert.equal(view.cuts.length, 1);
  assert.equal(view.cuts[0].src, 'main');
  assert.equal(view.layers.length, 1);
  assert.equal(view.layers[0].src, 'pip.mp4');
});

test('readInternalSources returns the v2 source table', () => {
  assert.deepEqual(readInternalSources(base()).map(({ id, path }) => ({ id, path })), [
    { id: 'main', path: 'main.mp4' },
    { id: 'pip', path: 'pip.mp4' },
  ]);
});

test('v2 audio.sfx keeps zero-based ids and a one-second provisional display duration', () => {
  const internal = readInternalEdit({
    ...base(),
    audio: {
      sfx: [
        { path: 'a.wav', t: 27 },
        { path: '', t: 28 },
        { path: 'c.wav', t: 49, in: 0.5, out: 2 },
      ],
    },
  });
  const sfx = internal.tracks
    .filter(track => track.lane === 'audio')
    .flatMap(track => track.items);
  assert.deepEqual(sfx.map(item => item.id), ['sfx-0', 'sfx-2']);
  assert.deepEqual(sfx.map(item => item.atFrames), [810, 1470]);
  assert.deepEqual(sfx.map(item => item.durationFrames), [30, 45]);
});
