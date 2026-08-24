import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampCaptionOutputRange,
  resolveSourceCaptionEdgeDrag,
} from '../lib/common/caption-output-domain.js';

const segments = [
  { src: 'a', in: 0, out: 2, speed: 1, tlStart: 0, tlEnd: 2 },
  { src: 'b', in: 0, out: 2, speed: 1, tlStart: 2, tlEnd: 4 },
];

test('source caption edge remains source-domain while released inside its own cut', () => {
  assert.deepEqual(resolveSourceCaptionEdgeDrag({
    edge: 'end', originalStart: 0.5, originalEnd: 1.5,
    originalOutputStart: 0.5, originalOutputEnd: 1.5,
    proposedOutputEdge: 1.75, src: 'a', segments,
  }), {
    start: 0.5, end: 1.75, outputStart: 0.5, outputEnd: 1.75,
    convertsToOutput: false,
  });
});

test('source caption edge crossing C1 becomes one continuous output-domain interval through C2', () => {
  assert.deepEqual(resolveSourceCaptionEdgeDrag({
    edge: 'end', originalStart: 0.5, originalEnd: 1.5,
    originalOutputStart: 0.5, originalOutputEnd: 1.5,
    proposedOutputEdge: 3.5, src: 'a', segments,
  }), {
    start: 0.5, end: 3.5, outputStart: 0.5, outputEnd: 3.5,
    convertsToOutput: true,
  });
});

test('source caption left edge crossing C2 becomes one continuous output-domain interval through C1', () => {
  assert.deepEqual(resolveSourceCaptionEdgeDrag({
    edge: 'start', originalStart: 0.5, originalEnd: 1.5,
    originalOutputStart: 2.5, originalOutputEnd: 3.5,
    proposedOutputEdge: 1, src: 'b', segments,
  }), {
    start: 1, end: 3.5, outputStart: 1, outputEnd: 3.5,
    convertsToOutput: true,
  });
});

test('output-domain range is clamped symmetrically to zero and the timeline end', () => {
  assert.deepEqual(clampCaptionOutputRange(-1, 7, 4), { start: 0, end: 4 });
  assert.deepEqual(clampCaptionOutputRange(3, 5, 4), { start: 3, end: 4 });
});

test('speed is applied only while the edge remains source-domain', () => {
  const sped = [{ src: 'a', in: 10, out: 14, speed: 2, tlStart: 0, tlEnd: 2 }];
  const result = resolveSourceCaptionEdgeDrag({
    edge: 'end', originalStart: 10, originalEnd: 12,
    originalOutputStart: 0, originalOutputEnd: 1,
    proposedOutputEdge: 1.5, src: 'a', segments: sped,
  });
  assert.equal(result.end, 13);
  assert.equal(result.convertsToOutput, false);
});
