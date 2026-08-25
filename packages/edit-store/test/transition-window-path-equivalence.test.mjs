import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTimelineMap,
  isStillImageSourcePath,
  projectLegacyEdit,
  readInternalEdit,
} from '../lib/index.js';

const makeEdit = ({
  pathA = 'a.mp4',
  pathB = 'b.mp4',
  transitionDuration = 0.5,
  outgoingDuration = 60,
  outgoingOut = 2,
  incomingAt = 60,
  incomingIn = 1,
  incomingOut = 3,
} = {}) => ({
  version: 2,
  output: { width: 1280, height: 720, fps: 30 },
  sources: [{ id: 'a', path: pathA }, { id: 'b', path: pathB }],
  tracks: [{
    id: 'visual-main', lane: 'visual', items: [
      {
        id: 'a', at: 0, duration: outgoingDuration,
        source: {
          kind: 'media', src: 'a', in: 0, out: outgoingOut,
          transition_out: { type: 'dissolve', duration: transitionDuration },
        },
      },
      {
        id: 'b', at: incomingAt, duration: 60,
        source: { kind: 'media', src: 'b', in: incomingIn, out: incomingOut },
      },
    ],
  }],
});

const normalizeTransition = cut => {
  const { transition_out: snake, transitionOut: camel, ...rest } = cut;
  const transitionOut = camel ?? snake;
  return { ...rest, ...(transitionOut ? { transitionOut } : {}) };
};

const comparableMap = map => ({
  transitionWindows: map.transitionWindows,
  segments: map.segments,
  totalDuration: map.totalDuration,
});

const comparePaths = edit => {
  const internal = readInternalEdit(edit);
  const sourcePathById = new Map(edit.sources.map(source => [source.id, source.path]));
  const rawCuts = projectLegacyEdit(internal).cuts.map(normalizeTransition);
  const declarationCuts = internal.tracks
    .flatMap(track => track.items)
    .filter(item => item.legacy.collection === 'cuts')
    .sort((left, right) => left.legacy.index - right.legacy.index)
    .map(item => normalizeTransition(item.declaration));
  const rawMap = buildTimelineMap(rawCuts, {
    fps: edit.output.fps,
    handleRoom: cutIndex => isStillImageSourcePath(sourcePathById.get(rawCuts[cutIndex]?.src))
      ? { tailSeconds: Number.POSITIVE_INFINITY, headSeconds: Number.POSITIVE_INFINITY }
      : undefined,
  });
  const declarationMap = buildTimelineMap(declarationCuts, { fps: edit.output.fps });
  assert.deepEqual(comparableMap(rawMap), comparableMap(declarationMap));
};

test('生 cuts の隠れのりしろ経路と合成済み declaration 経路は 5 態で完全一致する', () => {
  const cases = [
    makeEdit(),
    makeEdit({ pathA: 'a.png', pathB: 'b.png', incomingIn: 0, incomingOut: 2 }),
    makeEdit({ transitionDuration: 1, incomingIn: 0.1, incomingOut: 2.1 }),
    makeEdit({ transitionDuration: 1, incomingIn: 0, incomingOut: 2 }),
    makeEdit({ incomingAt: 45 }),
  ];
  for (const edit of cases) comparePaths(edit);
});
