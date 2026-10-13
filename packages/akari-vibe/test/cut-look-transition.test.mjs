import assert from 'node:assert/strict';
import test from 'node:test';

import transitionOp from '../src/ops-exec/cut_look_transition.mjs';

function environment(type = 'future-kind') {
  const edit = {
    version: 2,
    output: { width: 640, height: 360, fps: 30 },
    sources: [{ id: 'main', path: 'source.mp4' }],
    tracks: [{ id: 'visual', lane: 'visual', items: [
      { id: 'first', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2,
        ...(type ? { transition_out: { type, duration: 0.5, align: 'before-cut' } } : {}) } },
      { id: 'second', at: 60, duration: 60, source: { kind: 'media', src: 'main', in: 2, out: 4 } },
    ] }],
  };
  return { edit, source: JSON.stringify(edit), log: [], context: {}, playheadT: 0 };
}

function apply(env, type, seconds = 0.6) {
  transitionOp.apply(env, { op: 'cut_look_transition', target: 'item_first',
    transition_type: type, cutLookTransitionSeconds: seconds });
}

test('transition op preserves unknown fields when changing only duration or known type', () => {
  const env = environment();
  apply(env, 'future-kind');
  assert.deepEqual(env.edit.tracks[0].items[0].source.transition_out,
    { type: 'future-kind', duration: 0.6, align: 'before-cut' });
  apply(env, 'fade', 0.7);
  assert.deepEqual(env.edit.tracks[0].items[0].source.transition_out,
    { type: 'fade', duration: 0.7, align: 'before-cut' });
});

test('transition op rejects a newly written unknown type', () => {
  const env = environment(null);
  apply(env, 'future-kind');
  assert.equal(env.edit.tracks[0].items[0].source.transition_out, undefined);
  assert.match(env.log.join('\n'), /未適用/u);
});
