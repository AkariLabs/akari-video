import test from 'node:test';
import assert from 'node:assert/strict';

import { moveLayerInSource } from '../lib/edit-store.js';

function sourceWithLayers() {
  return `{
  "version": 0,
  "layers": [
    {
      "id": "single",
      "t": 1,
      "duration": 2,
      "keyframes": [
        { "t": 0.5000, "transform": { "x": 10 } }
      ]
    },
    {
      "id": "multiple",
      "t": 4,
      "duration": 3,
      "keyframes": [
        { "t": 0, "transform": { "x": 0 } },
        { "t": 1.25, "transform": { "x": 50 } },
        { "t": 3, "transform": { "x": 100 } }
      ]
    },
    {
      "id": "none",
      "t": 8,
      "duration": 1.5
    }
  ]
}
`;
}

test('moveLayerInSource は keyframes が 1 本・複数・0 本のレイヤーを移動できる', () => {
  let source = sourceWithLayers();
  const before = JSON.parse(source);
  const moves = [
    { id: 'single', t: 2.5, duration: 2.25 },
    { id: 'multiple', t: 6, duration: 3.5 },
    { id: 'none', t: 10, duration: 1.75 },
  ];

  for (const move of moves) {
    source = moveLayerInSource(source, move.id, move.t, move.duration);
  }

  const after = JSON.parse(source);
  for (const move of moves) {
    const layer = after.layers.find(candidate => candidate.id === move.id);
    assert.equal(layer.t, move.t);
    assert.equal(layer.duration, move.duration);
  }
  assert.deepEqual(after.layers[0].keyframes, before.layers[0].keyframes);
  assert.deepEqual(after.layers[1].keyframes, before.layers[1].keyframes);
  assert.equal('keyframes' in after.layers[2], false);
  assert.match(source, /\{ "t": 0\.5000, "transform": \{ "x": 10 \} \}/);
});

test('moveLayerInSource は移動量 0 なら入力をバイト単位で保持する', () => {
  const source = `{
  "version": 0,
  "layers": [{
    "keyframes": [{ "t": 0.000 }, { "t": 2.5000 }],
    "duration": 2.500,
    "t": 1.000,
    "id": "unchanged"
  }]
}
`;

  assert.equal(moveLayerInSource(source, 'unchanged', 1, 2.5), source);
});
