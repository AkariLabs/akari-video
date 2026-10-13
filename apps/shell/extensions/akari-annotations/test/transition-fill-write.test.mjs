import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeTransitionDeclaration } from '../lib/common/transition-boundary-model.js';
import { transitionDeclarationPatch } from '../lib/common/transition-write-plan.js';
import { createTransitionSelection, transitionInspectorFields } from '../lib/common/transition-selection-model.js';
import { canFillTransition, compareTransitionConfirmation, decideTransitionWrite,
  confirmedTransitionPatch, refreshedTransitionConfirmation, transitionFillBodyKey } from '../lib/common/transition-fill-write.js';

const clips = (head = 0, tail = 0, length = 5) => [
  { id: 'a', startSeconds: 0, lengthSeconds: length, headRoomSeconds: 1, tailRoomSeconds: tail },
  { id: 'b', startSeconds: length, lengthSeconds: length, headRoomSeconds: head, tailRoomSeconds: 1 }
];
const decide = (items, existing, request) => decideTransitionWrite({ clips: items, earlierId: 'a',
  existing, request, fps: 30 });
const attach = { type: 'fade', duration: 0.5 };

test('attach asks for a new freeze and writes full declared duration and fill together', () => {
  const decision = decide(clips(0, 0), undefined, attach);
  assert.equal(decision.kind, 'attach');
  assert.ok(decision.confirmation);
  assert.equal(decision.patch.duration, 0.5);
  assert.equal(decision.patch.fill, 'freeze');
  assert.deepEqual(transitionDeclarationPatch(decision.patch), decision.patch);
  assert.equal(decide(clips(1, 1), undefined, attach).confirmation, undefined);
  const shifted = decide(clips(0.5, 0), undefined, attach);
  assert.equal(shifted.confirmation, undefined);
  assert.equal(shifted.patch.align, 'before-cut');
  const positioned = decide(clips(1, 1), undefined,
    { ...attach, align: 'after-cut' });
  assert.equal(positioned.patch.align, 'after-cut');
  assert.equal(positioned.confirmation, undefined);
  const short = clips(1, 1, 0.2);
  assert.equal(decide(short, undefined, attach).confirmation, undefined);
});

test('retyping preserves length, position, fill, and future fields', () => {
  for (const fill of [undefined, 'freeze']) {
    const existing = { type: 'fade', duration: 0.5, align: 'future-side',
      ...(fill ? { fill } : {}), extra: { keep: true } };
    const decision = decide(clips(), existing, { type: 'dissolve', duration: 0.5 });
    assert.equal(decision.kind, 'retype');
    assert.deepEqual(decision.patch, { type: 'dissolve', duration: 0.5 });
    assert.deepEqual(mergeTransitionDeclaration(existing, transitionDeclarationPatch(decision.patch)),
      { ...existing, type: 'dissolve' });
  }
});

test('changing length adds, removes, or preserves fill from the filled plan', () => {
  const existing = { type: 'fade', duration: 0.2, align: 'before-cut', extra: 7 };
  const added = decide(clips(0, 1), existing, { type: 'fade', duration: 0.5 });
  assert.equal(added.kind, 'change');
  assert.equal(added.patch.fill, 'freeze');
  assert.ok(added.incomingSeconds > 0);
  const removed = decide(clips(1, 1), { ...existing, fill: 'freeze' },
    { type: 'fade', duration: 0.1 });
  assert.equal(removed.patch.fill, null);
  assert.equal('fill' in mergeTransitionDeclaration({ ...existing, fill: 'freeze' },
    transitionDeclarationPatch(removed.patch)), false);
  const outgoing = decide(clips(1, 0), { ...existing, align: 'after-cut' },
    { type: 'fade', duration: 0.5 });
  assert.equal(outgoing.patch.fill, undefined);
  const unknownClips = clips(1, 0);
  unknownClips[0].tailRoomSeconds = undefined;
  const unknown = decide(unknownClips, { ...existing, align: 'after-cut', fill: 'freeze' },
    { type: 'fade', duration: 0.5 });
  assert.equal(unknown.patch.fill, undefined);
});

