import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildTimelineMap, planTrackTransitions, projectLegacyEdit, readInternalEdit,
  transitionPlanClipsFromCuts
} from '../lib/index.js';

const document = (align, { incomingIn = 2, fill, freeze, speed = 1 } = {}) => ({
  version: 2, output: { width: 320, height: 180, fps: 30 },
  sources: [{ id: 'a', path: 'a.mp4' }, { id: 'b', path: 'b.mp4' }],
  tracks: [{ id: 'main', lane: 'visual', items: [
    { id: 'a', at: 0, duration: 120, source: { kind: 'media', src: 'a', in: 2, out: 6,
      transition_out: { type: 'dissolve', duration: 1, align, ...(fill ? { fill } : {}), color: '#123456' } } },
    { id: 'b', at: 120, duration: 120, source: { kind: 'media', src: 'b', in: incomingIn,
      out: incomingIn + (freeze ? 3 : 4) * speed, speed,
      ...(freeze ? { freeze: { at_sec: 2, duration_sec: 1 } } : {}) } }
  ] }]
});
const asCut = cut => ({ ...cut, transitionOut: cut.transitionOut ?? cut.transition_out });
const windows = map => map.transitionWindows.map(({ start, end }) => [start, end]);
const withoutPlan = value => JSON.parse(JSON.stringify(value, (key, item) =>
  ['cutSeconds', 'effectiveSeconds', 'state', 'reasons', 'align', 'fill'].includes(key)
    ? undefined : item));
const roundedWindows = map => windows(map).map(pair => pair.map(value => Math.round(value * 1e9) / 1e9));
const planned = (cuts, fps) => planTrackTransitions(transitionPlanClipsFromCuts(cuts, {
  fps, resolve: () => ({ stillImage: false, freezeSeconds: 0 })
})[0].clips, { fps });
const shared = JSON.parse(readFileSync(new URL('./transition-plan-cases.json', import.meta.url), 'utf8')).timeline;

for (const [align, expectedOut] of [[undefined, 2.5], ['before-cut', 2.25], ['after-cut', 2.75]]) {
  test(`whole-region outgoing freeze keeps its seed frame with ${align ?? 'center'} placement`, () => {
    const edit = { version: 2, output: { width: 320, height: 180, fps: 30 },
      sources: [{ id: 'a', path: 'a.mp4' }, { id: 'b', path: 'b.mp4' }],
      tracks: [{ id: 'main', lane: 'visual', items: [
        { id: 'a', at: 0, duration: 30, source: { kind: 'media', src: 'a', in: 2, out: 2.25,
          freeze: { at_sec: 0, duration_sec: 1 },
          transition_out: { type: 'dissolve', duration: 0.5, ...(align ? { align } : {}) } } },
        { id: 'b', at: 30, duration: 120, source: { kind: 'media', src: 'b', in: 2, out: 6 } }
      ] }]
    };
    const [a, b] = readInternalEdit(edit).tracks[0].items.map(item => item.declaration);
    assert.equal(a.out, expectedOut);
    assert.ok(a.out > a.in);
    if (align === undefined) assert.deepEqual([b.at, b.in], [0.75, 1.75]);
  });
}

for (const entry of shared) {
  test(`shared ${entry.name}: the raw plan and rendered projection retain the hand-calculated source times`, () => {
    const edit = {
      version: 2, output: { width: 320, height: 180, fps: entry.fps },
      sources: entry.cuts.map((cut, index) => ({ id: String(index), path: `${index}.mp4` })),
      tracks: [{ id: 'main', lane: 'visual', items: entry.cuts.map((cut, index) => ({
        id: String(index), at: cut.at * entry.fps,
        duration: Math.round((cut.out - cut.in) / (cut.speed ?? 1) * entry.fps),
        source: { kind: 'media', src: String(index), in: cut.in, out: cut.out,
          ...(cut.speed ? { speed: cut.speed } : {}),
          ...(cut.transitionOut ? { transition_out: cut.transitionOut } : {}) }
      })) }]
    };
    const internal = readInternalEdit(edit);
    const raw = projectLegacyEdit(internal).cuts.map(asCut);
    const planned = planTrackTransitions(transitionPlanClipsFromCuts(raw, {
      fps: entry.fps, resolve: () => ({ stillImage: false, freezeSeconds: 0 })
    })[0].clips, { fps: entry.fps });
    const expected = [entry.expected.window.start, entry.expected.window.end];
    assert.deepEqual(planned.map(plan => [plan.cutSeconds + plan.startOffsetSeconds,
      plan.cutSeconds + plan.endOffsetSeconds]), [expected]);
    const projected = internal.tracks[0].items.map(item => asCut(item.declaration));
    const map = buildTimelineMap(projected, { fps: entry.fps });
    assert.deepEqual(windows(map), [expected]);
    for (const point of entry.expected.sourceSeconds) {
      const window = map.transitionWindows[0];
      const outgoing = window.outgoing.in + (point.t - window.start) * window.outgoing.speed;
      const incoming = window.incoming.in + (point.t - window.start) * window.incoming.speed;
      assert.ok(Math.abs(outgoing - point.outgoing) < 1e-9, entry.name);
      assert.ok(Math.abs(incoming - point.incoming) < 1e-9, entry.name);
    }
  });
}

