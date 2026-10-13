import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AUDIO_SEEK_PREROLL_SECONDS, buildGapAwareMultiSourceAudioCutCommand,
  buildMultiSourceAudioCutCommand, buildPlan, predictedDuration } from '../src/plan.mjs';
import { segmentDuration } from '../src/cut-timeline.mjs';
import { readRenderEdit } from '../src/internal-render.mjs';
import { unsplitFixture } from '../../edit-store/test/helpers/cut-audio-supply.mjs';

const cases = JSON.parse(fs.readFileSync(new URL('../../edit-store/test/transition-plan-cases.json',
  import.meta.url), 'utf8')).hold;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

function projectedCuts(example) {
  return example.expected.projected.map((projection, index) => {
    const original = example.cuts[index];
    return {
      id: String.fromCharCode(97 + index), src: original.src,
      at: projection.at, in: projection.in, out: projection.out,
      ...(original.speed === undefined ? {} : { speed: original.speed }),
      ...(projection.transitionSeconds === undefined ? {} : {
        transition_out: { type: original.transitionOut.type, duration: projection.transitionSeconds },
      }),
      ...(projection.hold === undefined ? {} : { transitionHold: { headSeconds: projection.hold } }),
      ...(original.freeze === undefined ? {} : {
        freeze: { at_sec: projection.freezeAt ?? original.freeze.at_sec,
          duration_sec: original.freeze.duration_sec },
      }),
    };
  });
}

function commandFor(cuts, gapAware = false, sourceInputs = null) {
  const command = gapAware ? buildGapAwareMultiSourceAudioCutCommand : buildMultiSourceAudioCutCommand;
  return command({ sourceInputs: sourceInputs ?? ['a', 'b', 'c'].map(id => ({
    id, path: `${id}.wav`, hasAudio: true })), cuts, cutPath: 'audio.mp4', duration: 12,
    ffmpegCommand: 'ffmpeg', ffprobeCommand: null });
}

function graphOf(command) {
  return command.args[command.args.indexOf('-filter_complex') + 1];
}

function planFor(cuts) {
  const projectRoot = fs.mkdtempSync(join(tmpdir(), 'transition-audio-hold-'));
  const originalProbe = childProcess.spawnSync;
  childProcess.spawnSync = () => ({ status: 0, stdout: JSON.stringify({
    streams: [{ codec_type: 'audio' }], format: { duration: '12' },
  }) });
  syncBuiltinESMExports();
  try {
    fs.mkdirSync(join(projectRoot, 'assets'));
    fs.writeFileSync(join(projectRoot, 'assets', 'main.mp4'), 'probe fixture');
    fs.writeFileSync(join(projectRoot, 'analysis.json'), JSON.stringify({
      source: 'assets/main.mp4', transcript: [{ start: 0, end: 3, text: 'fixture' }],
    }));
    const temporaryDirectory = join(projectRoot, '.akari', 'render-tmp');
    const { edit, internal } = readRenderEdit(unsplitFixture(), temporaryDirectory, { projectRoot });
    return buildPlan({ edit: { ...edit, cuts }, internalEdit: internal, projectRoot,
      outputPath: join(projectRoot, 'out.mp4'), temporaryDirectory, resolvedEngine: 'osr',
      capabilities: { sourceInputs: [...new Set(cuts.map(cut => cut.src))].map(id => ({
        id, path: join(projectRoot, 'assets', `${id}.wav`), hasAudio: true, duration: 12,
      })), ffmpegCommand: 'ffmpeg', ffprobeCommand: 'ffprobe' },
    });
  } finally {
    childProcess.spawnSync = originalProbe;
    syncBuiltinESMExports();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

function inputRanges(command, cuts) {
  const args = command.args;
  const graph = graphOf(command);
  const ranges = [];
  let inputIndex = 0;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '-i') continue;
    const cut = cuts[inputIndex];
    const seek = Number(args[index - 3]);
    const readSeconds = Number(args[index - 1]);
    close(seek, Math.max(0, cut.in - AUDIO_SEEK_PREROLL_SECONDS));
    close(readSeconds, cut.out - cut.in + cut.in - seek);
    const trims = [...graph.matchAll(new RegExp(`\\[${inputIndex}:a\\]atrim=start=([\\d.]+):end=([\\d.]+)`, 'g'))];
    assert.ok(trims.length, `missing trim for ${inputIndex}`);
    const start = Math.min(...trims.map(trim => seek + Number(trim[1])));
    const end = Math.max(...trims.map(trim => seek + Number(trim[2])));
    close(start, cut.in);
    close(end, cut.out);
    ranges.push([start, end]);
    inputIndex += 1;
  }
  return ranges;
}

