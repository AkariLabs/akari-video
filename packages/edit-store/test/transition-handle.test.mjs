import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cutOverlapFrames,
  planTransitionHandleExtension,
  setV2TransitionOutWithHandleInSource,
} from '../lib/index.js';

const input = (overrides = {}) => ({
  declaredSeconds: 1,
  earlierEndSeconds: 2,
  laterStartSeconds: 2,
  maxExtendSeconds: 1,
  fps: 30,
  ...overrides,
});

test('overlap frames and handle plans share fps quantization for full / partial / none', () => {
  assert.equal(cutOverlapFrames({ tlEnd: 2 }, { tlStart: 2 }, 30), 0);
  assert.deepEqual(planTransitionHandleExtension(input()), {
    appliedSeconds: 1,
    effectiveSeconds: 1,
    appliedFrames: 30,
    outcome: 'full',
  });
  assert.deepEqual(planTransitionHandleExtension(input({ maxExtendSeconds: 0.5 })), {
    appliedSeconds: 0.5,
    effectiveSeconds: 0.5,
    appliedFrames: 15,
    outcome: 'partial',
  });
  assert.deepEqual(planTransitionHandleExtension(input({ maxExtendSeconds: 1 / 60 })), {
    appliedSeconds: 0,
    effectiveSeconds: 0,
    appliedFrames: 0,
    outcome: 'none',
  });
});

test('an existing partial overlap is preserved without silently extending it', () => {
  assert.deepEqual(planTransitionHandleExtension(input({ earlierEndSeconds: 2.4 })), {
    appliedSeconds: 0,
    effectiveSeconds: 0.4,
    appliedFrames: 0,
    outcome: 'already-overlapping',
  });
});

const formattedV2 = `{
  "version" : 2,
  "output": { "width": 1280, "height": 720, "fps": 30 },
  "sources": [{ "id": "still", "path": "frame.png" }],
  "tracks": [
    {
      "id": "visual-main", "lane": "visual",
      "items": [
        { "id": "outgoing", "at": 0, "duration": 60,
          "source": { "kind": "media", "src": "still", "in": 0, "out": 2,
            "transition_out": { "type": "fade-black", "duration": 0.25 } },
          "crop": { "x": 0, "y": 0, "w": 1, "h": 1 } },
        { "id": "incoming", "at": 60, "duration": 60,
          "source": { "kind": "media", "src": "still", "in": 2, "out": 4 } }
      ]
    }
  ],
  "thumbnail": { "keep": "bytes and key order" }
}
`;

test('v2 declaration + partial extension changes only transition_out, source.out, and duration bytes', () => {
  const result = setV2TransitionOutWithHandleInSource(formattedV2, {
    itemId: 'outgoing',
    transitionOut: { type: 'dissolve', duration: 1 },
    earlierEndSeconds: 2,
    laterStartSeconds: 2,
    maxExtendSeconds: 0.5,
    fps: 30,
  });
  const expected = formattedV2
    .replace('"duration": 60,\n          "source"', '"duration": 75,\n          "source"')
    .replace('"out": 2,\n            "transition_out"', '"out": 2.5,\n            "transition_out"')
    .replace('{ "type": "fade-black", "duration": 0.25 }', '{"type":"dissolve","duration":1}');
  assert.equal(result.source, expected);
  assert.equal(result.plan.outcome, 'partial');
  assert.equal(result.plan.effectiveSeconds, 0.5);
});

test('v2 full extension preserves implicit speed while extending output frames', () => {
  const source = formattedV2
    .replace('"out": 2,\n            "transition_out"', '"out": 4,\n            "transition_out"');
  const result = setV2TransitionOutWithHandleInSource(source, {
    itemId: 'outgoing',
    transitionOut: { type: 'dissolve', duration: 0.5 },
    earlierEndSeconds: 2,
    laterStartSeconds: 2,
    maxExtendSeconds: 0.5,
    fps: 30,
  });
  const written = JSON.parse(result.source).tracks[0].items[0];
  assert.equal(result.plan.outcome, 'full');
  assert.equal(written.duration, 75);
  assert.equal(written.source.out, 5, 'speed 2x means a 0.5s output extension consumes 1s of source');
  assert.equal((written.source.out - written.source.in) / (written.duration / 30), 2);
});

test('v2 no-handle case still writes the declaration and leaves out / duration untouched', () => {
  const result = setV2TransitionOutWithHandleInSource(formattedV2, {
    itemId: 'outgoing',
    transitionOut: { type: 'reveal-up', duration: 1 },
    earlierEndSeconds: 2,
    laterStartSeconds: 2,
    maxExtendSeconds: 0,
    fps: 30,
  });
  const written = JSON.parse(result.source).tracks[0].items[0];
  assert.equal(result.plan.outcome, 'none');
  assert.equal(written.duration, 60);
  assert.equal(written.source.out, 2);
  assert.deepEqual(written.source.transition_out, { type: 'reveal-up', duration: 1 });
});
