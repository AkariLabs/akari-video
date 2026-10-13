import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildTimelineMap, buildWebAudioSchedule, projectSpeechDeclarations } from '../lib/index.js';

const cases = JSON.parse(fs.readFileSync(new URL('./transition-plan-cases.json', import.meta.url), 'utf8')).timeline;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
// Set to true when visual timeline projection supports align.
const ALIGN_PROJECTION_READY = true;
const alignedCase = cases.find(example => example.cuts[0].transitionOut.align);
const alignedWindow = buildTimelineMap(alignedCase.cuts, { fps: alignedCase.fps }).transitionWindows[0];
const alignProjectionActive = Math.abs(alignedWindow.start - 3.5) > 1e-8
  || Math.abs(alignedWindow.end - 4.5) > 1e-8;

function gainAt(item, timelineSec) {
  const offset = timelineSec - item.timelineStartSec;
  const events = item.gainEvents;
  for (let i = 1; i < events.length; i += 1) {
    if (offset <= events[i].offsetSec) {
      const before = events[i - 1];
      const after = events[i];
      return before.value + (after.value - before.value)
        * (offset - before.offsetSec) / (after.offsetSec - before.offsetSec);
    }
  }
  return events[events.length - 1].value;
}

function projectedCuts(example) {
  const [a, b] = example.cuts.map((cut, index) => ({ ...cut, id: index ? 'b' : 'a' }));
  const window = example.expected.window;
  const before = 4 - window.start;
  const after = window.end - 4;
  const speedA = a.speed ?? 1;
  const speedB = b.speed ?? 1;
  return [
    { ...a, out: a.out + after * speedA,
      transitionOut: { type: a.transitionOut.type, duration: window.end - window.start } },
    { ...b, at: b.at - before, in: b.in - before * speedB },
  ];
}

function checkAudio(cuts, example) {
  const declarations = projectSpeechDeclarations(cuts, { fps: example.fps });
  const a = declarations.find(item => item.id === 'a-speech');
  const b = declarations.find(item => item.id === 'b-speech');
  assert.ok(a && b);
  const expected = example.expected.audio;
  close(a.atSec + a.durationSec, expected.outgoingEnd);
  close(b.atSec - (b.fadeInAtStart ? 0 : b.crossfadeInSec), expected.incomingStart);
  close(a.atSec + a.durationSec - a.crossfadeOutSec, expected.fadeStart);
  close(b.atSec - (b.fadeInAtStart ? 0 : b.crossfadeInSec) + b.crossfadeInSec, expected.fadeEnd);
  const plan = buildWebAudioSchedule({ timelineDurationSec: 9, startAtSec: 0, audio: { speech: declarations } });
  assert.deepEqual(plan.warnings, []);
  const scheduledA = plan.items.find(item => item.id === 'a-speech');
  const scheduledB = plan.items.find(item => item.id === 'b-speech');
  close(scheduledA.timelineEndSec, expected.outgoingEnd);
  close(scheduledB.timelineStartSec, expected.incomingStart);
  close(scheduledA.gainEvents.find(event => event.offsetSec === expected.fadeStart - scheduledA.timelineStartSec).value, 1);
  close(scheduledA.gainEvents.find(event => event.offsetSec === expected.fadeEnd - scheduledA.timelineStartSec).value, 0);
  close(scheduledB.gainEvents[0].value, 0);
  close(scheduledB.gainEvents.find(event => event.offsetSec === expected.fadeEnd - expected.incomingStart).value, 1);
  for (const progress of [0.25, 0.75]) {
    const t = expected.fadeStart + (expected.fadeEnd - expected.fadeStart) * progress;
    const seek = buildWebAudioSchedule({ timelineDurationSec: 9, startAtSec: t,
      audio: { speech: declarations } });
    for (const [id, expectedGain] of [['a-speech', 1 - progress], ['b-speech', progress]]) {
      const fromStart = plan.items.find(item => item.id === id);
      const fromSeek = seek.items.find(item => item.id === id);
      assert.ok(fromStart && fromSeek);
      close(gainAt(fromStart, t), expectedGain);
      close(fromSeek.gainEvents[0].value, expectedGain);
      close(gainAt(fromStart, t), fromSeek.gainEvents[0].value);
    }
  }
}

