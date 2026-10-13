import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { computeCutBoundaryCandidates } from '../lib/common/cut-boundaries.js';
import { validateTransitionBoundaryWrite } from '../lib/common/transition-boundary-write.js';
import { mergeTransitionDeclaration } from '../lib/common/transition-boundary-model.js';
import { clampTransitionHandleForWrite, planCachedTransitionHandle, planFetchedTransitionHandle,
  planNoUriTransitionHandle } from '../lib/common/transition-handle-plan.js';
import { updateItem } from '../lib/common/edit-v2-mutations.js';

const pair = (overrides = {}) => [
  { index: 0, itemId: 'a', track: 0, tlStart: 0, tlEnd: 5, ...overrides },
  { index: 1, itemId: 'b', track: 0, tlStart: 5, tlEnd: 10 }
];

test('all same-track neighbours are candidates with separate block reasons', () => {
  assert.deepEqual(computeCutBoundaryCandidates(pair(), 30, 2)[0].blocks, ['multi-track']);
  assert.deepEqual(computeCutBoundaryCandidates(pair({ trackOrderValid: false }))[0].blocks, ['track-order']);
  const gap = pair();
  gap[1].tlStart = 5.5;
  assert.deepEqual(computeCutBoundaryCandidates(gap)[0].blocks, ['gap']);
  assert.deepEqual(computeCutBoundaryCandidates(pair({ locked: true }))[0].blocks, ['locked']);
  gap[0].transitionOut = { type: 'dissolve', duration: 0.5 };
  assert.equal(computeCutBoundaryCandidates(gap)[0].transitionOut.type, 'dissolve');
  assert.deepEqual(computeCutBoundaryCandidates(gap)[0].ref, { earlierItemId: 'a', laterItemId: 'b' });
});

test('write validation refuses a locked or no-longer-adjacent item pair', () => {
  const ref = { earlierItemId: 'a', laterItemId: 'b' };
  assert.deepEqual(validateTransitionBoundaryWrite(ref, pair({ locked: true }), 30, 1).blocks, ['locked']);
  const moved = pair();
  moved.splice(1, 0, { index: 2, itemId: 'between', track: 0, tlStart: 5, tlEnd: 6 });
  moved[2].tlStart = 6;
  assert.deepEqual(validateTransitionBoundaryWrite(ref, moved, 30, 1).blocks, ['gap']);
});

test('unknown declaration fields survive both merge and edit-v2 mutation', () => {
  assert.deepEqual(mergeTransitionDeclaration({ type: 'fade', duration: 1, align: 'start' },
    { type: 'dissolve', duration: 0.5 }), { type: 'dissolve', duration: 0.5, align: 'start' });
  const fixture = JSON.parse(readFileSync(new URL('../../../../../packages/edit-store/test/fixtures/edit-v2.json', import.meta.url), 'utf8'));
  const clip = fixture.tracks.find(track => track.id === 'v-main').items[0];
  clip.source.transition_out = { type: 'fade', duration: 1, align: 'start' };
  const result = updateItem(fixture, { itemId: clip.id,
    patch: { source: { transition_out: { type: 'dissolve', duration: 0.5 } } } });
  assert.deepEqual(result.tracks.find(track => track.id === 'v-main').items[0].source.transition_out,
    { type: 'dissolve', duration: 0.5, align: 'start' });
});

test('saved duration keeps the prior unknown, unavailable, and missing-URI rules', () => {
  const earlier = { tlStart: 0, tlEnd: 5 };
  const later = { tlStart: 5, tlEnd: 10 };
  const outgoing = { in: 0, out: 5, speed: 1 };
  const incoming = { in: 0.5, out: 5.5, speed: 1 };
  const common = { earlier, later, outgoing, incoming, outgoingStill: false,
    incomingStill: false, declaredSeconds: 0.5 };
  const unknown = planCachedTransitionHandle({ ...common, videoUri: 'media.mp4' });
  assert.equal(clampTransitionHandleForWrite(unknown, 0.5).duration, 0.5);
  const unavailable = planFetchedTransitionHandle({ ...common, duration: 'unavailable' });
  assert.equal(clampTransitionHandleForWrite(unavailable, 0.5).duration, 0.5);
  const missingUri = planNoUriTransitionHandle({ ...common });
  assert.equal(clampTransitionHandleForWrite(missingUri, 0.5).duration, 0.5);
  const shortHead = planCachedTransitionHandle({ ...common, incoming: { ...incoming, in: 0.1 }, videoUri: 'media.mp4' });
  assert.equal(clampTransitionHandleForWrite(shortHead, 0.5).duration, 0.2);
});
