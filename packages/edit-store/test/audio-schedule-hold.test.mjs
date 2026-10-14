import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildTimelineMap, buildWebAudioSchedule, projectSpeechDeclarations,
  projectSpeechDeclarationsFromWindows } from '../lib/index.js';

// Set to true when timeline-map widens the window for transitionHold and adds holdHeadSeconds to its participant.
const HOLD_WINDOW_READY = true;
const cases = JSON.parse(fs.readFileSync(new URL('./transition-plan-cases.json', import.meta.url), 'utf8'));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

function sameDeclarations(actual, expected) {
  assert.equal(actual.length, expected.length,
    `declaration count: actual ${actual.length}, expected ${expected.length}`);
  for (let index = 0; index < expected.length; index += 1) {
    const keys = new Set([...Object.keys(actual[index]), ...Object.keys(expected[index])]);
    for (const key of keys) {
      const actualValue = actual[index][key];
      const expectedValue = expected[index][key];
      const message = `declaration ${index} field ${key}: actual ${JSON.stringify(actualValue)}, expected ${JSON.stringify(expectedValue)}`;
      assert.equal(Object.prototype.hasOwnProperty.call(actual[index], key),
        Object.prototype.hasOwnProperty.call(expected[index], key), message);
      if (typeof actualValue === 'number' && typeof expectedValue === 'number') {
        assert.ok(Math.abs(actualValue - expectedValue) < 1e-8, message);
      } else {
        assert.deepEqual(actualValue, expectedValue, message);
      }
    }
  }
}

function projectedCuts(example) {
  return example.expected.projected.map((projection, index) => {
    const original = example.cuts[index];
    return {
      id: String.fromCharCode(97 + index), src: original.src,
      at: projection.at, in: projection.in, out: projection.out,
      ...(original.speed === undefined ? {} : { speed: original.speed }),
      ...(projection.transitionSeconds === undefined ? {} : {
        transitionOut: { type: original.transitionOut.type, duration: projection.transitionSeconds },
      }),
      ...(projection.hold === undefined ? {} : { transitionHold: { headSeconds: projection.hold } }),
      ...(original.freeze === undefined ? {} : {
        freeze: { at_sec: projection.freezeAt ?? original.freeze.at_sec,
          duration_sec: original.freeze.duration_sec },
      }),
    };
  });
}

function manualWindows(example, cuts) {
  return example.expected.windows.map((expected, index) => {
    const a = cuts[index];
    const b = cuts[index + 1];
    const speedA = a.speed ?? 1;
    const speedB = b.speed ?? 1;
    const { start, end } = expected;
    const head = b.transitionHold?.headSeconds ?? 0;
    const outgoing = { kind: 'src', cutIndex: index, outStart: start, outEnd: end,
      in: a.in + (start - a.at) * speedA, out: a.in + (end - a.at) * speedA, speed: speedA };
    const incoming = { kind: 'src', cutIndex: index + 1, outStart: start, outEnd: end,
      in: head > 0 ? b.in : b.in + (start - b.at) * speedB,
      out: b.in + (end - b.at) * speedB, speed: speedB,
      ...(head > 0 ? { holdHeadSeconds: head } : {}) };
    for (const sample of (index === 0 ? example.expected.samples : [])
      .filter(item => Math.abs(item.t - start) < 1e-8)) {
      close(outgoing.in, sample.outgoing);
      close(incoming.in, sample.incoming);
    }
    return { start, end, duration: end - start, type: a.transitionOut.type, outgoing, incoming };
  });
}

function gainAt(item, timelineSec) {
  const offset = timelineSec - item.timelineStartSec;
  const events = item.gainEvents;
  for (let index = 1; index < events.length; index += 1) {
    if (offset <= events[index].offsetSec) {
      const before = events[index - 1];
      const after = events[index];
      return before.value + (after.value - before.value)
        * (offset - before.offsetSec) / (after.offsetSec - before.offsetSec);
    }
  }
  return events[events.length - 1].value;
}

function schedule(declarations, example, startAtSec = 0) {
  const speech = declarations.map(item => ({ ...item, materialDurationSec: 30 }));
  const result = buildWebAudioSchedule({ timelineDurationSec: example.expected.totalSeconds,
    startAtSec, audio: { speech } });
  assert.deepEqual(result.warnings, []);
  return result;
}

