import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  chooseTransitionAlign,
  planTrackTransitions,
  readInternalEdit,
  setCutTransitionOutInSource,
  transitionPlanClipsFromCuts,
} from '../lib/index.js';

const cases = JSON.parse(readFileSync(new URL('./transition-plan-cases.json', import.meta.url), 'utf8'));
const TOLERANCE = 1e-9;
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= TOLERANCE, `${label}: ${actual} != ${expected}`);
const roomOf = value => value === 'inf' ? Number.POSITIVE_INFINITY : value === null ? undefined : value;
const clipOf = clip => ({
  id: clip.id,
  startSeconds: clip.start,
  lengthSeconds: clip.length,
  headRoomSeconds: roomOf(clip.head),
  tailRoomSeconds: roomOf(clip.tail),
  ...(clip.out ? { transitionOut: { declaredSeconds: clip.out.declared, align: clip.out.align, fill: clip.out.fill === true } } : {}),
  ...(clip.holdBlocked ? { holdBlocked: true } : {}),
});
const optionsOf = entry => ({ fps: entry.fps, ...(entry.tailRoom ? { tailRoom: entry.tailRoom } : {}) });

for (const entry of cases.planFill) {
  test(`plan with fill: ${entry.name}`, () => {
    const plans = planTrackTransitions(entry.clips.map(clipOf), optionsOf(entry));
    assert.equal(plans.length, entry.expected.length);
    plans.forEach((plan, index) => {
      const expected = entry.expected[index];
      assert.equal(plan.earlierId, expected.earlier);
      assert.equal(plan.laterId, expected.later);
      assert.equal(plan.legacyOverlap, expected.legacy);
      assert.equal(plan.state, expected.state);
      assert.deepEqual([...plan.reasons].sort(), [...expected.reasons].sort());
      near(plan.effectiveSeconds, expected.effective, 'effective');
      near(plan.cutSeconds + plan.startOffsetSeconds, expected.start, 'start');
      near(plan.cutSeconds + plan.endOffsetSeconds, expected.end, 'end');
      near(plan.freezeIncomingSeconds, expected.freezeIn, 'incoming freeze');
      near(plan.freezeOutgoingSeconds, expected.freezeOut, 'outgoing freeze');
      assert.equal(plan.freezeOutgoingUnknown === true, expected.freezeOutUnknown === true);
    });
  });
}

for (const entry of cases.chooseFill) {
  test(`choose with fill allowed: ${entry.name}`, () => {
    const choice = chooseTransitionAlign(entry.clips.map(clipOf), entry.earlier, entry.declared,
      { ...optionsOf(entry), allowFill: true });
    assert.equal(choice.align, entry.expected.align);
    assert.equal(choice.needsFill, entry.expected.needsFill);
    near(choice.plan.effectiveSeconds, entry.expected.effective, 'effective');
    near(choice.plan.freezeIncomingSeconds, entry.expected.freezeIn, 'incoming freeze');
    near(choice.plan.freezeOutgoingSeconds, entry.expected.freezeOut, 'outgoing freeze');
    assert.equal(choice.plan.freezeOutgoingUnknown === true, entry.expected.freezeOutUnknown === true);
  });

  test(`choose without fill never asks for one: ${entry.name}`, () => {
    const choice = chooseTransitionAlign(entry.clips.map(clipOf), entry.earlier, entry.declared,
      { ...optionsOf(entry), allowFill: false });
    assert.equal(choice.needsFill, false);
    assert.equal(choice.plan.freezeIncomingSeconds, 0);
  });
}

test('the screen view keeps a chosen candidate strict about its own outgoing tail', () => {
  // With the drawn view ('ignore') the neighbours are not limited by their tails, but a new candidate
  // must still find a placement that needs no freeze: the tail of A is short, so the head of B is used.
  const clips = [
    { id: 'a', start: 0, length: 5, head: 1, tail: 0.1 },
    { id: 'b', start: 5, length: 5, head: 2, tail: 2 },
  ].map(clipOf);
  const choice = chooseTransitionAlign(clips, 'a', 1, { fps: 30, tailRoom: 'ignore', allowFill: true });
  assert.equal(choice.align, 'before-cut');
  assert.equal(choice.needsFill, false);
  near(choice.plan.effectiveSeconds, 1, 'effective');
});

