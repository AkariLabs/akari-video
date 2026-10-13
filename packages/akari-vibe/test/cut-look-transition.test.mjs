import assert from 'node:assert/strict';
import test from 'node:test';

import transitionOp from '../src/ops-exec/cut_look_transition.mjs';
import duplicateOp from '../src/ops-exec/z_order_duplicate_copy.mjs';
import { applyDecision } from '../live/local-apply.mjs';

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

test('transition op changes position only when requested and clears center', () => {
  const env = environment('fade');
  env.edit.sources[0].path = 'still.png';
  env.edit.tracks[0].items[0].source.transition_out.fill = 'future-fill';
  env.edit.tracks[0].items[0].source.transition_out.extra = { keep: true };
  const run = align => transitionOp.apply(env, { op: 'cut_look_transition', target: 'item_first',
    transition_type: 'fade', align });
  run('after-cut');
  assert.equal(env.edit.tracks[0].items[0].source.transition_out.align, 'after-cut');
  run('center');
  assert.equal('align' in env.edit.tracks[0].items[0].source.transition_out, false);
  assert.equal(env.edit.tracks[0].items[0].source.transition_out.fill, 'future-fill');
  assert.deepEqual(env.edit.tracks[0].items[0].source.transition_out.extra, { keep: true });
  assert.deepEqual(JSON.parse(env.source), env.edit);
  run('future-side');
  assert.equal('align' in env.edit.tracks[0].items[0].source.transition_out, false);
  assert.match(env.log.join('\n'), /未適用/u);
});

test('new transition requests freeze before writing, then writes the full declaration', () => {
  const env = environment(null);
  env.edit.tracks[0].items[1].source.in = 0;
  env.source = JSON.stringify(env.edit);
  const before = structuredClone(env.edit);
  const request = { op: 'cut_look_transition', target: 'item_first', transition_type: 'fade',
    cutLookTransitionSeconds: 0.5 };
  const response = transitionOp.apply(env, request);
  assert.equal(response.applied, false);
  assert.equal(response.reason, 'needs-freeze');
  assert.match(env.log.at(-1), /allow_freeze.*true/u);
  assert.equal(response.declaredSeconds, 0.5);
  assert.ok(['center', 'before-cut', 'after-cut'].includes(response.align));
  assert.equal(response.freezeOutgoingUnknown, true);
  assert.ok(response.freezeOutgoingSeconds + response.freezeIncomingSeconds > 0);
  assert.ok(Array.isArray(response.neighborChanges));
  assert.deepEqual(env.edit, before);
  assert.equal(env.source, JSON.stringify(before));
  const applied = transitionOp.apply(env, { ...request, allow_freeze: true });
  assert.equal(applied, undefined);
  assert.deepEqual(env.edit.tracks[0].items[0].source.transition_out,
    { type: 'fade', duration: 0.5, ...(response.align === 'center' ? {} : { align: response.align }), fill: 'freeze' });
});

test('available incoming head needs no fill, and clip length alone does not reject a declaration', () => {
  const env = environment(null);
  const result = transitionOp.apply(env, { op: 'cut_look_transition', target: 'item_first',
    transition_type: 'fade', cutLookTransitionSeconds: 0.5 });
  assert.equal(result, undefined);
  assert.equal(env.edit.tracks[0].items[0].source.transition_out.fill, undefined);
  const short = environment(null);
  short.edit.tracks[0].items[0].duration = 6;
  short.edit.tracks[0].items[0].source.out = 0.2;
  short.edit.tracks[0].items[1].at = 6;
  short.edit.tracks[0].items[1].duration = 6;
  short.edit.tracks[0].items[1].source.in = 0;
  short.edit.tracks[0].items[1].source.out = 0.2;
  const limited = transitionOp.apply(short, { op: 'cut_look_transition', target: 'item_first',
    transition_type: 'fade', cutLookTransitionSeconds: 1, allow_freeze: true });
  assert.equal(limited, undefined);
  assert.equal(short.edit.tracks[0].items[0].source.transition_out.duration, 1);
  const still = environment(null);
  still.edit.sources[0].path = 'still.png';
  still.edit.tracks[0].items[1].source.in = 0;
  const onStill = transitionOp.apply(still, { op: 'cut_look_transition', target: 'item_first',
    transition_type: 'fade', cutLookTransitionSeconds: 0.5 });
  assert.equal(onStill, undefined);
  assert.equal(still.edit.tracks[0].items[0].source.transition_out.fill, undefined);
});

