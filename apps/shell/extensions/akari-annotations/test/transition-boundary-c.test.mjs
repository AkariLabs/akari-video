import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { computeCutBoundaryCandidates } from '../lib/common/cut-boundaries.js';
import { resolveBoundaryInDocument, validateTransitionBoundaryWrite } from '../lib/common/transition-boundary-write.js';
import { mergeTransitionDeclaration, primaryBoundaryBlock } from '../lib/common/transition-boundary-model.js';
import { transitionWriteIsBlocked } from '../lib/common/transition-boundary-state.js';
import { clampTransitionHandleForWrite, planCachedTransitionHandle, planFetchedTransitionHandle,
  planNoUriTransitionHandle } from '../lib/common/transition-handle-plan.js';
import { updateItem } from '../lib/common/edit-v2-mutations.js';
import { completeTimelineRange } from '../lib/common/timeline-range.js';
import { timelineDeletePlan } from '../lib/common/timeline-delete-plan.js';

const pair = (overrides = {}) => [
  { index: 0, itemId: 'a', track: 0, tlStart: 0, tlEnd: 5, ...overrides },
  { index: 1, itemId: 'b', track: 0, tlStart: 5, tlEnd: 10 }
];

const widgetSource = ts.createSourceFile('widget.ts', readFileSync(
  new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const widget = widgetSource.statements.find(node => ts.isClassDeclaration(node)
  && node.name?.text === 'AkariAnnotationsWidget');
const widgetMethod = (name, dependencies = {}) => {
  const member = widget.members.find(node => node.name?.getText(widgetSource) === name);
  assert.ok(member, name);
  const code = ts.transpileModule(`class Handler { ${member.getText(widgetSource)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
  }).outputText;
  return new Function(...Object.keys(dependencies), `${code}\nreturn Handler.prototype.${name};`)(
    ...Object.values(dependencies));
};

test('selecting a boundary clears every deletion target without switching panels', () => {
  let panelSwitches = 0;
  let durationFetches = 0;
  const state = {
    selection: { kind: 'cut', index: 0 }, multiSelection: [{ kind: 'cut', index: 0 }],
    selectedGap: { startFrames: 3 }, gapBand: { remove() {} },
    timelineRange: { inFrame: 1, outFrame: 3 }, selectionModel: { keyframeSelection: { times: [1] } },
    setTimelineRange(value) { this.timelineRange = value; }, clearMarqueeRange() {},
    applySelectionClass() {}, publishPrimaryPreviewSelection() {}, pushSelectionSnapshot() {},
    transitionBoundaryCandidates: () => [{ ref: { earlierItemId: 'a', laterItemId: 'b' }, earlierIndex: 0 }],
    cuts: [{ src: 'video' }], isStillImageCut: () => false, cutVideoUri: () => 'video.mp4',
    videoDurationCache: new Map(), ensureVideoDurationFetch() { durationFetches++; this.videoDurationCache.set('video.mp4', 'pending'); },
    syncRightPane() { panelSwitches++; }, revealOutputPreview() { panelSwitches++; }
  };
  const select = widgetMethod('selectTransitionBoundary', {
    sameBoundary: (left, right) => left.earlierItemId === right.earlierItemId && left.laterItemId === right.laterItemId
  });
  select.call(state, { earlierItemId: 'a', laterItemId: 'b' });
  select.call(state, { earlierItemId: 'a', laterItemId: 'b' });
  assert.equal(state.selection, undefined);
  assert.deepEqual(state.multiSelection, []);
  assert.equal(state.selectedGap, undefined);
  assert.deepEqual(state.timelineRange, {});
  assert.equal(state.selectionModel.keyframeSelection, undefined);
  assert.equal(panelSwitches, 0);
  assert.equal(durationFetches, 1);
});

test('Delete on an active boundary removes its transition and never reaches clip deletion', async () => {
  let removed = 0;
  const state = { activeBoundary: { earlierItemId: 'a', laterItemId: 'b' },
    timelineRange: {}, selectionModel: {}, multiSelection: [], autoRipple: false,
    removeActiveTransition: async () => { removed++; return true; },
    performDeleteSelected: () => { throw new Error('clip deletion reached'); } };
  await widgetMethod('performTimelineDelete', { completeTimelineRange, timelineDeletePlan }).call(state, false);
  assert.equal(removed, 1);
});

test('selecting a clip after a boundary releases the transition Delete target', () => {
  const state = {
    activeBoundary: { earlierItemId: 'a', laterItemId: 'b' }, multiSelection: [],
    selection: undefined, selectionKey: item => item?.kind ?? '',
    scheduleStripRender() {}, claimInspectorOwner() {}, pushSelectionSnapshot() {},
    applySelectionClass() {}, publishPrimaryPreviewSelection() {}
  };
  state.releaseTransitionBoundaryForOtherSelection = widgetMethod('releaseTransitionBoundaryForOtherSelection');
  widgetMethod('toggleMultiSelection', { togglePreviewSelection: (_items, item) => [item] })
    .call(state, { kind: 'cut', index: 0 });
  assert.equal(state.activeBoundary, undefined);
  assert.equal(timelineDeletePlan({ keyframe: false, transition: !!state.activeBoundary,
    gap: false, range: false, selection: !!state.selection,
    shift: false, autoRipple: false, oneSide: false }).target, 'selection');
});

test('clearing a boundary republishes the empty inspector selection', () => {
  let snapshots = 0;
  let classes = 0;
  const state = {
    activeBoundary: { earlierItemId: 'a', laterItemId: 'b' },
    selection: undefined, multiSelection: [], selectedGap: undefined,
    selectionKey: () => '', scheduleStripRender() {},
    exitFocusUnlessSelected() {}, exitTrimmerModeUnlessSelected() {},
    pushSelectionSnapshot() { snapshots++; }, applySelectionClass() { classes++; },
    claimInspectorOwner() {}, syncRightPane() {}
  };
  state.releaseTransitionBoundaryForOtherSelection = widgetMethod('releaseTransitionBoundaryForOtherSelection');
  widgetMethod('applySelection').call(state, undefined, false);
  assert.equal(state.activeBoundary, undefined);
  assert.equal(snapshots, 1);
  assert.equal(classes, 1);
});

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
  assert.equal(validateTransitionBoundaryWrite(ref, moved, 30, 1).pairExists, false);
  assert.deepEqual(validateTransitionBoundaryWrite(ref, moved.map(item => item.itemId === 'a'
    ? { ...item, locked: true } : item), 30, 1).blocks, ['locked', 'gap']);
});

const documentWithPair = () => ({ version: 2, output: { fps: 30 }, tracks: [
  { id: 'visual', lane: 'visual', items: [
    { id: 'a', at: 0, duration: 150, source: { kind: 'media', transition_out: null } },
    { id: 'b', at: 150, duration: 150, source: { kind: 'media' } }
  ] }
] });

test('document boundary distinguishes a gap from a replaced neighbour and checks the earlier track lock', () => {
  const ref = { earlierItemId: 'a', laterItemId: 'b' };
  const doc = documentWithPair();
  assert.equal(resolveBoundaryInDocument(doc, ref).pairExists, true);
  doc.tracks[0].items[1].at = 160;
  assert.deepEqual(resolveBoundaryInDocument(doc, ref).blocks, ['gap']);
  doc.tracks[0].items.splice(1, 0, { id: 'x', at: 150, duration: 10, source: { kind: 'media' } });
  assert.equal(resolveBoundaryInDocument(doc, ref).pairExists, false);
  assert.deepEqual(resolveBoundaryInDocument(doc, ref, new Set(['visual'])).blocks, ['locked', 'gap']);
});

test('document boundary leaves the track-count rule to the candidate check', () => {
  const doc = documentWithPair();
  doc.tracks.push({ id: 'pip', lane: 'visual', items: [
    { id: 'p', at: 200, duration: 30, source: { kind: 'media' } }
  ] });
  assert.deepEqual(resolveBoundaryInDocument(doc, { earlierItemId: 'a', laterItemId: 'b' }).blocks, []);
});

test('queued transition mutation rejects a moved clip and an inserted clip at write time', async () => {
  const ref = { earlierItemId: 'a', laterItemId: 'b' };
  const apply = widgetMethod('applyTransitionOut', {
    validateTransitionBoundaryWrite, transitionWriteIsBlocked, resolveBoundaryInDocument,
    primaryBoundaryBlock, clampTransitionHandleForWrite: (handle, duration) => ({ handle, duration }),
    cutOverlapFrames: () => 0, t: key => key
  });
  for (const change of [
    doc => { doc.tracks[0].items[1].at = 170; },
    doc => { doc.tracks[0].items.splice(1, 0,
      { id: 'x', at: 150, duration: 10, source: { kind: 'media' } }); }
  ]) {
    let doc = documentWithPair();
    let resume;
    let cleared = 0;
    const segments = pair();
    const state = { cutItemIds: ['a', 'b'], segments, fps: 30,
      location: { editUri: 'edit.json' }, compatibilityTimelineTracks: [{ kind: 'cuts' }],
      activeBoundary: ref, footer: { textContent: '' }, messages: { warn() {} },
      transitionBoundaryInputs: () => segments, nextSameTrackSegment: () => segments[1],
      transitionHandlePlan: async () => ({ outcome: 'full' }),
      timelineLockedTrackIds: () => [], boundaryBlockMessage: () => 'blocked', showNotice() {},
      clearActiveTransitionBoundary() { cleared++; this.activeBoundary = undefined; },
      commitEditMutation(_label, mutate) {
        return new Promise((resolve, reject) => { resume = () => {
          try { doc = mutate(doc); resolve({}); } catch (error) { reject(error); }
        }; });
      }
    };
    const pending = apply.call(state, ref, { type: 'fade', duration: .5 });
    await new Promise(resolve => setImmediate(resolve));
    change(doc);
    resume();
    assert.equal((await pending).ok, false);
    assert.equal(doc.tracks[0].items[0].source.transition_out, null);
    assert.equal(cleared, doc.tracks[0].items.length === 3 ? 1 : 0);
  }
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
