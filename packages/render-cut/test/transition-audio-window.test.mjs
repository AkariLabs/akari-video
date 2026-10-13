import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMultiSourceAudioCutCommand, predictedDuration } from '../src/plan.mjs';
import { needsGapAwareCutTimeline, segmentDuration } from '../src/cut-timeline.mjs';

const placements = [
  { name: 'before-cut', before: 1, after: 0, lengths: [4, 5, 5], windows: [[3, 4], [7, 8]],
    sources: [[2, 6], [2, 7], [2, 7]] },
  { name: 'center', before: 0.5, after: 0.5, lengths: [4.5, 5, 4.5], windows: [[3.5, 4.5], [7.5, 8.5]],
    sources: [[2, 6.5], [2.5, 7.5], [2.5, 7]] },
  { name: 'after-cut', before: 0, after: 1, lengths: [5, 5, 4], windows: [[4, 5], [8, 9]],
    sources: [[2, 7], [3, 8], [3, 7]] },
];

function commandFor(cuts) {
  return buildMultiSourceAudioCutCommand({
    sourceInputs: ['a', 'b', 'c'].map((id, index) => ({ id, path: `${id}.wav`, hasAudio: true, inputIndex: index })),
    cuts, cutPath: 'audio.mp4', duration: 12, ffmpegCommand: 'ffmpeg', ffprobeCommand: null,
  });
}

function sourceRanges(command, count) {
  const graph = command.args[command.args.indexOf('-filter_complex') + 1];
  const seeks = [];
  for (let index = 0; index < command.args.length; index += 1) {
    if (command.args[index] === '-i') {
      assert.equal(command.args[index - 4], '-ss');
      assert.equal(command.args[index - 2], '-t');
      seeks.push(Number(command.args[index - 3]));
    }
  }
  assert.equal(seeks.length, count);
  return seeks.map((seek, index) => {
    const match = graph.match(new RegExp(`\\[${index}:a\\]atrim=start=([\\d.]+):end=([\\d.]+)`));
    assert.ok(match, `missing input ${index} trim`);
    return [seek + Number(match[1]), seek + Number(match[2])];
  });
}

for (const placement of placements) {
  test(`${placement.name}: three projected cuts have hand-computed audio inputs and fade windows`, () => {
    const { before, after, lengths, windows, sources } = placement;
    const cuts = [
      { src: 'a', at: 0, in: 2, out: 6 + after, transition_out: { type: 'dissolve', duration: 1 } },
      { src: 'b', at: 4 - before, in: 3 - before, out: 7 + after,
        transition_out: { type: 'dissolve', duration: 1 } },
      { src: 'c', at: 8 - before, in: 3 - before, out: 7 },
    ];
    assert.deepEqual(cuts.map(segmentDuration), lengths);
    assert.equal(needsGapAwareCutTimeline(cuts), false);
    assert.equal(predictedDuration(cuts), 12);
    const command = commandFor(cuts);
    const actualSources = sourceRanges(command, 3);
    for (let index = 0; index < 3; index += 1) {
      for (let edge = 0; edge < 2; edge += 1) {
        assert.ok(Math.abs(actualSources[index][edge] - sources[index][edge]) < 1e-8);
      }
    }
    const graph = command.args[command.args.indexOf('-filter_complex') + 1];
    assert.deepEqual([...graph.matchAll(/apad=whole_dur=([\d.]+)\[a[012]\]/g)].map(match => Number(match[1])), lengths);
    assert.equal((graph.match(/acrossfade=d=1/g) ?? []).length, 2);
    const starts = [0, lengths[0] - 1, lengths[0] + lengths[1] - 2];
    assert.deepEqual(starts, [0, windows[0][0], windows[1][0]]);
    assert.deepEqual(windows.map(([start, end]) => end - start), [1, 1]);
    assert.equal(lengths.reduce((sum, value) => sum + value, 0) - 2, 12);
  });
}

test('center with speed on both clips uses the projected source ranges', () => {
  const cuts = [
    { src: 'a', at: 0, in: 2, out: 11, speed: 2,
      transition_out: { type: 'dissolve', duration: 1 } },
    { src: 'b', at: 3.5, in: 2.75, out: 5, speed: 0.5 },
  ];
  assert.deepEqual(cuts.map(segmentDuration), [4.5, 4.5]);
  assert.equal(predictedDuration(cuts), 8);
  const command = commandFor(cuts);
  const graph = command.args[command.args.indexOf('-filter_complex') + 1];
  assert.deepEqual([...graph.matchAll(/apad=whole_dur=([\d.]+)\[a[01]\]/g)]
    .map(match => Number(match[1])), [4.5, 4.5]);
  assert.match(graph, /acrossfade=d=1\[joineda\]/);
  assert.deepEqual(sourceRanges(command, 2), [[2, 11], [2.75, 5]]);
});

test('removing an ineffective boundary declaration selects sequential audio for a later fade', () => {
  const cuts = [
    { src: 'a', at: 0, in: 0, out: 4, transition_out: { type: 'dissolve', duration: 1 } },
    { src: 'b', at: 4, in: 0, out: 4, transition_out: { type: 'dissolve', duration: 1 } },
    { src: 'c', at: 7, in: 0, out: 4 },
  ];
  assert.equal(needsGapAwareCutTimeline(cuts), true);
  const projected = [{ ...cuts[0], transition_out: undefined }, cuts[1], cuts[2]];
  assert.equal(needsGapAwareCutTimeline(projected), false);
  assert.equal(predictedDuration(projected), 11);
  const graph = commandFor(projected).args;
  const filters = graph[graph.indexOf('-filter_complex') + 1];
  assert.match(filters, /\[a0\]\[a1\]concat=n=2:v=0:a=1\[aacc1\]/);
  assert.match(filters, /\[aacc1\]\[a2\]acrossfade=d=1\[joineda\]/);
});