// The projection cases use a v2 document so that the render declarations come from the real reader.
const frames = (seconds, fps) => Math.round(seconds * fps);
const documentOf = entry => ({
  version: 2, output: { width: 320, height: 180, fps: entry.fps },
  sources: [...new Set(entry.cuts.map(cut => cut.src))].map(id => ({ id, path: `${id}.mp4` })),
  tracks: [{ id: 'main', lane: 'visual', items: entry.cuts.map((cut, index) => {
    const speed = cut.speed ?? 1;
    const display = (cut.out - cut.in) / speed + (cut.freeze?.duration_sec ?? 0);
    return {
      id: `c${index + 1}`, at: frames(cut.at, entry.fps), duration: frames(display, entry.fps),
      source: {
        kind: 'media', src: cut.src, in: cut.in, out: cut.out,
        ...(cut.speed ? { speed: cut.speed } : {}),
        ...(cut.freeze ? { freeze: cut.freeze } : {}),
        ...(cut.transitionOut ? { transition_out: cut.transitionOut } : {}),
      },
    };
  }) }],
});

for (const entry of cases.hold) {
  test(`hold: the plan reports the held head — ${entry.name}`, () => {
    const [track] = transitionPlanClipsFromCuts(entry.cuts, { fps: entry.fps, resolve: (_cut, index) => entry.facts[index] });
    const plans = planTrackTransitions(track.clips, { fps: entry.fps });
    assert.equal(plans.length, entry.expected.windows.length);
    plans.forEach((plan, index) => {
      near(plan.cutSeconds + plan.startOffsetSeconds, entry.expected.windows[index].start, 'window start');
      near(plan.cutSeconds + plan.endOffsetSeconds, entry.expected.windows[index].end, 'window end');
      near(plan.freezeIncomingSeconds, entry.expected.freezeIn[index], 'incoming freeze');
    });
  });

  test(`hold: the render declarations keep the clip clock — ${entry.name}`, () => {
    const declarations = readInternalEdit(documentOf(entry)).tracks[0].items.map(item => item.declaration);
    assert.equal(declarations.length, entry.expected.projected.length);
    declarations.forEach((declaration, index) => {
      const expected = entry.expected.projected[index];
      near(declaration.at, expected.at, `cut ${index} at`);
      near(declaration.in, expected.in, `cut ${index} in`);
      near(declaration.out, expected.out, `cut ${index} out`);
      if (expected.hold === undefined) assert.equal(declaration.transitionHold, undefined, `cut ${index} hold`);
      else near(declaration.transitionHold.headSeconds, expected.hold, `cut ${index} hold`);
      if (expected.transitionSeconds === undefined) assert.equal(declaration.transition_out, undefined);
      else {
        near(declaration.transition_out.duration, expected.transitionSeconds, `cut ${index} transition`);
        assert.equal(declaration.transition_out.fill, undefined);
        assert.equal(declaration.transition_out.align, undefined);
      }
      if (expected.freezeAt !== undefined) near(declaration.freeze.at_sec, expected.freezeAt, `cut ${index} freeze`);
      assert.ok(declaration.in >= 0 && declaration.in < declaration.out);
    });
    // The raw clip positions and the total length do not depend on the fill.
    const last = entry.cuts[entry.cuts.length - 1];
    near(last.at + (last.out - last.in) / (last.speed ?? 1) + (last.freeze?.duration_sec ?? 0), entry.expected.totalSeconds, 'total');
    // Sequential export: every input is the displayed length plus its held head, and windows overlap.
    const inputs = declarations.map(declaration => (declaration.out - declaration.in) / (declaration.speed ?? 1)
      + (declaration.freeze?.duration_sec ?? 0) + (declaration.transitionHold?.headSeconds ?? 0));
    inputs.forEach((seconds, index) => near(seconds, entry.expected.sequential.inputSeconds[index], `input ${index}`));
    declarations.forEach((declaration, index) =>
      near(declaration.transitionHold?.headSeconds ?? 0, entry.expected.sequential.silenceSeconds[index], `silence ${index}`));
    const overlap = declarations.reduce((sum, declaration) => sum + (declaration.transition_out?.duration ?? 0), 0);
    near(inputs.reduce((sum, seconds) => sum + seconds, 0) - overlap, entry.expected.sequential.totalSeconds, 'sequential total');
  });

  test(`hold: reading the render declarations again keeps the windows — ${entry.name}`, () => {
    const declarations = readInternalEdit(documentOf(entry)).tracks[0].items.map(item => item.declaration);
    const cuts = declarations.map(declaration => ({ ...declaration, transitionOut: declaration.transition_out }));
    const [track] = transitionPlanClipsFromCuts(cuts, {
      fps: entry.fps,
      resolve: cut => ({
        stillImage: false, freezeSeconds: cut.freeze?.duration_sec ?? 0,
        holdHeadSeconds: cut.transitionHold?.headSeconds,
      }),
    });
    const plans = planTrackTransitions(track.clips, { fps: entry.fps });
    assert.equal(plans.length, entry.expected.windows.length);
    plans.forEach((plan, index) => {
      assert.equal(plan.legacyOverlap, true, 'a projected boundary is an existing overlap');
      near(plan.cutSeconds + plan.startOffsetSeconds, entry.expected.windows[index].start, 'window start');
      near(plan.cutSeconds + plan.endOffsetSeconds, entry.expected.windows[index].end, 'window end');
    });
  });

  test(`hold: the source clock of the incoming clip — ${entry.name}`, () => {
    const declarations = readInternalEdit(documentOf(entry)).tracks[0].items.map(item => item.declaration);
    const [outgoing, incoming] = declarations;
    const hold = incoming.transitionHold?.headSeconds ?? 0;
    for (const sample of entry.expected.samples) {
      // The held head shows the first frame; from `at` on the clip clock is the ordinary linear one.
      const local = Math.max(0, sample.t - incoming.at);
      near(incoming.in + local * (incoming.speed ?? 1), sample.incoming, `incoming at ${sample.t}`);
      near(outgoing.in + (sample.t - outgoing.at) * (outgoing.speed ?? 1), sample.outgoing, `outgoing at ${sample.t}`);
      assert.ok(sample.t >= incoming.at - hold - TOLERANCE, 'samples start inside the window');
    }
    near(incoming.at, entry.expected.audio.incomingStart, 'real audio starts at the clip start');
    near(incoming.in, entry.expected.audio.incomingSource, 'real audio starts at the clip in point');
    near(incoming.at - hold, entry.expected.windows[0].start, 'the held head starts with the window');
    const windowSeconds = entry.expected.audio.fadeEnd - entry.expected.audio.fadeStart;
    near((incoming.at - entry.expected.audio.fadeStart) / windowSeconds, entry.expected.audio.incomingGainAtStart, 'gain at the clip start');
  });
}

