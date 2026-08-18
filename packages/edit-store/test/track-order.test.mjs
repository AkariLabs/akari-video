import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveVisualTrackOrder, resolveVisualTrackZ } from '../lib/index.js';

test('visual track order is derived bottom-to-top with captions after overlays', () => {
  const tracks = deriveVisualTrackOrder({
    cuts: [{ track: 2 }, {}, { track: 1 }],
    layers: [{ track: 0 }],
    overlays: [{ track: 3 }, {}],
    hasCaptions: true,
    audio: { sfx: [{ track: 0 }] },
  });
  assert.deepEqual(tracks, [
    { kind: 'cuts', ref: 0 },
    { kind: 'cuts', ref: 1 },
    { kind: 'cuts', ref: 2 },
    { kind: 'layers', ref: 0 },
    { kind: 'overlays', ref: 0 },
    { kind: 'overlays', ref: 3 },
    { kind: 'captions' },
    { kind: 'audio', ref: 0 },
  ]);
});

test('the shared z resolver uses timeline.tracks array order as its only authority', () => {
  const tracks = [
    { kind: 'captions' },
    { kind: 'overlays', ref: 4 },
    { kind: 'cuts', ref: 0 },
    { kind: 'layers', ref: 2 },
  ];
  assert.equal(resolveVisualTrackZ(tracks, 'captions'), 0);
  assert.equal(resolveVisualTrackZ(tracks, 'overlays', 4), 1);
  assert.equal(resolveVisualTrackZ(tracks, 'cuts', 0), 2);
  assert.equal(resolveVisualTrackZ(tracks, 'layers', 2), 3);
  assert.equal(resolveVisualTrackZ(tracks, 'layers', 9), -1);
});