for (const example of cases) {
  test(`${example.name}: projected audio follows the hand-computed window`, () => {
    checkAudio(projectedCuts(example), example);
  });
  test(`${example.name}: raw audio follows the timeline-map window`, t => {
    if (example.cuts[0].transitionOut.align && !ALIGN_PROJECTION_READY && !alignProjectionActive) {
      t.skip('timeline-map does not honor transition_out.align yet');
      return;
    }
    const window = buildTimelineMap(example.cuts, { fps: example.fps }).transitionWindows[0];
    const expected = example.expected.window;
    if (Math.abs(window.start - expected.start) < 1e-8 && Math.abs(window.end - expected.end) < 1e-8) {
      checkAudio(example.cuts.map((cut, index) => ({ ...cut, id: index ? 'b' : 'a' })), example);
      return;
    }
    assert.fail(`unexpected raw window ${window.start}..${window.end}`);
  });
}

test('an incoming clip wholly inside the window retains speech and seek gain', () => {
  const speech = projectSpeechDeclarations([
    { id: 'a', src: 'a', at: 0, in: 0, out: 5, transitionOut: { type: 'dissolve', duration: 1 } },
    { id: 'b', src: 'b', at: 4, in: 0, out: 1 },
  ], { fps: 30 });
  const b = speech.find(item => item.id === 'b-speech');
  assert.ok(b);
  close(b.atSec, 4);
  close(b.durationSec, 1);
  assert.equal(b.fadeInAtStart, true);
  const full = buildWebAudioSchedule({ timelineDurationSec: 5, startAtSec: 0, audio: { speech } });
  const seek = buildWebAudioSchedule({ timelineDurationSec: 5, startAtSec: 4.5, audio: { speech } });
  const fullB = full.items.find(item => item.id === 'b-speech');
  const seekB = seek.items.find(item => item.id === 'b-speech');
  close(fullB.gainEvents[0].value, 0);
  close(fullB.gainEvents[1].value, 1);
  close(seekB.gainEvents[0].value, 0.5);
  close(seekB.timelineStartSec, 4.5);
});

test('a frozen short incoming clip has no restored sound during its hold', () => {
  const speech = projectSpeechDeclarations([
    { id: 'a', src: 'a', at: 0, in: 0, out: 5,
      transition_out: { type: 'dissolve', duration: 1 } },
    { id: 'b', src: 'b', at: 4, in: 2, out: 2.5,
      freeze: { at_sec: 0, duration_sec: 0.5 } },
  ], { fps: 30 });
  assert.ok(speech.every(item => item.id !== 'b-speech'
    && (item.id.indexOf('b-speech-') !== 0
      || item.atSec >= 4.5 || item.atSec + item.durationSec <= 4)));
});

test('rounded adjacent cuts retain the incoming source position and end', () => {
  const speech = projectSpeechDeclarations([
    { id: 'a', src: 'a', at: 0, in: 0, out: 4,
      transition_out: { type: 'dissolve', duration: 1 } },
    { id: 'b', src: 'b', at: 4.01, in: 2, out: 6 },
  ], { fps: 30 });
  const b = speech.find(item => item.id === 'b-speech');
  assert.ok(b);
  close(b.atSec, 4.51);
  close(b.durationSec, 3.5);
  close(b.inSec, 2.5);
  close(b.outSec, 6);
});

test('overlapping speech fades have the same gain during playback and after a seek', () => {
  const speech = projectSpeechDeclarations([
    { id: 'a', src: 'a', at: 0, in: 0, out: 5,
      transition_out: { type: 'dissolve', duration: 1 } },
    { id: 'b', src: 'b', at: 4, in: 2, out: 3,
      transition_out: { type: 'dissolve', duration: 0.5 } },
    { id: 'c', src: 'c', at: 4.5, in: 2, out: 6 },
  ], { fps: 30 });
  const full = buildWebAudioSchedule({ timelineDurationSec: 8, startAtSec: 0,
    audio: { speech } }).items.find(item => item.id === 'b-speech');
  const seek = buildWebAudioSchedule({ timelineDurationSec: 8, startAtSec: 4.75,
    audio: { speech } }).items.find(item => item.id === 'b-speech');
  assert.ok(full && seek);
  close(gainAt(full, 4.75), seek.gainEvents[0].value);
  close(gainAt(full, 4.75), 0.5);
});

