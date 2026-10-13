import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  TRANSITION_ALIGN_IDS,
  chooseTransitionAlign,
  cutOverlapFrames,
  isTransitionAlign,
  planTrackTransitions,
  planTransitionHandleWindow,
  readTransitionAlign,
  readTransitionFill,
  transitionPlanClipsFromCuts,
} from '../lib/index.js';

const cases = JSON.parse(readFileSync(new URL('./transition-plan-cases.json', import.meta.url), 'utf8'));
const TOLERANCE = 1e-9;

const roomOf = value => value === 'inf' ? Number.POSITIVE_INFINITY : value === null ? undefined : value;
const clipOf = clip => ({
  id: clip.id,
  startSeconds: clip.start,
  lengthSeconds: clip.length,
  headRoomSeconds: roomOf(clip.head),
  tailRoomSeconds: roomOf(clip.tail),
  ...(clip.out ? { transitionOut: { declaredSeconds: clip.out.declared, align: clip.out.align, fill: clip.out.fill === true } } : {}),
});
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= TOLERANCE, `${label}: ${actual} != ${expected}`);

test('align and fill read unknown values as the safe default', () => {
  assert.deepEqual([...TRANSITION_ALIGN_IDS], ['center', 'before-cut', 'after-cut']);
  for (const id of TRANSITION_ALIGN_IDS) assert.equal(readTransitionAlign(id), id);
  for (const value of [undefined, null, '', 'future-side', 1]) {
    assert.equal(isTransitionAlign(value), false);
    assert.equal(readTransitionAlign(value), 'center');
  }
  assert.equal(readTransitionFill('freeze'), 'freeze');
  for (const value of [undefined, null, 'hold', true]) assert.equal(readTransitionFill(value), undefined);
});

for (const entry of cases.plan) {
  test(`plan: ${entry.name}`, () => {
    const plans = planTrackTransitions(entry.clips.map(clipOf), { fps: entry.fps });
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
      near(plan.endOffsetSeconds - plan.startOffsetSeconds, plan.effectiveSeconds, 'offsets');
      assert.equal(plan.freezeIncomingSeconds, 0);
      assert.equal(plan.freezeOutgoingSeconds, 0);
    });
  });
}

for (const entry of cases.choose) {
  test(`choose: ${entry.name}`, () => {
    const choice = chooseTransitionAlign(entry.clips.map(clipOf), entry.earlier, entry.declared,
      { fps: entry.fps, allowFill: false });
    assert.equal(choice.align, entry.expected.align);
    assert.equal(choice.needsFill, false);
    near(choice.plan.effectiveSeconds, entry.expected.effective, 'effective');
  });
}

test('choosing reports the neighbouring boundary that becomes shorter', () => {
  const clips = [
    { id: 'a', start: 0, length: 4, head: 5, tail: 5, out: { declared: 0.8, align: 'after-cut' } },
    { id: 'b', start: 4, length: 1, head: 5, tail: 5 },
    { id: 'c', start: 5, length: 4, head: 0, tail: 5 },
  ].map(clipOf);
  // C has no head room, so center and before-cut have nothing to play; after the cut needs only B's tail.
  const choice = chooseTransitionAlign(clips, 'b', 0.8, { fps: 30, allowFill: false });
  assert.equal(choice.align, 'after-cut');
  near(choice.plan.effectiveSeconds, 0.8, 'after-cut keeps the declared length');
  assert.deepEqual(choice.neighborChanges, []);
  assert.equal(chooseTransitionAlign(clips, 'missing', 1, { fps: 30, allowFill: false }), undefined);
  assert.equal(chooseTransitionAlign(clips, 'c', 1, { fps: 30, allowFill: false }), undefined);
  const roomy = clips.map(clip => clip.id === 'c' ? { ...clip, headRoomSeconds: 5 } : clip);
  const second = chooseTransitionAlign(roomy, 'b', 0.8, { fps: 30, allowFill: false });
  // center takes 0.4 of B; A|B wanted 0.8 of the same 1 second clip and gives up 0.2.
  assert.equal(second.align, 'center');
  near(second.plan.effectiveSeconds, 0.8, 'center keeps the declared length');
  assert.equal(second.neighborChanges.length, 1);
  near(second.neighborChanges[0].effectiveSeconds, 0.6, 'the earlier window keeps what is left of B');
  const squeezed = chooseTransitionAlign(roomy.map(clip => clip.id === 'c'
    ? { ...clip, startSeconds: 5, lengthSeconds: 0.2 } : clip), 'b', 0.8, { fps: 30, allowFill: false });
  assert.equal(squeezed.align, 'before-cut');
  near(squeezed.plan.effectiveSeconds, 0.5, 'half of B');
  assert.equal(squeezed.neighborChanges.length, 1);
  assert.equal(squeezed.neighborChanges[0].earlierId, 'a');
  near(squeezed.neighborChanges[0].effectiveSeconds, 0.5, 'the earlier window gives up its half');
});