test('fill entry is governed by effective growth and boundary eligibility', () => {
  const existing = { type: 'future-kind', duration: 0.5, align: 'before-cut' };
  const items = clips(0, 1);
  assert.ok(canFillTransition({ clips: items, earlierId: 'a', existing, fps: 30 }));
  assert.equal(decide(items, existing, { ...attach, fillOnly: true }).kind, 'fill');
  for (const extra of [{ blocked: true }, { legacyOverlap: true }]) {
    assert.equal(canFillTransition({ clips: items, earlierId: 'a', existing, fps: 30, ...extra }), undefined);
  }
  assert.equal(canFillTransition({ clips: items, earlierId: 'a', existing: { ...existing, fill: 'freeze' },
    fps: 30 }), undefined);
  assert.equal(canFillTransition({ clips: clips(0, 1).map((clip, i) => i ? { ...clip, holdBlocked: true } : clip),
    earlierId: 'a', existing, fps: 30 }), undefined);
  assert.equal(canFillTransition({ clips: clips(1, 1, 0.2), earlierId: 'a', existing, fps: 30 }), undefined);
  const shared = [
    { id: 'a', startSeconds: 0, lengthSeconds: 5, headRoomSeconds: 1, tailRoomSeconds: 1 },
    { id: 'b', startSeconds: 5, lengthSeconds: 0.4, headRoomSeconds: 1, tailRoomSeconds: 1,
      transitionOut: { declaredSeconds: 0.5, align: 'center', fill: false } },
    { id: 'c', startSeconds: 5.4, lengthSeconds: 5, headRoomSeconds: 1, tailRoomSeconds: 1 },
  ];
  assert.equal(canFillTransition({ clips: shared, earlierId: 'a',
    existing: { ...existing, align: 'center' }, fps: 30 }), undefined);
});

test('confirmation rejects each increase and shorter effective length, accepts reductions', () => {
  const before = { align: 'center', declaredSeconds: 0.5, effectiveSeconds: 0.5,
    freezeIncomingSeconds: 0.2, freezeOutgoingSeconds: 0.3, freezeOutgoingUnknown: false };
  for (const change of [
    { freezeIncomingSeconds: 0.20001 }, { freezeOutgoingSeconds: 0.30001 },
    { effectiveSeconds: 0.49999 }, { align: 'after-cut' }, { declaredSeconds: 0.6 }
  ]) assert.equal(compareTransitionConfirmation(before, { ...before, ...change }), false);
  assert.equal(compareTransitionConfirmation(before, { ...before,
    freezeIncomingSeconds: 0.1, freezeOutgoingSeconds: 0.2 }), true);
  const unknown = { ...before, freezeOutgoingUnknown: true, freezeOutgoingSeconds: 0.25 };
  assert.equal(compareTransitionConfirmation(unknown, { ...unknown,
    freezeOutgoingUnknown: false, freezeOutgoingSeconds: 0.26 }), false);
  const refreshed = refreshedTransitionConfirmation(clips(0, 0), 'a', before, 30);
  assert.equal(refreshed.declaredSeconds, 0.5);
});

test('confirmation body chooses the five side and unknown variants', () => {
  const base = { align: 'center', declaredSeconds: 0.5, effectiveSeconds: 0.5,
    freezeIncomingSeconds: 0, freezeOutgoingSeconds: 0, freezeOutgoingUnknown: false };
  assert.equal(transitionFillBodyKey({ ...base, freezeIncomingSeconds: 0.2 }), 'transition.fill.ask.bodyIncoming');
  assert.equal(transitionFillBodyKey({ ...base, freezeOutgoingSeconds: 0.3 }), 'transition.fill.ask.bodyOutgoing');
  assert.equal(transitionFillBodyKey({ ...base, freezeOutgoingSeconds: 0.3,
    freezeOutgoingUnknown: true }), 'transition.fill.ask.bodyOutgoingUpTo');
  assert.equal(transitionFillBodyKey({ ...base, freezeIncomingSeconds: 0.2,
    freezeOutgoingSeconds: 0.3 }), 'transition.fill.ask.bodyBoth');
  assert.equal(transitionFillBodyKey({ ...base, freezeIncomingSeconds: 0.2,
    freezeOutgoingSeconds: 0.3, freezeOutgoingUnknown: true }), 'transition.fill.ask.bodyBothUpTo');
});