test('a clamped speed-two sidecar uses its actual source start after seeking', () => {
  const speech = [{ id: 'fast', src: 'fast', atSec: 0, durationSec: 1,
    inSec: 0.25, outSec: 2.25, speed: 2, materialDurationSec: 4,
    sidecar: { path: 'fast.pcm', durationSec: 1.625, padBeforeSec: 2,
      padAfterSec: 1, actualStartSeconds: 0 } }];
  const atStart = buildWebAudioSchedule({ timelineDurationSec: 1, startAtSec: 0, audio: { speech } });
  const afterSeek = buildWebAudioSchedule({ timelineDurationSec: 1, startAtSec: 0.5, audio: { speech } });
  close(atStart.items[0].sourceOffsetSec, 0.125);
  close(afterSeek.items[0].sourceOffsetSec, 0.625);
});

test('insufficient source head delays playback while preserving source position and window gain', () => {
  const base = { id: 'b', src: 'b', atSec: 4, durationSec: 2,
    inSec: 0.2, outSec: 4.2, speed: 2, materialDurationSec: 10,
    crossfadeInSec: 0.5, padBeforeSec: 0.5 };
  for (const [name, declaration, offsets] of [
    ['source', base, [0, 0, 0.2, 1.2]],
    ['sidecar', { ...base, sidecar: { path: 's.pcm', durationSec: 2.1,
      padBeforeSec: 1, padAfterSec: 0, actualStartSeconds: 0 } }, [0, 0, 0.1, 0.6]],
  ]) {
    for (const [index, startAtSec] of [0, 3.75, 4, 4.5].entries()) {
      const item = buildWebAudioSchedule({ timelineDurationSec: 7, startAtSec,
        audio: { speech: [declaration] } }).items[0];
      assert.ok(item, `${name} at ${startAtSec}`);
      close(item.timelineStartSec, [3.9, 3.9, 4, 4.5][index]);
      close(item.sourceOffsetSec, offsets[index]);
      close(item.gainEvents[0].value, [0.8, 0.8, 1, 1][index]);
      if (index < 2) close(gainAt(item, 4), 1);
    }
  }
});

test('a frozen outgoing clip reaches the window end in raw and projected cuts', () => {
  const raw = [
    { id: 'a', src: 'a', at: 0, in: 1, out: 4,
      freeze: { at_sec: 1, duration_sec: 1 }, transitionOut: { type: 'dissolve', duration: 0.5 } },
    { id: 'b', src: 'b', at: 4, in: 2, out: 6 },
  ];
  const projected = [
    { ...raw[0], out: 4.25 },
    { ...raw[1], at: 3.75, in: 1.75 },
  ];
  const pick = cuts => projectSpeechDeclarations(cuts, { fps: 30 })
    .filter(item => item.id === 'a-speech-post' || item.id === 'b-speech');
  const expected = pick(projected);
  assert.deepEqual(pick(raw), expected);
  const post = expected.find(item => item.id === 'a-speech-post');
  close(post.atSec, 2);
  close(post.durationSec, 2.25);
  close(post.outSec, 4.25);
  close(post.crossfadeOutSec, 0.5);
});

test('a wholly covered middle clip retains its declaration in clip order', () => {
  const raw = [
    { id: 'a', src: 'a', at: 0, in: 0, out: 4.1,
      transitionOut: { type: 'dissolve', duration: 0.2 } },
    { id: 'b', src: 'b', at: 4.1, in: 0.1, out: 0.2 },
    { id: 'c', src: 'c', at: 4.2, in: 1, out: 2 },
  ];
  const projected = [
    { ...raw[0], out: 4.2 },
    { ...raw[1], at: 4.0, in: 0.0 },
    raw[2],
  ];
  for (const cuts of [raw, projected]) {
    const speech = projectSpeechDeclarations(cuts, { fps: 30 });
    assert.deepEqual(speech.map(item => item.id), ['a-speech', 'b-speech', 'c-speech']);
    const a = speech[0];
    const b = speech[1];
    close(a.atSec + a.durationSec, 4.2);
    close(a.crossfadeOutSec, 0.2);
    close(b.atSec, 4.0);
    close(b.atSec + b.durationSec, 4.2);
    close(b.crossfadeInSec, 0.2);
    close(b.inSec, 0);
    close(b.outSec, 0.2);
  }
});
