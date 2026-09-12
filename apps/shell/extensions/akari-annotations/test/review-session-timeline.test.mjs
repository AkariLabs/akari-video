import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeUtteranceIndex,
  resolveSessionTimelineT,
  sessionRecDurationSec
} from '../lib/browser/review-session-timeline.js';

const events = [
  { recT: 0, type: 'start', timelineT: 10, playing: false },
  { recT: 1, type: 'play', timelineT: 10 },
  { recT: 2, type: 'rate', value: 2 },
  { recT: 3, type: 'tick', timelineT: 13 },
  { recT: 4, type: 'pause', timelineT: 15 },
  { recT: 5, type: 'seek', to: 30 },
  { recT: 6, type: 'play' },
  { recT: 7, type: 'end', timelineT: 32 }
];

test('resolves stopped, playing, rate, tick, pause, seek, and end anchors', () => {
  assert.equal(resolveSessionTimelineT(events, 0.5), 10);
  assert.equal(resolveSessionTimelineT(events, 1.5), 10.5);
  assert.equal(resolveSessionTimelineT(events, 2.5), 12);
  assert.equal(resolveSessionTimelineT(events, 3.5), 14);
  assert.equal(resolveSessionTimelineT(events, 4.5), 15);
  assert.equal(resolveSessionTimelineT(events, 5.5), 30);
  assert.equal(resolveSessionTimelineT(events, 6.5), 31);
  assert.equal(resolveSessionTimelineT(events, 8), 32);
});

test('returns null before start and tolerates damaged or unknown events', () => {
  const damaged = [
    { recT: Number.NaN, type: 'play', timelineT: 99 },
    { recT: 1, type: 'unknown', timelineT: 99 },
    { recT: 2, type: 'start', timelineT: Number.NaN, playing: true },
    { recT: 3, type: 'start', timelineT: 4, playing: true },
    { recT: 4, type: 'tick', timelineT: Number.NaN }
  ];
  assert.equal(resolveSessionTimelineT(damaged, 2.9), null);
  assert.equal(resolveSessionTimelineT(damaged, 5), 6);
});

test('reports recording duration and utterance context through gaps', () => {
  assert.equal(sessionRecDurationSec(events), 7);
  const segments = [{ start: 1, end: 2 }, { start: 3, end: 4 }];
  assert.equal(activeUtteranceIndex(segments, 0.5), -1);
  assert.equal(activeUtteranceIndex(segments, 1.5), 0);
  assert.equal(activeUtteranceIndex(segments, 2.5), 0);
  assert.equal(activeUtteranceIndex(segments, 3), 1);
});