test('setCutTransitionOutInSource keeps, sets and removes fill', () => {
  const source = JSON.stringify({ cuts: [
    { in: 0, out: 4, transition_out: { type: 'dissolve', duration: 0.5, fill: 'freeze', future: 1 } },
    { in: 0, out: 4 },
  ] });
  const read = text => JSON.parse(text).cuts[0].transition_out;
  assert.deepEqual(read(setCutTransitionOutInSource(source, 0, { type: 'dissolve', duration: 1 })),
    { type: 'dissolve', duration: 1, fill: 'freeze', future: 1 });
  assert.deepEqual(read(setCutTransitionOutInSource(source, 0, { type: 'dissolve', duration: 1, fill: null })),
    { type: 'dissolve', duration: 1, future: 1 });
  const bare = JSON.stringify({ cuts: [{ in: 0, out: 4 }, { in: 0, out: 4 }] });
  assert.deepEqual(read(setCutTransitionOutInSource(bare, 0, { type: 'dissolve', duration: 1, fill: 'freeze' })),
    { type: 'dissolve', duration: 1, fill: 'freeze' });
  assert.throws(() => setCutTransitionOutInSource(bare, 0, { type: 'dissolve', duration: 1, fill: 'repeat' }));
});

test('a held head without a declared transition before it is not counted', () => {
  const cuts = [
    { at: 0, in: 0, out: 5, src: 'a' },
    { at: 5, in: 0, out: 0.2, src: 'b', transitionHold: { headSeconds: 1 },
      transitionOut: { type: 'dissolve', duration: 1, align: 'before-cut' } },
    { at: 5.2, in: 2, out: 7, src: 'c' },
  ];
  const [track] = transitionPlanClipsFromCuts(cuts, {
    fps: 30, resolve: cut => ({ stillImage: false, freezeSeconds: 0, holdHeadSeconds: cut.transitionHold?.headSeconds }),
  });
  near(track.clips[1].startSeconds, 5, 'the stray hold does not move the clip start');
  near(track.clips[1].lengthSeconds, 0.2, 'the stray hold does not lengthen the clip');
  const [plan] = planTrackTransitions(track.clips, { fps: 30 });
  near(plan.cutSeconds + plan.startOffsetSeconds, 5, 'window start');
  near(plan.cutSeconds + plan.endOffsetSeconds, 5.2, 'window end');
});
