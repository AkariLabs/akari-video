import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildTimelineMap, outputToSource, readInternalEdit } from '../lib/index.js';

const cases = JSON.parse(readFileSync(new URL('./transition-plan-cases.json', import.meta.url), 'utf8')).hold;
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} != ${expected}`);
const frames = (seconds, fps) => Math.round(seconds * fps);
const projectedCuts = entry => {
  const document = {
    version: 2, output: { width: 320, height: 180, fps: entry.fps },
    sources: [...new Set(entry.cuts.map(cut => cut.src))].map(id => ({ id, path: `${id}.mp4` })),
    tracks: [{ id: 'main', lane: 'visual', items: entry.cuts.map((cut, index) => ({
      id: `c${index + 1}`, at: frames(cut.at, entry.fps),
      duration: frames((cut.out - cut.in) / (cut.speed ?? 1) + (cut.freeze?.duration_sec ?? 0), entry.fps),
      source: { kind: 'media', src: cut.src, in: cut.in, out: cut.out,
        ...(cut.speed ? { speed: cut.speed } : {}),
        ...(cut.freeze ? { freeze: cut.freeze } : {}),
        ...(cut.transitionOut ? { transition_out: cut.transitionOut } : {}) }
    })) }]
  };
  return readInternalEdit(document).tracks[0].items.map(item => ({
    ...item.declaration, transitionOut: item.declaration.transition_out
  }));
};

for (const entry of cases) {
  test(`hold window and participant from raw and projected cuts: ${entry.name}`, () => {
    const projected = projectedCuts(entry);
    for (const [label, cuts] of [['raw', entry.cuts], ['projected', projected]]) {
      const map = buildTimelineMap(cuts, { fps: entry.fps });
      // The map's ordinary segments do not include an existing clip freeze.
      const existingFreeze = entry.cuts[entry.cuts.length - 1].freeze?.duration_sec ?? 0;
      near(map.totalDuration, entry.expected.totalSeconds - existingFreeze, `${label} total`);
      assert.equal(map.transitionWindows.length, entry.expected.windows.length, `${label} window count`);
      entry.expected.windows.forEach((expected, index) => {
        const window = map.transitionWindows[index];
        const laterIndex = index + 1;
        const later = entry.expected.projected[laterIndex];
        const speed = entry.cuts[laterIndex].speed ?? 1;
        const hold = later.hold ?? 0;
        near(window.start, expected.start, `${label} start ${index}`);
        near(window.end, expected.end, `${label} end ${index}`);
        near(window.incoming.outStart, expected.start, `${label} incoming start ${index}`);
        near(window.incoming.outEnd, expected.end, `${label} incoming end ${index}`);
        near(window.incoming.in, later.in, `${label} incoming in ${index}`);
        // The first h seconds are held; the remaining window advances at the clip speed.
        near(window.incoming.out, later.in + Math.max(0, expected.end - expected.start - hold) * speed,
          `${label} incoming out ${index}`);
        if (hold > 0) near(window.incoming.holdHeadSeconds, hold, `${label} hold ${index}`);
        else assert.equal(Object.prototype.hasOwnProperty.call(window.incoming, 'holdHeadSeconds'), false);
      });
      for (const sample of entry.expected.samples) {
        const window = map.transitionWindows.find(candidate => sample.t >= candidate.start - 1e-9
          && sample.t <= candidate.end + 1e-9);
        assert.ok(window, `${label} sample window ${sample.t}`);
        near(window.outgoing.in + (sample.t - window.outgoing.outStart) * window.outgoing.speed,
          sample.outgoing, `${label} outgoing ${sample.t}`);
        near(window.incoming.in + Math.max(0, sample.t - window.incoming.outStart
          - (window.incoming.holdHeadSeconds ?? 0)) * window.incoming.speed,
        sample.incoming, `${label} incoming ${sample.t}`);
      }
      if (label === 'projected') {
        for (const window of map.transitionWindows) {
          for (const key of ['cutSeconds', 'effectiveSeconds', 'state', 'reasons', 'freezeIncomingSeconds']) {
            assert.equal(Object.prototype.hasOwnProperty.call(window, key), false,
              `${entry.name}: projected window must not be planned again (${key})`);
          }
        }
      }
    }
    const withoutFill = entry.cuts.map(cut => ({ ...cut,
      ...(cut.transitionOut ? { transitionOut: { ...cut.transitionOut, fill: undefined } } : {}) }));
    const raw = buildTimelineMap(entry.cuts, { fps: entry.fps });
    const plain = buildTimelineMap(withoutFill, { fps: entry.fps });
    near(raw.totalDuration, plain.totalDuration, 'raw total with and without fill');
    const bEnd = map => Math.max(...map.segments.filter(segment => segment.cutIndex === 1)
      .map(segment => segment.outEnd));
    near(bEnd(raw), bEnd(plain), 'incoming raw clip end');
    const last = entry.cuts.length - 1;
    near(raw.segments.filter(segment => segment.cutIndex === last).slice(-1)[0].outEnd,
      plain.segments.filter(segment => segment.cutIndex === last).slice(-1)[0].outEnd, 'last raw clip end');
    for (const t of [0, raw.totalDuration - 0.1]) {
      const filledSource = outputToSource(raw.segments, t);
      const plainSource = outputToSource(plain.segments, t);
      assert.equal(filledSource.segment?.cutIndex, plainSource.segment?.cutIndex);
      near(filledSource.sourceT, plainSource.sourceT, `raw source at ${t}`);
    }
  });
}

test('a sub-microsecond held head remains part of an existing projected window', () => {
  const hold = 1e-7;
  const cuts = [
    { at: 0, in: 2, out: 7, src: 'a', transitionOut: { type: 'dissolve', duration: 1 } },
    { at: 4 + hold, in: 0, out: 5, src: 'b', transitionHold: { headSeconds: hold } },
  ];
  const map = buildTimelineMap(cuts, { fps: 30 });
  assert.equal(map.transitionWindows.length, 1);
  near(map.transitionWindows[0].start, 4, 'held window start');
  near(map.transitionWindows[0].incoming.holdHeadSeconds, hold, 'small hold');
  near(map.segments.filter(segment => segment.cutIndex === 1).slice(-1)[0].outEnd, 9 + hold,
    'ordinary clip end');
});
