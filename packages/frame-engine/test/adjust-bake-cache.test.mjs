import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { bakeItemAdjustLut, buildResolvedTimelinePlan } from '../dist/index.js';
import { bakeCases } from './adjust-bake-fixtures.mjs';

// SHA-256 of the Float32Array bytes from the unmodified baseline bake.ts (33-cube).
const baselineHashes = {
  basic: '568d2964b87968a5cf2b05eb5bc3feb035ee96e7b8143a2c4c4d0ab86dd36b4e',
  curve4: '6f08ab89d342a75a486c22278401d4ac12e6403963127ba292fa56c5fd5def61',
  curve7: '797d6d1422678cefbefc14395e7071d72bf8e35571b44dc25fee8bb91e06f58a',
  wheels: 'ccf1e2e74ce6d8552a652203ce47c795c25f6061cb305620384449c126404971',
  hue: 'd9edd88152535f60beabf910e685727c73ecc9012d9426b70bc18b48bc2376b5',
  frame2Bypass: '797d6d1422678cefbefc14395e7071d72bf8e35571b44dc25fee8bb91e06f58a',
  frame2All: 'c1734b6dfb6a5d02b91c9905d93159ff1c39abff7443971d3824c61a020da7d4',
  userLutHalf: '74176894b9754800b44c7eeec4b3eb9fc05493249c5430152246a653a857c345',
};

test('alternating adjustments reuse their two baked objects across 100 calls', () => {
  const first = { basic: { exposure: 0.125 } };
  const second = { basic: { contrast: 0.25 } };
  let references;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const pair = [bakeItemAdjustLut(first, undefined, 3), bakeItemAdjustLut(second, undefined, 3)];
    if (!references) references = pair;
    else {
      assert.strictEqual(pair[0], references[0]);
      assert.strictEqual(pair[1], references[1]);
    }
  }
  assert.notStrictEqual(references[0], references[1]);
});

test('baked LUT bytes match all baseline SHA-256 fixtures', () => {
  for (const [name, args] of Object.entries(bakeCases)) {
    const { data } = bakeItemAdjustLut(...args);
    const actual = createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
    assert.equal(actual, baselineHashes[name], name);
  }
});

test('timeline plan reuses both layer LUTs when only a transform changes', () => {
  const layers = [
    { src: 'first.mp4', t: 0, duration: 1, adjust: { basic: { exposure: 0.125 } } },
    { src: 'second.mp4', t: 0, duration: 1, adjust: { curves: bakeCases.curve4[0].curves } },
  ];
  let references;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const plan = buildResolvedTimelinePlan([], { layers: [
      { ...layers[0], transform: { x: iteration / 100, y: 0, scale: 1 } },
      layers[1],
    ] });
    assert.equal(plan.layerAdjustLuts.length, 2);
    if (!references) references = plan.layerAdjustLuts;
    else {
      assert.strictEqual(plan.layerAdjustLuts[0], references[0]);
      assert.strictEqual(plan.layerAdjustLuts[1], references[1]);
    }
  }
  assert.notStrictEqual(references[0], references[1]);
});
