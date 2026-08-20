import test from 'node:test';
import assert from 'node:assert/strict';

import { updateBgmInSource } from '../lib/edit-store.js';

test('updateBgmInSource は audio.bgm の全設定だけを構造で特定して更新する', () => {
  const source = `{
  "version": 1,
  "bgm": {
    "gain_db": -50,
    "fadeIn": 50,
    "fadeOut": 50,
    "ducking": false
  },
  "audio": {
    "bgm": {
      "path": "music/theme.wav",
      "gain_db": -6,
      "fadeIn": 1.25,
      "fadeOut": 2.5,
      "ducking": true,
      "metadata": { "gain_db": -30, "ducking": true }
    },
    "sfx": [
      { "path": "sfx/bgm-hit.wav", "t": 1, "gain_db": -3 }
    ]
  },
  "note": "bgm gain_db fadeIn fadeOut ducking"
}
`;
  const expected = source
    .replace('"gain_db": -6', '"gain_db": -12')
    .replace('"fadeIn": 1.25', '"fadeIn": 0.5')
    .replace('"fadeOut": 2.5', '"fadeOut": 4')
    .replace('"ducking": true,\n      "metadata"', '"ducking": false,\n      "metadata"');

  const updated = updateBgmInSource(source, {
    gainDb: -12,
    fadeIn: 0.5,
    fadeOut: 4,
    ducking: false,
  });

  assert.equal(updated, expected);
  assert.deepEqual(JSON.parse(updated).bgm, JSON.parse(source).bgm);
  assert.deepEqual(JSON.parse(updated).audio.sfx, JSON.parse(source).audio.sfx);
  assert.deepEqual(JSON.parse(updated).audio.bgm.metadata, JSON.parse(source).audio.bgm.metadata);
});