// Deterministic generator so a failure can be replayed from the seed.
const generator = seed => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
};

const randomTrack = (random, fps) => {
  const clips = [];
  let cursor = 0;
  const count = 2 + Math.floor(random() * 5);
  for (let index = 0; index < count; index++) {
    const length = random() < 0.3 ? 0.05 + random() * 0.4 : 0.5 + random() * 4;
    const drift = random() < 0.25 ? (random() - 0.5) * 0.9 / fps : 0;
    const start = index === 0 ? 0 : cursor + drift;
    const pick = random();
    const room = () => random() < 0.2 ? 0 : random() < 0.15 ? Number.POSITIVE_INFINITY : random() * 3;
    clips.push({
      id: `c${index}`, startSeconds: start, lengthSeconds: length,
      headRoomSeconds: room(), tailRoomSeconds: random() < 0.2 ? undefined : room(),
      ...(random() < 0.8 ? { transitionOut: {
        declaredSeconds: 0.02 + random() * 2,
        align: pick < 0.34 ? 'center' : pick < 0.67 ? 'before-cut' : 'after-cut', fill: false,
      } } : {}),
    });
    cursor = start + length;
  }
  return clips;
};

test('windows of freshly synthesised boundaries never overlap, whatever the placement', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const fps = seed % 3 === 0 ? 60 : seed % 3 === 1 ? 30 : 24;
    const clips = randomTrack(generator(seed), fps);
    const plans = planTrackTransitions(clips, { fps }).filter(plan => plan.state !== 'none');
    const windows = plans.map(plan => ({
      start: plan.cutSeconds + plan.startOffsetSeconds, end: plan.cutSeconds + plan.endOffsetSeconds, plan,
    })).sort((left, right) => left.start - right.start);
    for (let index = 0; index + 1 < windows.length; index++) {
      assert.ok(windows[index].end <= windows[index + 1].start + 1e-7,
        `seed ${seed}: ${JSON.stringify(windows[index])} overlaps ${JSON.stringify(windows[index + 1])}`);
    }
    for (const { plan } of windows) {
      // Ends that round to different frames form an existing overlap, which keeps whatever length it has.
      if (plan.legacyOverlap) continue;
      assert.ok(plan.effectiveSeconds >= 1 / fps - 1e-6, `seed ${seed}: shorter than a frame`);
      assert.ok(cutOverlapFrames({ tlEnd: plan.cutSeconds + plan.endOffsetSeconds },
        { tlStart: plan.cutSeconds + plan.startOffsetSeconds }, fps) >= 1,
      `seed ${seed}: window rounds to no overlap`);
      assert.ok(plan.effectiveSeconds <= plan.declaredSeconds + 1e-9, `seed ${seed}: longer than declared`);
      const later = clips.find(clip => clip.id === plan.laterId);
      const earlier = clips.find(clip => clip.id === plan.earlierId);
      // No fill in this round: a window never asks for more footage than exists.
      assert.ok(-plan.startOffsetSeconds <= later.headRoomSeconds + 1e-9, `seed ${seed}: head room`);
      if (earlier.tailRoomSeconds !== undefined) {
        const drift = earlier.startSeconds + earlier.lengthSeconds - plan.cutSeconds;
        assert.ok(plan.endOffsetSeconds <= Math.max(0, earlier.tailRoomSeconds + drift) + 1e-9, `seed ${seed}: tail room`);
      }
    }
  }
});