for (const [align, expected] of [
  ['before-cut', { window: [3, 4], out: 6, at: 3, incomingIn: 1 }],
  ['center', { window: [3.5, 4.5], out: 6.5, at: 3.5, incomingIn: 1.5 }],
  ['after-cut', { window: [4, 5], out: 7, at: 4, incomingIn: 2 }]
]) {
  test(`${align}: projection, raw map, and projected map share the planned window`, () => {
    const internal = readInternalEdit(document(align));
    const items = internal.tracks[0].items;
    const declarations = items.map(item => asCut(item.declaration));
    const raw = projectLegacyEdit(internal).cuts.map(asCut);
    const plan = planTrackTransitions(transitionPlanClipsFromCuts(raw, {
      fps: 30, resolve: () => ({ stillImage: false, freezeSeconds: 0 })
    })[0].clips, { fps: 30 });
    assert.deepEqual(plan.map(entry => [entry.cutSeconds + entry.startOffsetSeconds,
      entry.cutSeconds + entry.endOffsetSeconds]), [expected.window]);
    assert.deepEqual(windows(buildTimelineMap(raw, { fps: 30 })), [expected.window]);
    assert.deepEqual(windows(buildTimelineMap(declarations, { fps: 30 })), [expected.window]);
    assert.equal(declarations[0].out, expected.out);
    assert.equal(declarations[1].at, expected.at);
    assert.equal(declarations[1].in, expected.incomingIn);
    assert.deepEqual(declarations[0].transitionOut,
      { type: 'dissolve', duration: 1, color: '#123456' });
    const projected = buildTimelineMap(declarations, { fps: 30 });
    assert.equal(projected.totalDuration, 8);
    assert.equal(projected.transitionWindows[0].state, undefined);
    assert.equal(buildTimelineMap(raw, { fps: 30 }).transitionWindows[0].state, 'ok');
  });
}

for (const [align, fps, duration] of [
  ...['before-cut', 'center', 'after-cut'].map(align => [align, 30, 1]),
  ...['before-cut', 'center', 'after-cut'].flatMap(align => [[align, 30, 1 / 30], [align, 60, 1 / 60],
    [align, 30, 0.033333], [align, 30, 0.0334]])
]) {
  test(`${align} at ${fps} fps with ${duration}s: projected declarations are not planned twice`, () => {
    const edit = document(align);
    edit.output.fps = fps;
    edit.tracks[0].items[0].duration = 4 * fps;
    edit.tracks[0].items[1].at = 4 * fps;
    edit.tracks[0].items[1].duration = 4 * fps;
    edit.tracks[0].items[0].source.transition_out.duration = duration;
    const internal = readInternalEdit(edit);
    const raw = projectLegacyEdit(internal).cuts.map(asCut);
    const projected = internal.tracks[0].items.map(item => asCut(item.declaration));
    const rawMap = buildTimelineMap(raw, { fps });
    const projectedMap = buildTimelineMap(projected, { fps });
    // C = 4; the window has duration D on the chosen side of C, with total length 8.
    assert.deepEqual(projectedMap.transitionWindows.map(withoutPlan),
      rawMap.transitionWindows.map(withoutPlan));
    assert.deepEqual(withoutPlan(projectedMap.segments), withoutPlan(rawMap.segments));
    assert.equal(projectedMap.totalDuration, rawMap.totalDuration);
    const secondPass = planned(projected, fps);
    if (duration === 0.033333 && align === 'center') {
      assert.deepEqual(windows(rawMap), []);
      assert.deepEqual(secondPass, []);
    } else {
      assert.equal(secondPass.length, 1);
      assert.equal(secondPass[0].legacyOverlap, true);
      assert.deepEqual(secondPass.map(plan => [plan.cutSeconds + plan.startOffsetSeconds,
        plan.cutSeconds + plan.endOffsetSeconds]), windows(rawMap));
    }
  });
}
// The map does not count existing freeze time, so freeze examples are excluded from map equivalence.

