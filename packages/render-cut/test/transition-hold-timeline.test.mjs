import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  computeCutTimelineInputs, computeCutTimelineOffsets, effectiveTransitionDurations,
  needsGapAwareCutTimeline, resolveCutSegments,
} from '../src/cut-timeline.mjs';
import { collectDeclaredFadeWindows } from '../src/verify-blank.mjs';
import { captionDisplayEdit as renderCaptionDisplayEdit } from '../src/caption-resolve.mjs';
import { captionDisplayEdit as lintCaptionDisplayEdit } from '../../edit-lint/src/lint/captions.mjs';
import { readInternalEdit } from '../../edit-store/lib/index.js';

const cases = JSON.parse(readFileSync(new URL('../../edit-store/test/transition-plan-cases.json', import.meta.url), 'utf8')).hold;
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} != ${expected}`);

function projected(entry) {
  return entry.expected.projected.map((expected, index) => ({
    id: `c${index}`, src: entry.cuts[index].src, at: expected.at,
    in: expected.in, out: expected.out,
    ...(entry.cuts[index].speed ? { speed: entry.cuts[index].speed } : {}),
    ...(entry.cuts[index].freeze ? { freeze: entry.cuts[index].freeze } : {}),
    ...(expected.transitionSeconds ? { transition_out: { type: 'dissolve', duration: expected.transitionSeconds } } : {}),
    ...(expected.hold ? { transitionHold: { headSeconds: expected.hold } } : {}),
  }));
}

function projectedCuts(entry, fill) {
  const frames = seconds => Math.round(seconds * entry.fps);
  const document = {
    version: 2, output: { width: 320, height: 180, fps: entry.fps },
    sources: [...new Set(entry.cuts.map(cut => cut.src))].map(id => ({ id, path: `${id}.mp4` })),
    tracks: [{ id: 'main', lane: 'visual', items: entry.cuts.map((cut, index) => ({
      id: `c${index + 1}`, at: frames(cut.at),
      duration: frames((cut.out - cut.in) / (cut.speed ?? 1) + (cut.freeze?.duration_sec ?? 0)),
      source: { kind: 'media', src: cut.src, in: cut.in, out: cut.out,
        ...(cut.speed ? { speed: cut.speed } : {}),
        ...(cut.freeze ? { freeze: cut.freeze } : {}),
        ...(cut.transitionOut ? { transition_out: fill ? cut.transitionOut
          : { ...cut.transitionOut, fill: undefined } } : {}) }
    })) }]
  };
  return readInternalEdit(document).tracks[0].items.map(item => item.declaration);
}

for (const entry of cases) {
  test(`cut timeline preserves raw ends with and without fill: ${entry.name}`, () => {
    for (const fill of [true, false]) {
      const cuts = projectedCuts(entry, fill);
      const offsets = computeCutTimelineOffsets(cuts);
      for (let index = 1; index < entry.cuts.length; index += 1) {
        const raw = entry.cuts[index];
        // Without fill, the projected extension of this cut's own filled boundary may differ.
        if (!fill && raw.transitionOut?.fill) continue;
        const rawEnd = raw.at + (raw.out - raw.in) / (raw.speed ?? 1)
          + (raw.freeze?.duration_sec ?? 0);
        const extension = raw.transitionOut
          ? (entry.expected.projected[index].out - raw.out) / (raw.speed ?? 1) : 0;
        near(offsets[index].start + offsets[index].duration, rawEnd + extension, `${fill} cut end ${index}`);
      }
      const inputs = computeCutTimelineInputs(cuts);
      const effective = effectiveTransitionDurations(cuts);
      const total = inputs.reduce((sum, input) => sum + input.inputDuration, 0)
        - effective.slice(0, -1).reduce((sum, duration) => sum + duration, 0);
      near(total, entry.expected.totalSeconds, `${fill} total`);
    }
  });

  test(`held cut timeline uses separate media and input clocks: ${entry.name}`, () => {
    const cuts = projected(entry);
    const effective = effectiveTransitionDurations(cuts);
    const offsets = computeCutTimelineOffsets(cuts);
    const inputs = computeCutTimelineInputs(cuts);
    assert.equal(needsGapAwareCutTimeline(cuts), false);
    for (let index = 0; index < cuts.length; index += 1) {
      const expected = entry.expected.projected[index];
      const hold = expected.hold ?? 0;
      near(offsets[index].start, expected.at, `media start ${index}`);
      near(inputs[index].inputStart, expected.at - hold, `input start ${index}`);
      near(inputs[index].inputDuration, entry.expected.sequential.inputSeconds[index], `input duration ${index}`);
      near(inputs[index].holdHeadSeconds, hold, `held head ${index}`);
      // Sequential input duration is displayed media duration plus its held head.
      near(offsets[index].duration + hold, entry.expected.sequential.inputSeconds[index], `duration formula ${index}`);
      if (index < cuts.length - 1) near(effective[index], expected.transitionSeconds, `overlap ${index}`);
    }
    const total = inputs.reduce((sum, input) => sum + input.inputDuration, 0)
      - effective.slice(0, -1).reduce((sum, duration) => sum + duration, 0);
    near(total, entry.expected.sequential.totalSeconds, 'sequential total');
    near(total, entry.expected.totalSeconds, 'output total');
  });
}

test('the full incoming held window remains sequential and keeps the media origin', () => {
  const entry = cases[0];
  const cuts = projected(entry);
  assert.equal(computeCutTimelineOffsets(cuts)[1].start, 4.8);
  assert.equal(computeCutTimelineInputs(cuts)[1].inputStart, 4);
  assert.equal(computeCutTimelineInputs(cuts)[1].inputDuration, 6);
  assert.equal(computeCutTimelineInputs(cuts).reduce((sum, input) => sum + input.inputDuration, 0)
    - effectiveTransitionDurations(cuts)[0], 10);
  const windows = collectDeclaredFadeWindows({ cuts, output: { fps: 30 } });
  assert.deepEqual(windows.filter(window => window.via === 'transition_out:dissolve')
    .map(window => ({ start: window.start, end: window.end })), [{ start: 4, end: 5 }]);

  for (const captionDisplayEdit of [renderCaptionDisplayEdit, lintCaptionDisplayEdit]) {
    const edit = { cuts };
    const normalized = captionDisplayEdit(edit);
    assert.equal(normalized.cuts[1].at, 4.8);
    // Source time 1.0 maps from B's media origin 4.8 and source in 0.
    near(computeCutTimelineOffsets(normalized.cuts)[1].start + (1 - normalized.cuts[1].in), 5.8,
      'caption source position');
  }
});

test('unheld explicit placements retain their existing values and object shape', () => {
  const cuts = [
    { at: 0, in: 0, out: 5, transition_out: { type: 'dissolve', duration: 1 } },
    { at: 4.5, in: 0, out: 5 },
  ];
  assert.deepEqual(effectiveTransitionDurations(cuts), [0.5, 0]);
  assert.equal(needsGapAwareCutTimeline(cuts), false);
  assert.deepEqual(computeCutTimelineOffsets(cuts), [
    { start: 0, duration: 5 }, { start: 4.5, duration: 5 },
  ]);
  assert.deepEqual(resolveCutSegments(cuts).map(segment => segment.start), [0, 4.5]);
});

test('the gap-aware path leaves a held cut at its media placement', () => {
  const cuts = projected(cases[0]);
  cuts[1].track = 1;
  assert.equal(needsGapAwareCutTimeline(cuts), true);
  near(resolveCutSegments(cuts)[1].start, 4.8, 'gap-aware media start');
});