test('a legacy overlap keeps its interval and new windows stay clear of it', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const random = generator(seed * 7919);
    const declared = 0.3 + random() * 1.5;
    const overlap = declared * (0.2 + random() * 0.8);
    const middle = 0.3 + random() * 3;
    const pick = random();
    const align = pick < 0.34 ? 'center' : pick < 0.67 ? 'before-cut' : 'after-cut';
    const clips = [
      { id: 'a', startSeconds: 0, lengthSeconds: 5, headRoomSeconds: 5, tailRoomSeconds: 5,
        transitionOut: { declaredSeconds: declared, align: 'center', fill: false } },
      { id: 'b', startSeconds: 5 - overlap, lengthSeconds: middle, headRoomSeconds: 5, tailRoomSeconds: 5,
        transitionOut: { declaredSeconds: 0.2 + random() * 2, align, fill: false } },
      { id: 'c', startSeconds: 5 - overlap + middle, lengthSeconds: 4, headRoomSeconds: 5, tailRoomSeconds: 5 },
    ];
    const [legacy, fresh] = planTrackTransitions(clips, { fps: 30 });
    assert.equal(legacy.legacyOverlap, true);
    const legacyEnd = Math.min(5, 5 - overlap + middle, 5 - overlap + declared);
    near(legacy.cutSeconds, 5 - overlap, `seed ${seed}: legacy start`);
    near(legacy.cutSeconds + legacy.endOffsetSeconds, legacyEnd, `seed ${seed}: legacy end`);
    assert.equal(fresh.legacyOverlap, false);
    if (fresh.state !== 'none') {
      assert.ok(fresh.cutSeconds + fresh.startOffsetSeconds >= legacyEnd - 1e-7, `seed ${seed}: overlaps the legacy window`);
    }
    if (legacyEnd >= 5 - overlap + middle - 1e-9) assert.equal(fresh.state, 'none');
  }
});

test('an isolated centered boundary equals the previous single-window rule', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const random = generator(seed * 104729);
    const room = () => random() < 0.25 ? 0 : random() * 2;
    const input = {
      declaredSeconds: 0.05 + random() * 2, outgoingTailRoomSeconds: room(), incomingHeadRoomSeconds: room(),
      outgoingDurationSeconds: 0.1 + random() * 3, incomingDurationSeconds: 0.1 + random() * 3,
    };
    const previous = planTransitionHandleWindow(input).effectiveSeconds;
    const [plan] = planTrackTransitions([
      { id: 'a', startSeconds: 0, lengthSeconds: input.outgoingDurationSeconds, headRoomSeconds: 0,
        tailRoomSeconds: input.outgoingTailRoomSeconds,
        transitionOut: { declaredSeconds: input.declaredSeconds, align: 'center', fill: false } },
      { id: 'b', startSeconds: input.outgoingDurationSeconds, lengthSeconds: input.incomingDurationSeconds,
        headRoomSeconds: input.incomingHeadRoomSeconds, tailRoomSeconds: 0 },
    ], { fps: 30 });
    near(plan.effectiveSeconds, previous < 1 / 30 - 1e-6 ? 0 : previous, `seed ${seed}`);
  }
});

test('fill lifts the incoming head limit and reports the held head', () => {
  const [plan] = planTrackTransitions([
    { id: 'a', startSeconds: 0, lengthSeconds: 4, headRoomSeconds: 1, tailRoomSeconds: 2,
      transitionOut: { declaredSeconds: 1, align: 'center', fill: true } },
    { id: 'b', startSeconds: 4, lengthSeconds: 4, headRoomSeconds: 0.1, tailRoomSeconds: 2 },
  ], { fps: 30 });
  near(plan.effectiveSeconds, 1, 'the declared length');
  near(plan.freezeIncomingSeconds, 0.4, 'half the window minus the head room');
  assert.equal(plan.freezeOutgoingSeconds, 0);
});