for (const [label, incomingIn, duration] of [['no head', 0, 1], ['subframe', 2, 0.02]]) {
  test(`${label}: a non-effective declaration is absent in the projected map`, () => {
    const edit = document('center', { incomingIn });
    edit.tracks[0].items[0].source.transition_out.duration = duration;
    const declarations = readInternalEdit(edit).tracks[0].items.map(item => asCut(item.declaration));
    // With no incoming head or D < one frame, there is no positive render window.
    assert.equal(declarations[0].transition_out, undefined);
    assert.deepEqual(windows(buildTimelineMap(declarations, { fps: 30 })), []);
  });
}

test('a none plan cannot reappear as a narrow playback window', () => {
  const raw = [
    { at: 0, in: 0, out: 4.01, transitionOut: { type: 'dissolve', duration: 0.01 } },
    { at: 4, in: 2, out: 6 }
  ];
  assert.deepEqual(windows(buildTimelineMap(raw, { fps: 30 })), []);
  const edit = { version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'a', path: 'a.mp4' }, { id: 'b', path: 'b.mp4' }],
    tracks: [{ id: 'main', lane: 'visual', items: [
      { id: 'a', at: 0, duration: 120, source: { kind: 'media', src: 'a', in: 0, out: 4.01,
        transition_out: { type: 'dissolve', duration: 0.01 } } },
      { id: 'b', at: 120, duration: 60, source: { kind: 'media', src: 'b', in: 2, out: 4 } }
    ] }]
  };
  const projected = readInternalEdit(edit).tracks[0].items.map(item => asCut(item.declaration));
  assert.deepEqual(windows(buildTimelineMap(projected, { fps: 30 })), []);
});

test('a legacy overlap reserves the short middle clip before its next planned boundary', () => {
  const edit = {
    version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: ['a', 'b', 'c'].map(id => ({ id, path: `${id}.mp4` })),
    tracks: [{ id: 'main', lane: 'visual', items: [
      { id: 'a', at: 0, duration: 60, source: { kind: 'media', src: 'a', in: 2, out: 4,
        transition_out: { type: 'dissolve', duration: 1, align: 'center', color: '#123456' } } },
      { id: 'b', at: 45, duration: 18, source: { kind: 'media', src: 'b', in: 2, out: 2.6,
        transition_out: { type: 'dissolve', duration: 0.4, align: 'before-cut' } } },
      { id: 'c', at: 63, duration: 60, source: { kind: 'media', src: 'c', in: 2, out: 4 } }
    ] }]
  };
  const internal = readInternalEdit(edit);
  const raw = projectLegacyEdit(internal).cuts.map(asCut);
  const declarations = internal.tracks[0].items.map(item => asCut(item.declaration));
  // A-B occupies [1.5, 2]; B has only [2, 2.1] left for B-C.
  assert.deepEqual(declarations[0].transition_out, raw[0].transition_out);
  assert.deepEqual([declarations[0].at, declarations[0].in, declarations[0].out],
    [raw[0].at, raw[0].in, raw[0].out]);
  assert.deepEqual(windows(buildTimelineMap(raw, { fps: 30 })), [[1.5, 2], [2, 2.1]]);
  assert.deepEqual(windows(buildTimelineMap(declarations, { fps: 30 })), [[1.5, 2], [2, 2.1]]);
});

