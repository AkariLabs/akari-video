import test from 'node:test';
import assert from 'node:assert/strict';

import { moveCutAndPruneTracksInSource } from '../lib/edit-store.js';

test('moveCutAndPruneTracksInSource は移動と空 cuts トラック除去を一つの全文へ畳む', () => {
  const source = `${JSON.stringify({
    version: 0,
    cuts: [
      { in: 0, out: 1, at: 0, track: 0 },
      { in: 1, out: 2, at: 0, track: 1 },
    ],
    timeline: {
      tracks: [
        { id: 'cuts-0', kind: 'cuts', ref: 0 },
        { id: 'cuts-1', kind: 'cuts', ref: 1 },
      ],
    },
  }, null, 2)}\n`;

  const result = moveCutAndPruneTracksInSource(source, 0, 1, 1, undefined, ['cuts-0']);
  const value = JSON.parse(result.source);
  assert.equal(value.cuts[0].track, 1);
  assert.deepEqual(value.timeline.tracks.map(track => track.id), ['cuts-1']);
  assert.deepEqual(result.prunedTracks?.before.map(track => track.id), ['cuts-0', 'cuts-1']);
  assert.deepEqual(result.prunedTracks?.after.map(track => track.id), ['cuts-1']);
});

test('moveCutAndPruneTracksInSource は使用中または他種別の宣言を削除しない', () => {
  const source = JSON.stringify({
    version: 0,
    cuts: [
      { in: 0, out: 1, at: 0, track: 0 },
      { in: 1, out: 2, at: 1, track: 0 },
    ],
    timeline: {
      tracks: [
        { id: 'cuts-0', kind: 'cuts', ref: 0 },
        { id: 'layers-0', kind: 'layers', ref: 0 },
      ],
    },
  }, null, 2);

  const result = moveCutAndPruneTracksInSource(source, 0, 2, 1, undefined, ['cuts-0', 'layers-0']);
  assert.equal(result.prunedTracks, undefined);
  assert.deepEqual(JSON.parse(result.source).timeline.tracks.map(track => track.id), ['cuts-0', 'layers-0']);
});
