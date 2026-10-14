import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildTimelineMap, isStillImageSourcePath, projectLegacyEdit, readInternalEdit } from '../lib/index.js';

const cases = JSON.parse(readFileSync(new URL('./transition-projection-characterization-cases.json', import.meta.url), 'utf8'));
const round = value => typeof value === 'number' ? Math.round((value + Number.EPSILON) * 1e9) / 1e9 : value;
const makeEdit = c => ({
  version: 2,
  output: { width: 1280, height: 720, fps: c.fps },
  sources: c.items.map(item => ({ id: item.id, path: item.path ?? `${item.id}.mp4` })),
  tracks: [{ id: 'visual-main', lane: 'visual', items: c.items.map(item => ({
    id: item.id, at: item.at, duration: item.duration,
    ...(item.locked ? { locked: true } : {}),
    ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
    ...(item.blend !== undefined ? { blend: item.blend } : {}),
    ...(item.keyframes ? { keyframes: item.keyframes } : {}),
    source: { kind: 'media', src: item.id, in: item.in, out: item.out,
      ...(item.transition !== undefined ? { transition_out: { type: 'dissolve', duration: item.transition } } : {}),
      ...(item.freeze ? { freeze: item.freeze } : {}) }
  })) }]
});
const normalizeTransition = cut => {
  const { transition_out: snake, transitionOut: camel, ...rest } = cut;
  const transitionOut = camel ?? snake;
  return { ...rest, ...(transitionOut ? { transitionOut } : {}) };
};
const comparableMap = map => ({
  windows: map.transitionWindows.map(window => ({
    start: round(window.start), end: round(window.end), duration: round(window.duration), type: window.type,
    outgoing: { in: round(window.outgoing.in), out: round(window.outgoing.out) },
    incoming: { in: round(window.incoming.in), out: round(window.incoming.out) }
  })),
  totalDuration: round(map.totalDuration),
  segments: map.segments.map(segment => ({
    kind: segment.kind, cutIndex: segment.cutIndex,
    outStart: round(segment.outStart), outEnd: round(segment.outEnd),
    ...(segment.in !== undefined ? { in: round(segment.in), out: round(segment.out) } : {})
  }))
});
const marks = {
  'd-freeze-b': ' [変わりうる: B の既存のフリーズの位置]',
  'g-short-middle': ' [変わりうる: 両端の窓のぶつかり]',
  'j-subframe': ' [変わりうる: 1 コマ未満の窓]',
  'k-no-head': ' [変わりうる: 効かない境目の宣言]'
};

for (const c of cases) {
  const difference = c.id === 'd-freeze-a' ? ' 生の経路と投影済みの経路で違う' : '';
  test(`${c.id}${difference}${marks[c.id] ?? ''}`, () => {
    const edit = makeEdit(c);
    const internal = readInternalEdit(edit);
    const items = internal.tracks[0].items;
    const cuts = items.filter(item => item.legacy.collection === 'cuts');
    const declarations = cuts.map(item => normalizeTransition(item.declaration));
    const rawCuts = projectLegacyEdit(internal).cuts.map(normalizeTransition);
    const sourcePathById = new Map(edit.sources.map(source => [source.id, source.path]));
    const projected = buildTimelineMap(declarations, { fps: c.fps });
    const raw = buildTimelineMap(rawCuts, {
      fps: c.fps,
      handleRoom: index => isStillImageSourcePath(sourcePathById.get(rawCuts[index]?.src))
        ? { tailSeconds: Infinity, headSeconds: Infinity } : undefined
    });
    assert.deepEqual(items.map(item => [item.id, item.legacy.collection]), c.expected.collections);
    assert.deepEqual(cuts.map(item => ({
      id: item.id, at: round(item.declaration.at), in: round(item.declaration.in), out: round(item.declaration.out),
      ...(item.declaration.speed !== undefined ? { speed: round(item.declaration.speed) } : {}),
      ...(item.declaration.transition_out ? { transition_out: {
        ...item.declaration.transition_out, duration: round(item.declaration.transition_out.duration)
      } } : {}),
      ...(item.declaration.freeze ? { freeze: item.declaration.freeze } : {})
    })), c.expected.declarations);
    assert.deepEqual(items.map(item => ({
      id: item.id, at: round(item.at), duration: round(item.duration),
      in: round(item.source.in), out: round(item.source.out)
    })), c.expected.rawItems);
    assert.deepEqual(rawCuts.map(cut => ({ at: round(cut.at), in: round(cut.in), out: round(cut.out) })), c.expected.rawCuts);
    assert.deepEqual(comparableMap(projected), c.expected.projected);
    assert.deepEqual(comparableMap(raw), c.expected.raw);
    if (c.id === 'k-no-head') assert.equal('transition_out' in cuts[0].declaration, false);
  });
}