function checkAudio(example, declarations) {
  const expected = example.expected.audio;
  const result = schedule(declarations, example);
  const a = result.items.find(item => item.id === 'a-speech');
  const b = result.items.find(item => item.id === 'b-speech' || item.id === 'b-speech-pre');
  assert.ok(a && b, example.name);
  close(a.timelineEndSec, expected.outgoingEnd);
  close(b.timelineStartSec, expected.incomingStart);
  close(b.sourceOffsetSec, expected.incomingSource);
  close(gainAt(b, expected.incomingStart), expected.incomingGainAtStart);
  close(gainAt(b, expected.fadeEnd), 1);
  close(gainAt(a, expected.fadeStart), 1);
  close(gainAt(a, expected.fadeEnd), 0);
  for (const item of result.items.filter(item => item.id.startsWith('b-'))) {
    assert.ok(item.timelineStartSec >= expected.incomingStart - 1e-9,
      `${item.id} starts before incoming audio`);
  }
  const hold = example.expected.projected[1].hold ?? 0;
  if (hold > 0) {
    assert.ok(expected.fadeStart < expected.incomingStart);
    close(expected.incomingStart - expected.fadeStart, hold);
  }
  const midpoint = (Math.max(expected.fadeStart, expected.incomingStart) + expected.fadeEnd) / 2;
  close(gainAt(a, midpoint), (expected.fadeEnd - midpoint) / (expected.fadeEnd - expected.fadeStart));
  if (expected.incomingStart < expected.fadeEnd) {
    close(gainAt(b, midpoint), (midpoint - expected.fadeStart) / (expected.fadeEnd - expected.fadeStart));
  } else {
    close(gainAt(a, (expected.fadeStart + expected.fadeEnd) / 2), 0.5);
  }
  return { a, b };
}

test('sameDeclarations tolerates rounding but catches changed values and missing fields', () => {
  const example = cases.hold[4];
  const cuts = projectedCuts(example);
  const declarations = projectSpeechDeclarationsFromWindows(cuts, { fps: example.fps },
    manualWindows(example, cuts));
  const incoming = declarations.find(item => item.id === 'b-speech');
  assert.ok(incoming && Object.prototype.hasOwnProperty.call(incoming, 'crossfadeInSec'));
  sameDeclarations([{ ...incoming, inSec: incoming.inSec + 5e-17 }], [incoming]);
  assert.throws(() => sameDeclarations([{ ...incoming, atSec: incoming.atSec + 0.01 }], [incoming]),
    /declaration 0 field atSec: actual .* expected /);
  const { crossfadeInSec, ...withoutCrossfade } = incoming;
  assert.throws(() => sameDeclarations([withoutCrossfade], [incoming]),
    /declaration 0 field crossfadeInSec: actual undefined, expected /);
});