test('confirmed attach writes the confirmed position even if a new recommendation differs', () => {
  const before = { align: 'after-cut', declaredSeconds: 0.5, effectiveSeconds: 0.5,
    freezeIncomingSeconds: 0, freezeOutgoingSeconds: 0.3, freezeOutgoingUnknown: false };
  const decision = { kind: 'attach', patch: { type: 'fade', duration: 0.5, align: 'before-cut', fill: 'freeze' } };
  assert.deepEqual(confirmedTransitionPatch({ confirmed: before, decision, after: before, type: 'dissolve' }),
    { type: 'dissolve', duration: 0.5, align: 'after-cut', fill: 'freeze' });
  const clear = { ...before, freezeOutgoingSeconds: 0, freezeIncomingSeconds: 0 };
  assert.deepEqual(confirmedTransitionPatch({ confirmed: { ...before, align: 'center' }, decision,
    after: { ...clear, align: 'center' }, type: 'fade' }), { type: 'fade', duration: 0.5 });
  assert.equal(confirmedTransitionPatch({ confirmed: before, decision,
    after: { ...before, freezeOutgoingSeconds: 0.31 }, type: 'fade' }), undefined);
});

test('confirmed fill skips the write when refreshed shortages are both zero', () => {
  const before = { align: 'before-cut', declaredSeconds: 0.5, effectiveSeconds: 0.5,
    freezeIncomingSeconds: 0.3, freezeOutgoingSeconds: 0, freezeOutgoingUnknown: false };
  const decision = { kind: 'fill', patch: { type: 'fade', duration: 0.5, fill: 'freeze' } };
  assert.deepEqual(confirmedTransitionPatch({ confirmed: before, decision, after: before, type: 'fade' }),
    decision.patch);
  const clear = { ...before, freezeIncomingSeconds: 0 };
  assert.equal(confirmedTransitionPatch({ confirmed: before, decision, after: clear, type: 'fade' }), undefined);
});

test('unknown fill survives length and position changes until fill is explicitly requested', () => {
  const existing = { type: 'fade', duration: 0.2, align: 'before-cut', fill: 'future-fill' };
  for (const request of [{ type: 'fade', duration: 0.5 },
    { type: 'fade', duration: 0.2, align: 'after-cut' }]) {
    const result = decide(clips(0, 1), existing, request);
    assert.equal(result.patch.fill, undefined);
    assert.equal(result.incomingSeconds, undefined);
  }
  assert.equal(decide(clips(0, 1), existing, { ...attach, fillOnly: true }).patch.fill, 'freeze');
});

test('inspector shows fill and caption notice only for eligible effective boundaries', () => {
  const common = { ref: { earlierItemId: 'a', laterItemId: 'b' },
    earlier: { index: 1, name: 'A' }, later: { index: 2, name: 'B' },
    declaration: { type: 'fade', duration: 0.5 }, locked: false,
    placement: { state: 'ok', effectiveSeconds: 0.5, startOffsetSeconds: -0.25,
      endOffsetSeconds: 0.25, freezeOutgoingSeconds: 0,
      freezeIncomingSeconds: 0, freezeOutgoingUnknown: false,
      reasons: [], align: 'center', legacyOverlap: false } };
  const active = transitionInspectorFields(createTransitionSelection({ ...common,
    canFill: true, captionConflict: true }));
  assert.equal(active.canFill, true);
  assert.equal(active.captionConflict, true);
  const locked = transitionInspectorFields(createTransitionSelection({ ...common, locked: true,
    canFill: true, captionConflict: true }));
  assert.equal(locked.canFill, false);
});
