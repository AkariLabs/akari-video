import assert from 'node:assert/strict';
import test from 'node:test';
import { timelineGapAt } from '../lib/common/timeline-gap.js';
const a = { id: 'a', at: 0, duration: 90 }, b = { id: 'b', at: 210, duration: 90 };
const gap = { trackId: 'v', startFrames: 90, endFrames: 210, previousItemId: 'a', nextItemId: 'b' };
for (const [name, items, frame, fps, expected, lane = 'visual'] of [
  ['bounded gap', [a, b], 120, 30, gap],
  ['unsorted input', [b, a], 120, 30, gap],
  ['gap beginning is included', [a, b], 90, 30, gap],
  ['gap end is excluded', [a, b], 210, 30, undefined],
  ['before first', [{ ...a, at: 30 }, b], 0, 30, undefined],
  ['after last', [a, b], 301, 30, undefined],
  ['inside clip', [a, b], 40, 30, undefined],
  ['under half second', [a, { ...b, at: 104 }], 95, 30, undefined],
  ['exact half second', [a, { ...b, at: 105 }], 95, 30, { ...gap, endFrames: 105 }],
  ['fractional fps threshold', [a, { ...b, at: 105 }], 95.2, 29.97, { ...gap, endFrames: 105 }],
  ['overlap union', [a, { id: 'inner', at: 10, duration: 10 }, b], 120, 30, gap],
  ['touching clips', [a, { ...b, at: 90 }], 90, 30, undefined],
  ['noninteger items excluded', [{ ...a, duration: 90.5 }, b], 120, 30, undefined],
  ['empty track', [], 10, 30, undefined],
  ['audio track', [a, b], 120, 30, undefined, 'audio'],
  ['invalid fps', [a, b], 120, 0, undefined],
  ['invalid time', [a, b], NaN, 30, undefined]
]) test(`timeline gap: ${name}`, () => {
  const before = structuredClone(items);
  const result = timelineGapAt({ id: 'v', lane, items }, frame, fps);
  assert.deepEqual(result, expected); assert.deepEqual(items, before);
  if (result) assert.ok(Number.isInteger(result.startFrames) && Number.isInteger(result.endFrames));
});
test('other tracks do not occupy a visual gap', () => {
  const tracks = [{ id: 'v', lane: 'visual', items: [a, b] },
    { id: 'other', lane: 'visual', items: [{ id: 'cover', at: 0, duration: 400 }] }];
  assert.deepEqual(timelineGapAt(tracks[0], 120, 30), gap);
  assert.equal(timelineGapAt(tracks[1], 120, 30), undefined);
});