test('two opposite placements split a 0.2-second middle clip evenly', () => {
  const edit = {
    version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: ['a', 'b', 'c'].map(id => ({ id, path: `${id}.mp4` })),
    tracks: [{ id: 'main', lane: 'visual', items: [
      { id: 'a', at: 0, duration: 60, source: { kind: 'media', src: 'a', in: 2, out: 4,
        transition_out: { type: 'dissolve', duration: 0.4, align: 'after-cut' } } },
      { id: 'b', at: 60, duration: 6, source: { kind: 'media', src: 'b', in: 2, out: 2.2,
        transition_out: { type: 'dissolve', duration: 0.4, align: 'before-cut' } } },
      { id: 'c', at: 66, duration: 60, source: { kind: 'media', src: 'c', in: 2, out: 4 } }
    ] }]
  };
  const internal = readInternalEdit(edit);
  const raw = projectLegacyEdit(internal).cuts.map(asCut);
  const projected = internal.tracks[0].items.map(item => asCut(item.declaration));
  // Both ask for 0.2 of B; 0.2 + 0.2 > 0.2, so each gets max(0.1, 0.2 - 0.2) = 0.1.
  const expected = [[2, 2.1], [2.1, 2.2]];
  assert.deepEqual(planned(raw, 30).map(plan => [plan.cutSeconds + plan.startOffsetSeconds,
    plan.cutSeconds + plan.endOffsetSeconds].map(value => Math.round(value * 1e9) / 1e9)), expected);
  assert.deepEqual(roundedWindows(buildTimelineMap(raw, { fps: 30 })), expected);
  assert.deepEqual(roundedWindows(buildTimelineMap(projected, { fps: 30 })), expected);
});

test('later material duration limits only the after-cut outgoing room', () => {
  const cuts = [
    { at: 0, in: 2, out: 6, transitionOut: { type: 'dissolve', duration: 1, align: 'after-cut' } },
    { at: 4, in: 2, out: 6 }
  ];
  const unknown = buildTimelineMap(cuts, { fps: 30 });
  const known = buildTimelineMap(cuts, { fps: 30,
    handleRoom: index => index === 0 ? { tailSeconds: 0.3 } : undefined });
  // After-cut begins at C = 4; available A tail reduces 1 to 0.3.
  assert.deepEqual(windows(unknown), [[4, 5]]);
  assert.equal(unknown.transitionWindows[0].state, 'ok');
  assert.deepEqual(windows(known), [[4, 4.3]]);
  assert.equal(known.transitionWindows[0].state, 'shortened');
  assert.ok(known.transitionWindows[0].reasons.includes('outgoing-room'));
});

test('existing freeze contributes to clip length and its local position follows the earlier start', () => {
  const internal = readInternalEdit(document('center', { incomingIn: 2, freeze: true, speed: 2 }));
  const items = internal.tracks[0].items;
  const raw = projectLegacyEdit(internal).cuts.map(asCut);
  const fromCuts = transitionPlanClipsFromCuts(raw, {
    fps: 30, resolve: (cut, index) => ({ stillImage: false,
      freezeSeconds: index === 1 ? cut.freeze.duration_sec : 0 })
  })[0].clips;
  assert.deepEqual(fromCuts.map(clip => [clip.startSeconds, clip.lengthSeconds]),
    items.map(item => [item.at, item.duration]));
  assert.equal(items[1].declaration.freeze.at_sec, 2.5);
  assert.equal(items[1].declaration.in, 1);
  assert.ok(items[1].declaration.in >= 0 && items[1].declaration.in < items[1].declaration.out);
});

test('freeze fill is carried without permitting a negative incoming in', () => {
  const internal = readInternalEdit(document('center', { incomingIn: 0.1, fill: 'freeze' }));
  const [a, b] = internal.tracks[0].items.map(item => item.declaration);
  assert.ok(b.in >= 0 && b.in < b.out);
  assert.ok(a.transition_out.duration <= 0.2 + 1e-9);
  assert.equal(a.transition_out.fill, undefined);
});

test('unknown placement and fill use the centered window without carrying their render hints', () => {
  const internal = readInternalEdit(document('sideways', { fill: 'repeat' }));
  const [a, b] = internal.tracks[0].items.map(item => item.declaration);
  assert.deepEqual([a.out, b.at, b.in], [6.5, 3.5, 1.5]);
  assert.deepEqual(a.transition_out, { type: 'dissolve', duration: 1, color: '#123456' });
});

test('existing overlap and a gap retain the declaration including placement and fill', () => {
  for (const [frame, label] of [[105, 'overlap'], [150, 'gap']]) {
    const edit = document('before-cut', { fill: 'freeze' });
    edit.tracks[0].items[1].at = frame;
    const declaration = readInternalEdit(edit).tracks[0].items[0].declaration.transition_out;
    assert.deepEqual(declaration, {
      type: 'dissolve', duration: 1, align: 'before-cut', fill: 'freeze', color: '#123456'
    }, label);
  }
});