for (const [index, example] of cases.hold.entries()) {
  test(`${example.name}: manual window gives the declared audio`, () => {
    const cuts = projectedCuts(example);
    const declarations = projectSpeechDeclarationsFromWindows(cuts, { fps: example.fps },
      manualWindows(example, cuts));
    checkAudio(example, declarations);
    if (index === 4) {
      const b = schedule(declarations, example).items.find(item => item.id === 'b-speech');
      close(b.timelineStartSec, 5);
      close(b.sourceOffsetSec, 0);
      close(gainAt(b, 5), 1);
    }
    if (index === 6) {
      assert.deepEqual(declarations, projectSpeechDeclarations(cuts, { fps: example.fps }));
    }
  });

  if (index === 5) {
    test(`${example.name}: second window keeps B source time and C gain`, () => {
      const cuts = projectedCuts(example);
      const declarations = projectSpeechDeclarationsFromWindows(cuts, { fps: example.fps },
        manualWindows(example, cuts));
      const items = schedule(declarations, example).items;
      const b = items.find(item => item.id === 'b-speech');
      const c = items.find(item => item.id === 'c-speech');
      assert.ok(b && c);
      close(b.timelineStartSec, 4.8);
      close(b.timelineEndSec, 6.5);
      for (const [time, gain] of [[5.5, 1], [6, 0.5], [6.5, 0]]) close(gainAt(b, time), gain);
      close(b.sourceOffsetSec + (6 - b.timelineStartSec) * b.playbackRate, 1.2);
      close(c.timelineStartSec, 5.5);
      close(c.sourceOffsetSec, 1.5);
      for (const [time, gain] of [[5.5, 0], [6, 0.5], [6.5, 1]]) close(gainAt(c, time), gain);
      const seekItems = schedule(declarations, example, 6).items;
      const seekB = seekItems.find(item => item.id === 'b-speech');
      const seekC = seekItems.find(item => item.id === 'c-speech');
      assert.ok(seekB && seekC);
      close(seekB.timelineStartSec, 6);
      close(seekB.sourceOffsetSec, 1.2);
      close(gainAt(seekB, 6), 0.5);
      close(seekC.timelineStartSec, 6);
      close(seekC.sourceOffsetSec, 2);
      close(gainAt(seekC, 6), 0.5);
    });
  }

  if (index === 4) {
    test(`${example.name}: seeking inside and after the entirely held window`, () => {
      const cuts = projectedCuts(example);
      const declarations = projectSpeechDeclarationsFromWindows(cuts, { fps: example.fps },
        manualWindows(example, cuts));
      const middle = schedule(declarations, example, 4.5).items;
      const middleA = middle.find(item => item.id === 'a-speech');
      const middleB = middle.find(item => item.id === 'b-speech');
      assert.ok(middleA && middleB);
      close(middleA.timelineStartSec, 4.5);
      close(gainAt(middleA, 4.5), 0.5);
      close(middleB.timelineStartSec, 5);
      close(middleB.sourceOffsetSec, 0);
      close(gainAt(middleB, 5), 1);
      const afterB = schedule(declarations, example, 5.3).items.find(item => item.id === 'b-speech');
      assert.ok(afterB);
      close(afterB.timelineStartSec, 5.3);
      close(afterB.sourceOffsetSec, 0.3);
      close(gainAt(afterB, 5.3), 1);
    });
  }

  if ([0, 1, 3].includes(index)) {
    test(`${example.name}: seeking retains source position and window gain`, () => {
      const cuts = projectedCuts(example);
      const declarations = projectSpeechDeclarationsFromWindows(cuts, { fps: example.fps },
        manualWindows(example, cuts));
      const expected = example.expected.audio;
      const original = schedule(declarations, example);
      const originalA = original.items.find(item => item.id === 'a-speech');
      const originalB = original.items.find(item => item.id === 'b-speech');
      for (const seekAt of [(expected.fadeStart + expected.incomingStart) / 2,
        expected.incomingStart + 0.05, expected.fadeEnd + 0.3]) {
        const seek = schedule(declarations, example, seekAt);
        const b = seek.items.find(item => item.id === 'b-speech');
        const firstSound = Math.max(expected.incomingStart, seekAt);
        assert.ok(b);
        close(b.timelineStartSec, firstSound);
        close(b.sourceOffsetSec, expected.incomingSource
          + (firstSound - expected.incomingStart) * (cuts[1].speed ?? 1));
        close(gainAt(b, firstSound), gainAt(originalB, firstSound));
        close(gainAt(b, firstSound), firstSound >= expected.fadeEnd ? 1
          : (firstSound - expected.fadeStart) / (expected.fadeEnd - expected.fadeStart));
        const a = seek.items.find(item => item.id === 'a-speech');
        if (a) close(gainAt(a, seekAt), gainAt(originalA, seekAt));
      }
    });
  }

  if ([0, 3].includes(index)) {
    test(`${example.name}: sidecar starts at the first real source sample`, () => {
      const cuts = projectedCuts(example);
      const declarations = projectSpeechDeclarationsFromWindows(cuts, { fps: example.fps },
        manualWindows(example, cuts));
      const speech = declarations.map(item => item.id === 'b-speech' ? { ...item,
        sidecar: { path: 'b.flac', durationSec: 30, padBeforeSec: item.padBeforeSec,
          padAfterSec: 0, actualStartSeconds: 0 } } : item);
      const b = schedule(speech, example).items.find(item => item.id === 'b-speech');
      close(b.timelineStartSec, 4.8);
      close(b.sourceOffsetSec, 0);
      close(gainAt(b, 4.8), 0.8);
      close(b.playbackRate, 1);
      const seek = schedule(speech, example, 4.9).items.find(item => item.id === 'b-speech');
      close(seek.sourceOffsetSec, 0.1);
    });
  }

  test(`${example.name}: timeline-map projection`, t => {
    if (example.expected.projected.some(cut => cut.hold) && !HOLD_WINDOW_READY) {
      t.skip('timeline-map does not widen the window for transitionHold yet');
      return;
    }
    const cuts = projectedCuts(example);
    const projected = projectSpeechDeclarations(cuts, { fps: example.fps });
    const raw = projectSpeechDeclarations(example.cuts.map((cut, cutIndex) => ({
      ...cut, id: String.fromCharCode(97 + cutIndex),
    })), { fps: example.fps });
    if (example.expected.projected.some(cut => cut.hold)) {
      const manual = projectSpeechDeclarationsFromWindows(cuts, { fps: example.fps },
        manualWindows(example, cuts));
      sameDeclarations(projected, manual);
      sameDeclarations(raw, manual);
    }
    checkAudio(example, projected);
    checkAudio(example, raw);
  });
}

test('ordinary projected and raw windows use the same declaration path', () => {
  for (const example of cases.timeline) {
    const windows = buildTimelineMap(example.cuts, { fps: example.fps }).transitionWindows;
    assert.deepEqual(projectSpeechDeclarationsFromWindows(example.cuts, { fps: example.fps }, windows),
      projectSpeechDeclarations(example.cuts, { fps: example.fps }));
  }
  for (const example of [cases.hold[2], cases.hold[6]]) {
    const cuts = projectedCuts(example);
    const windows = buildTimelineMap(cuts, { fps: example.fps }).transitionWindows;
    assert.deepEqual(projectSpeechDeclarationsFromWindows(cuts, { fps: example.fps }, windows),
      projectSpeechDeclarations(cuts, { fps: example.fps }));
  }
});