for (const example of cases) {
  test(`${example.name}: sequential silence, fade, seek, and duration`, () => {
    const cuts = projectedCuts(example);
    const graph = graphOf(commandFor(cuts));
    const expected = example.expected.sequential;
    const inputs = cuts.map((cut, index) => {
      const hold = expected.silenceSeconds[index];
      const target = hold > 0 ? `lha_v1_${index}_real` : `a${index}`;
      const pad = graph.match(new RegExp(`apad=whole_dur=([\\d.]+)\\[${target}\\]`));
      assert.ok(pad, `missing real-audio pad for ${index}`);
      close(Number(pad[1]), segmentDuration(cut));
      const silence = graph.match(new RegExp(`anullsrc=r=48000:cl=stereo,atrim=duration=([\\d.]+),asetpts=PTS-STARTPTS\\[lha_v1_${index}_silence\\]`));
      if (hold > 0) {
        assert.ok(silence, `missing hold silence for ${index}`);
        close(Number(silence[1]), hold);
        assert.match(graph, new RegExp(`\\[lha_v1_${index}_silence\\]\\[lha_v1_${index}_real\\]concat=n=2:v=0:a=1\\[a${index}\\]`));
      } else {
        assert.equal(silence, null);
      }
      return Number(pad[1]) + (silence ? Number(silence[1]) : 0);
    });
    inputs.forEach((value, index) => close(value, expected.inputSeconds[index]));
    const durations = cuts.slice(0, -1).map(cut => cut.transition_out.duration);
    assert.deepEqual([...graph.matchAll(/acrossfade=d=([\d.]+)/g)].map(match => Number(match[1])), durations);
    let inputTotal = 0;
    let overlapTotal = 0;
    for (const [index, duration] of durations.entries()) {
      inputTotal += expected.inputSeconds[index];
      close(inputTotal - overlapTotal - duration, example.expected.windows[index].start);
      close(example.expected.windows[index].start + expected.silenceSeconds[index + 1],
        index === 0 ? example.expected.audio.incomingStart : cuts[index + 1].at);
      overlapTotal += duration;
    }
    close(predictedDuration(cuts), expected.totalSeconds);
    close(inputs.reduce((sum, value) => sum + value, 0)
      - durations.reduce((sum, value) => sum + value, 0), expected.totalSeconds);
    assert.deepEqual(inputRanges(commandFor(cuts), cuts), cuts.map(cut => [cut.in, cut.out]));
  });
}

test('a 0.8 second hold gives five and six second inputs, a one second fade, and ten seconds total', () => {
  const cuts = [
    { src: 'a', at: 0, in: 2, out: 7, transition_out: { type: 'dissolve', duration: 1 } },
    { src: 'b', at: 4.8, in: 0, out: 5.2, transitionHold: { headSeconds: 0.8 } },
  ];
  const graph = graphOf(commandFor(cuts));
  assert.match(graph, /apad=whole_dur=5\[a0\]/);
  assert.match(graph, /apad=whole_dur=5\.2\[lha_v1_1_real\]/);
  assert.match(graph, /atrim=duration=0\.8,asetpts=PTS-STARTPTS\[lha_v1_1_silence\]/);
  assert.match(graph, /acrossfade=d=1\[joineda\]/);
  close(5 + (5.2 + 0.8) - 1, 10);
  close(predictedDuration(cuts), 10);
});

test('buildPlan selects sequential audio for an entirely held first frame', () => {
  const plan = planFor(projectedCuts(cases[4]));
  const graph = graphOf(plan.commands.cut_audio);
  assert.match(graph, /acrossfade=d=1/);
  assert.match(graph, /atrim=duration=1,asetpts=PTS-STARTPTS\[lha_v1_1_silence\]/);
  assert.doesNotMatch(graph, /adelay|amix/);
  close(plan.predicted_duration_seconds, 10);
});

test('buildPlan keeps the 0.8 second hold in the sequential ten second plan', () => {
  const plan = planFor(projectedCuts(cases[0]));
  const graph = graphOf(plan.commands.cut_audio);
  assert.match(graph, /acrossfade=d=1/);
  assert.match(graph, /atrim=duration=0\.8,asetpts=PTS-STARTPTS\[lha_v1_1_silence\]/);
  assert.doesNotMatch(graph, /adelay|amix/);
  close(plan.predicted_duration_seconds, 10);
});