test('e-implicit-at: 生の cuts 経路の旧省略形', () => {
  const map = buildTimelineMap([
    { in: 2, out: 6, transitionOut: { type: 'dissolve', duration: 0.5 } },
    { in: 2, out: 6 }
  ], { fps: 30 });
  assert.deepEqual(comparableMap(map), {
    windows: [{ start: 3.5, end: 4, duration: 0.5, type: 'dissolve',
      outgoing: { in: 5.5, out: 6 }, incoming: { in: 2, out: 2.5 } }],
    totalDuration: 7.5,
    segments: [
      { kind: 'src', cutIndex: 0, outStart: 0, outEnd: 4, in: 2, out: 6 },
      { kind: 'src', cutIndex: 1, outStart: 4, outEnd: 7.5, in: 2.5, out: 6 }
    ]
  });
});

test('i-subframe-adjacency: 生の cuts 経路 [変わりうる: 1 コマ未満ずれた隣り合い]', () => {
  const map = buildTimelineMap([
    { at: 0, in: 0, out: 3.99, transitionOut: { type: 'dissolve', duration: 0.5 } },
    { at: 4, in: 2, out: 6 }
  ], { fps: 30 });
  assert.deepEqual(comparableMap(map), {
    windows: [{ start: 3.75, end: 4.25, duration: 0.5, type: 'dissolve',
      outgoing: { in: 3.75, out: 4.25 }, incoming: { in: 1.75, out: 2.25 } }],
    totalDuration: 8,
    segments: [
      { kind: 'src', cutIndex: 0, outStart: 0, outEnd: 4.25, in: 0, out: 4.25 },
      { kind: 'src', cutIndex: 1, outStart: 4.25, outEnd: 8, in: 2.25, out: 6 }
    ]
  });
});

test('i-subframe-overlap: 生の cuts 経路 [変わりうる: 1 コマ未満ずれた隣り合い]', () => {
  const map = buildTimelineMap([
    { at: 0, in: 0, out: 4.01, transitionOut: { type: 'dissolve', duration: 0.5 } },
    { at: 4, in: 2, out: 6 }
  ], { fps: 30 });
  assert.deepEqual(comparableMap(map), {
    windows: [{ start: 3.75, end: 4.25, duration: 0.5, type: 'dissolve',
      outgoing: { in: 3.75, out: 4.25 }, incoming: { in: 1.75, out: 2.25 } }],
    totalDuration: 8,
    segments: [
      { kind: 'src', cutIndex: 0, outStart: 0, outEnd: 4.25, in: 0, out: 4.25 },
      { kind: 'src', cutIndex: 1, outStart: 4.25, outEnd: 8, in: 2.25, out: 6 }
    ]
  });
});

test('60fps の 1 コマ窓を 60fps と既定 30fps で読む [変わりうる: 1 コマ未満の窓]', () => {
  const edit = makeEdit({ fps: 60, items: [
    { id: 'a', at: 0, duration: 240, in: 2, out: 6, transition: 0.016666666666666666 },
    { id: 'b', at: 240, duration: 240, in: 2, out: 6 }
  ] });
  const declarations = readInternalEdit(edit).tracks[0].items.map(item => normalizeTransition(item.declaration));
  assert.deepEqual(declarations.map(cut => ({ at: round(cut.at), in: round(cut.in), out: round(cut.out) })), [
    { at: 0, in: 2, out: 6.008333333 },
    { at: 3.991666667, in: 1.991666667, out: 6 }
  ]);
  assert.deepEqual(comparableMap(buildTimelineMap(declarations, { fps: 60 })), {
    windows: [{ start: 3.991666667, end: 4.008333333, duration: 0.016666667, type: 'dissolve',
      outgoing: { in: 5.991666667, out: 6.008333333 },
      incoming: { in: 1.991666667, out: 2.008333333 } }],
    totalDuration: 8,
    segments: [
      { kind: 'src', cutIndex: 0, outStart: 0, outEnd: 4.008333333, in: 2, out: 6.008333333 },
      { kind: 'src', cutIndex: 1, outStart: 4.008333333, outEnd: 8, in: 2.008333333, out: 6 }
    ]
  });
  assert.deepEqual(comparableMap(buildTimelineMap(declarations)), {
    windows: [],
    totalDuration: 8,
    segments: [
      { kind: 'src', cutIndex: 0, outStart: 0, outEnd: 4.008333333, in: 2, out: 6.008333333 },
      { kind: 'src', cutIndex: 1, outStart: 4.008333333, outEnd: 8, in: 2.008333333, out: 6 }
    ]
  });
});

test('共通の中央 2 件の窓と素材時刻に一致する', () => {
  for (const [id, outgoing, incoming] of [
    ['a-center', [5.5, 6, 6.5], [2.5, 3, 3.5]],
    ['b-speed-both', [9, 10, 11], [2.75, 3, 3.25]]
  ]) {
    const c = cases.find(candidate => candidate.id === id);
    const declarations = readInternalEdit(makeEdit(c)).tracks[0].items.map(item => normalizeTransition(item.declaration));
    const actual = comparableMap(buildTimelineMap(declarations, { fps: c.fps })).windows[0];
    assert.deepEqual([actual.start, actual.end], [3.5, 4.5]);
    assert.deepEqual([actual.outgoing.in, (actual.outgoing.in + actual.outgoing.out) / 2, actual.outgoing.out], outgoing);
    assert.deepEqual([actual.incoming.in, (actual.incoming.in + actual.incoming.out) / 2, actual.incoming.out], incoming);
  }
});