for (const entry of cases.timeline) {
  test(`clips from cuts: ${entry.name}`, () => {
    const tracks = transitionPlanClipsFromCuts(entry.cuts, { fps: entry.fps, resolve: (_cut, index) => entry.facts[index] });
    assert.equal(tracks.length, 1);
    const [plan] = planTrackTransitions(tracks[0].clips, { fps: entry.fps });
    near(plan.cutSeconds + plan.startOffsetSeconds, entry.expected.window.start, 'window start');
    near(plan.cutSeconds + plan.endOffsetSeconds, entry.expected.window.end, 'window end');
    const [outgoing, incoming] = entry.cuts;
    for (const sample of entry.expected.sourceSeconds) {
      // The source clock of both clips stays linear through the cut point.
      near(outgoing.out + (sample.t - plan.cutSeconds) * (outgoing.speed ?? 1), sample.outgoing, `outgoing at ${sample.t}`);
      near(incoming.in + (sample.t - plan.cutSeconds) * (incoming.speed ?? 1), sample.incoming, `incoming at ${sample.t}`);
    }
  });
}

test('clips from cuts resolve stills, freezes, speed, tracks and unusable cuts', () => {
  const cuts = [
    { at: 0, in: 2, out: 6, speed: 2, src: 'a', transitionOut: { type: 'dissolve', duration: 1, align: 'future-side', fill: 'freeze' } },
    { at: 2, in: 1, out: 3, src: 'still' },
    { at: 0, in: 0, out: 0, src: 'broken' },
    { at: 1, in: 0, out: 2, track: 1, src: 'pip' },
    { at: 4, in: 4, out: 6, src: 'frozen' },
  ];
  const facts = {
    a: { stillImage: false, freezeSeconds: 0, materialDurationSeconds: 10 },
    still: { stillImage: true, freezeSeconds: 0 },
    pip: { stillImage: false, freezeSeconds: 0 },
    frozen: { stillImage: false, freezeSeconds: 1.5 },
  };
  const seen = [];
  const tracks = transitionPlanClipsFromCuts(cuts, { fps: 30, resolve: (cut, index) => {
    seen.push(index);
    return facts[cut.src];
  } });
  assert.deepEqual(seen, [0, 1, 3, 4]);
  assert.deepEqual(tracks.map(track => track.track), [0, 1]);
  const [a, still, frozen] = tracks[0].clips;
  assert.deepEqual(a, { id: '0', startSeconds: 0, lengthSeconds: 2, headRoomSeconds: 1, tailRoomSeconds: 2,
    transitionOut: { declaredSeconds: 1, align: 'center', fill: true } });
  assert.equal(still.headRoomSeconds, Number.POSITIVE_INFINITY);
  assert.equal(still.tailRoomSeconds, Number.POSITIVE_INFINITY);
  assert.equal(still.id, '1');
  assert.equal(frozen.id, '4');
  assert.equal(frozen.lengthSeconds, 3.5);
  assert.equal(frozen.tailRoomSeconds, undefined);
  assert.equal(tracks[1].clips[0].id, '3');
});

test('the schema lists the same placements and fills, as open strings', () => {
  const schema = JSON.parse(readFileSync(new URL('../../schemas/edit.schema.json', import.meta.url), 'utf8'));
  const { align, fill } = schema.$defs.transitionOut.properties;
  assert.deepEqual(align['x-akari-known-values'], [...TRANSITION_ALIGN_IDS]);
  assert.deepEqual(fill['x-akari-known-values'], ['freeze']);
  for (const property of [align, fill]) {
    assert.equal(property.type, 'string');
    assert.equal(property.enum, undefined);
  }
});
