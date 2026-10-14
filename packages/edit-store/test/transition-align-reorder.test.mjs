import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { computeCutTrackSegments } from '../lib/index.js';

const client = readFileSync(new URL('../../preview-server/src/frame-engine-client.ts', import.meta.url), 'utf8');
const functionText = client.slice(client.indexOf('function normalizedCuts('),
  client.indexOf('function resolvedEngineLayers('));
const { code } = transformSync(functionText, { loader: 'ts', format: 'esm' });
const normalizedCuts = vm.runInNewContext(`const resolvedItemAdjust = item => item; ${code}; normalizedCuts`);

test('frame-engine client reconstructs projected placements and total duration', () => {
  for (const [align, outgoingOut, incomingAt, incomingIn] of [
    ['before-cut', 6, 3, 1], ['center', 6.5, 3.5, 1.5], ['after-cut', 7, 4, 2]
  ]) {
    // B starts at C - head and ends at C - head + (6 - incomingIn) = 8.
    const cuts = normalizedCuts({ sources: [{ id: 'a' }], cuts: [
      { id: 'a', src: 'a', track: 0, at: 0, in: 2, out: outgoingOut,
        transition_out: { type: 'dissolve', duration: 1 } },
      { id: 'b', src: 'b', track: 0, at: incomingAt, in: incomingIn, out: 6 }
    ] });
    assert.equal('at' in cuts[1], false, align);
    const positioned = computeCutTrackSegments(cuts.map(cut => ({ ...cut, transitionOut: cut.transition_out })));
    assert.equal(positioned[1].at, incomingAt, align);
    assert.equal(positioned[1].end, 8, align);
  }
});
