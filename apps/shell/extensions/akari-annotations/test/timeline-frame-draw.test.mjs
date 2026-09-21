import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateFrameDraw } from '../lib/common/timeline-frame-draw.js';

for (const fps of [30, 24]) {
  const cases = [
    ['half-second grid', { start: 1.1, end: 3.4 }, [1, 2.5]],
    ['near edge beats grid', { start: 1.08, end: 3.38, candidates: [{ time: 1.125 }, { time: 3.375 }] }, [1.125, 2.25]],
    ['playhead beats grid', { start: 1, end: 3.34, candidates: [{ time: 3.375, isPlayhead: true }] }, [1, 2.375]],
    ['stop at right neighbor', { start: 1, end: 9, occupied: [{ at: 4 * fps, duration: fps }] }, [1, 3]],
    ['stop at left neighbor', { start: 5, end: 0, occupied: [{ at: fps, duration: fps }] }, [2, 3]],
    ['short raw drag', { start: 1.24, end: 1.73 }, null],
    ['short remaining gap', { start: 1, end: 3, occupied: [{ at: Math.floor(1.2 * fps), duration: fps }] }, null],
    ['click', { distancePx: 2 }, null],
    ['right to left', { start: 4.1, end: 1.8 }, [2, 2]],
    ['starts in clip', { start: 1.5, end: 5, occupied: [{ at: fps, duration: fps }] }, null],
    ['grid cannot move into left neighbor', { start: 1.22, end: 3, occupied: [{ at: 0, duration: Math.floor(1.2 * fps) }] }, [Math.floor(1.2 * fps) / fps, 3 - Math.floor(1.2 * fps) / fps]],
  ];
  for (const [name, overrides, expected] of cases) test(`${fps} fps: ${name}`, () => {
    const result = calculateFrameDraw({ start: 1, end: 3.3, fps, distancePx: 100,
      thresholdSeconds: .08, candidates: [], occupied: [], ...overrides });
    if (!expected) return assert.equal(result, null);
    const at = Math.round(expected[0] * fps);
    const end = Math.round((expected[0] + expected[1]) * fps);
    assert.deepEqual(result, { at, duration: end - at });
    assert.ok(Number.isInteger(result.at) && Number.isInteger(result.duration));
  });
}
