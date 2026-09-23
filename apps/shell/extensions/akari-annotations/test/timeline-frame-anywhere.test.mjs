import assert from 'node:assert/strict';
import test from 'node:test';
import { frameDrawDestination, nextFrameTrackNumber } from '../lib/common/timeline-frame-draw.js';
import { describeGenerationChip } from '../lib/common/generation-sidecar.js';

const layouts = [{ id: 'v1', top: 80, height: 40 }, { id: 'a1', top: 124, height: 40 }];
const tracks = [{ id: 'a1', lane: 'audio' }, { id: 'v1', lane: 'visual' }];
for (const [name, options, expected] of [
  ['visual row', { y: 100, layouts, tracks }, { lane: 'visual', trackId: 'v1' }],
  ['audio row', { y: 140, layouts, tracks }, { lane: 'audio', trackId: 'a1' }],
  ['above', { y: 40, layouts, tracks }, { lane: 'visual', insertIndex: 2 }],
  ['below', { y: 180, layouts, tracks }, { lane: 'audio', insertIndex: 0 }],
  ['below with no audio row', { y: 140, layouts: [layouts[0]], tracks: [tracks[1]] }, { lane: 'audio', insertIndex: 0 }],
  ['locked', { y: 140, layouts, tracks, isLocked: id => id === 'a1' }, null],
  ['between rows', { y: 122, layouts, tracks }, null],
]) test(`frame draw destination: ${name}`, () => {
  assert.deepEqual(frameDrawDestination(options), expected);
});

for (const [name, names, lane, expected] of [
  ['captions do not shift V2', ['A1', 'V1', 'T1', 'T2'], 'visual', 2],
  ['audio zero starts A1', ['V1', 'T1'], 'audio', 1],
  ['audio below A1 becomes A2', ['V1', 'A1'], 'audio', 2],
]) test(`provisional track number: ${name}`, () => {
  assert.equal(nextFrameTrackNumber(names, lane), expected);
});

test('planned audio generation chip uses the green empty-audio label', () => {
  assert.deepEqual(describeGenerationChip('planned', { version: 1, kind: 'audio', status: 'planned' }), {
    badge: '空の枠（音）', className: 'akari-generation-planned-audio', title: '音の空の枠'
  });
});