test('type-only replacement preserves fill and an explicit position requires permission', () => {
  const env = environment('fade');
  env.edit.tracks[0].items[0].source.transition_out.fill = 'freeze';
  const changed = transitionOp.apply(env, { op: 'cut_look_transition', target: 'item_first',
    transition_type: 'dissolve' });
  assert.equal(changed, undefined);
  assert.deepEqual(env.edit.tracks[0].items[0].source.transition_out,
    { type: 'dissolve', duration: 0.5, align: 'before-cut', fill: 'freeze' });
  transitionOp.apply(env, { op: 'cut_look_transition', target: 'item_first',
    transition_type: 'fade', cutLookTransitionSeconds: 0.5 });
  assert.deepEqual(env.edit.tracks[0].items[0].source.transition_out,
    { type: 'fade', duration: 0.5, align: 'before-cut', fill: 'freeze' });
  const before = structuredClone(env.edit);
  const requested = transitionOp.apply(env, { op: 'cut_look_transition', target: 'item_first',
    transition_type: 'dissolve', align: 'after-cut' });
  assert.equal(requested.reason, 'needs-freeze');
  assert.deepEqual(env.edit, before);
  const sourceBefore = env.source;
  transitionOp.apply(env, { op: 'cut_look_transition', target: 'item_first',
    transition_type: 'fade', allow_freeze: 'yes' });
  assert.match(env.log.at(-1), /未適用.*allow_freeze/u);
  for (const seconds of [0, Infinity, Number.NaN]) {
    transitionOp.apply(env, {
    op: 'cut_look_transition', target: 'item_first', transition_type: 'fade',
    cutLookTransitionSeconds: seconds
    });
    assert.match(env.log.at(-1), /未適用.*秒数/u);
  }
  assert.equal(env.source, sourceBefore);
});

test('type-only replacement records the transition write in the log', () => {
  const env = environment('fade');
  transitionOp.apply(env, { op: 'cut_look_transition', target: 'item_first',
    transition_type: 'dissolve' });
  assert.deepEqual(env.log, ['transition first → dissolve 0.5秒']);
});

test('local apply returns the executor result and keeps each target result in order', () => {
  const env = environment(null);
  env.edit.tracks[0].items[1].source.in = 0;
  env.source = JSON.stringify(env.edit);
  const input = { source: env.source, edit: env.edit, ctx: { playheadT: 0 },
    segments: [], context: { transcript: [] } };
  const decision = { op: 'cut_look_transition', target: 'item_first',
    transition_type: 'fade', cutLookTransitionSeconds: 0.5 };
  const single = applyDecision(input, decision);
  assert.equal(single.changed, false);
  assert.equal(single.opResult.reason, 'needs-freeze');
  assert.match(single.log.at(-1), /allow_freeze.*true/u);
  const multiple = applyDecision(input, { ...decision, targets: ['item_first', 'item_first'] });
  assert.deepEqual(multiple.opResult.map(result => result.reason), ['needs-freeze', 'needs-freeze']);
});

test('existing length change survives a material-only zero window', () => {
  const env = environment('fade');
  env.edit.tracks[0].items[1].source.in = 0;
  env.source = JSON.stringify(env.edit);
  const result = transitionOp.apply(env, { op: 'cut_look_transition', target: 'item_first',
    transition_type: 'fade', cutLookTransitionSeconds: 0.8 });
  assert.equal(result, undefined);
  assert.equal(env.edit.tracks[0].items[0].source.transition_out.duration, 0.8);
});

test('length change keeps the position and adds fill only when allowed', () => {
  const env = environment('fade');
  env.edit.tracks[0].items[1].source.in = 0.2;
  const request = { op: 'cut_look_transition', target: 'item_first', transition_type: 'fade',
    cutLookTransitionSeconds: 1 };
  assert.equal(transitionOp.apply(env, request), undefined);
  assert.deepEqual(env.edit.tracks[0].items[0].source.transition_out,
    { type: 'fade', duration: 1, align: 'before-cut' });
  assert.equal(transitionOp.apply(env, { ...request, allow_freeze: true }), undefined);
  assert.deepEqual(env.edit.tracks[0].items[0].source.transition_out,
    { type: 'fade', duration: 1, align: 'before-cut', fill: 'freeze' });
});

test('caption display policy conflict is returned only for an effective transition', () => {
  const env = environment(null);
  env.captionsSource = JSON.stringify({ display_policy: { mode: 'reference-pixel' }, captions: [] });
  const response = transitionOp.apply(env, { op: 'cut_look_transition', target: 'item_first',
    transition_type: 'fade', align: 'after-cut' });
  assert.equal(response.applied, false);
  assert.equal(response.captionDisplayPolicyConflict, true);
  const applied = transitionOp.apply(env, { op: 'cut_look_transition', target: 'item_first',
    transition_type: 'fade', align: 'after-cut', allow_freeze: true });
  assert.equal(applied.captionDisplayPolicyConflict, true);
  const dead = environment('fade');
  dead.edit.tracks[0].items[0].source.transition_out.duration = 0.01;
  dead.captionsSource = env.captionsSource;
  const changed = transitionOp.apply(dead, { op: 'cut_look_transition', target: 'item_first',
    transition_type: 'dissolve' });
  assert.equal(changed, undefined);
});

test('transition op rejects a newly written unknown type', () => {
  const env = environment(null);
  apply(env, 'future-kind');
  assert.equal(env.edit.tracks[0].items[0].source.transition_out, undefined);
  assert.match(env.log.join('\n'), /未適用/u);
});

test('duplicate op copies a clip with an existing unknown transition type', () => {
  const env = environment();
  env.edit.tracks[0].items[0].source.transition_out.x = { retained: true };
  duplicateOp.apply(env, { op: 'z_order_duplicate_copy', target: 'item_first' });
  const items = env.edit.tracks.flatMap(track => track.items);
  const copied = items.find(item => item.id === 'first-copy-1');
  assert.ok(copied);
  assert.deepEqual(copied.source.transition_out,
    { type: 'future-kind', duration: 0.5, align: 'before-cut', x: { retained: true } });
  assert.equal(env.selection, 'item:first-copy-1');
});