test('buildPlan uses gap-aware audio when another track overlaps a held transition', () => {
  const cuts = [...projectedCuts(cases[0]), { src: 'c', at: 1, in: 0, out: 1, track: 1 }];
  const plan = planFor(cuts);
  const graph = graphOf(plan.commands.cut_audio);
  assert.match(graph, /adelay=4800/);
  assert.doesNotMatch(graph, /lha_v1_1_silence|concat=n=2:v=0:a=1/);
  close(plan.predicted_duration_seconds, 10);
});

test('buildPlan keeps ordinary cuts on the sequential route without hold labels', () => {
  const cuts = [
    { src: 'a', at: 0, in: 2, out: 7, transition_out: { type: 'dissolve', duration: 1 } },
    { src: 'b', at: 4, in: 3, out: 8 },
  ];
  const plan = planFor(cuts);
  const graph = graphOf(plan.commands.cut_audio);
  assert.match(graph, /acrossfade=d=1/);
  assert.doesNotMatch(graph, /lha_|adelay|amix/);
});

test('chunking keeps a held B with A and concatenates C to twelve seconds', () => {
  const cuts = [...projectedCuts(cases[0]), { src: 'c', at: 10, in: 0, out: 2 }];
  const command = buildMultiSourceAudioCutCommand({ sourceInputs: ['a', 'b', 'c'].map(id => ({
    id, path: `${id}.wav`, hasAudio: true,
  })), cuts, cutPath: 'audio.mp4', duration: 12, ffmpegCommand: 'ffmpeg', ffprobeCommand: null,
  maxInputsPerCommand: 1 });
  assert.equal(command.chunks.length, 2);
  assert.deepEqual(command.chunks.map(chunk =>
    [...graphOf(chunk).matchAll(/\[(\d+):a\]atrim/g)].map(match => Number(match[1]))), [[0, 1], [0]]);
  assert.match(graphOf(command.chunks[0]), /acrossfade=d=1/);
  assert.match(graphOf(command.chunks[0]), /atrim=duration=0\.8,asetpts=PTS-STARTPTS\[lha_v1_1_silence\]/);
  close(predictedDuration(cuts), 12);
});

test('speed two applies atempo only to real audio after 0.8 output seconds of silence', () => {
  const graph = graphOf(commandFor(projectedCuts(cases[3])));
  assert.match(graph, /atempo=2.*\[lha_v1_1_real\]/);
  assert.match(graph, /atrim=duration=0\.8,asetpts=PTS-STARTPTS\[lha_v1_1_silence\]/);
  assert.doesNotMatch(graph, /anullsrc=r=48000:cl=stereo,atrim=duration=0\.8[^;]*atempo/);
});

test('a silent source with a hold fills the whole sequential input', () => {
  const cuts = projectedCuts(cases[0]);
  const graph = graphOf(commandFor(cuts, false, [
    { id: 'a', path: 'a.wav', hasAudio: true }, { id: 'b', path: 'b.wav', hasAudio: false },
  ]));
  assert.match(graph, /anullsrc=r=48000:cl=stereo,atrim=duration=6,asetpts=PTS-STARTPTS\[a1\]/);
});

test('gap-aware placement keeps the real audio at its explicit start', () => {
  const cuts = [...projectedCuts(cases[0]), { src: 'c', at: 1, in: 0, out: 1, track: 1 }];
  const graph = graphOf(commandFor(cuts, true));
  assert.match(graph, /\[araw1_1\]adelay=4800:all=1\[adelay1_1\]/);
  assert.match(graph, /\[1:a\]atrim=start=0:end=5\.2/);
  assert.match(graph, /apad=whole_dur=5\.2\[araw1_1\]/);
  assert.doesNotMatch(graph, /lha_v1_1/);
});

test('ordinary placements add no hold labels or silence', () => {
  for (const [before, after] of [[1, 0], [0.5, 0.5], [0, 1]]) {
    const cuts = [
      { src: 'a', at: 0, in: 2, out: 6 + after, transition_out: { type: 'dissolve', duration: 1 } },
      { src: 'b', at: 4 - before, in: 3 - before, out: 7 + after,
        transition_out: { type: 'dissolve', duration: 1 } },
      { src: 'c', at: 8 - before, in: 3 - before, out: 7 },
    ];
    const graph = graphOf(commandFor(cuts));
    assert.doesNotMatch(graph, /lha_/);
    assert.doesNotMatch(graph, /anullsrc/);
  }
});
