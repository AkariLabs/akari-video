import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGapAwareMultiSourceAudioCutCommand,
  buildGapAwareMultiSourceCutCommand,
  buildMultiSourceAudioCutCommand,
  buildMultiSourceCutCommand,
  MAX_AUDIO_INPUTS_PER_COMMAND,
} from "../src/plan.mjs";

const common = {
  ffmpegCommand: "ffmpeg",
  ffprobeCommand: null,
  cutPath: "/tmp/cut-audio.mp4",
};

function expectedArgs(inputs, filter) {
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    ...inputs.flatMap(({ ss, duration, path }) => [
      "-ss", String(ss),
      ...(duration === undefined ? [] : ["-t", String(duration)]),
      "-i", path,
    ]),
    "-filter_complex", filter,
    "-map", "[joineda]", "-vn",
    "-c:a", "aac", "-ar", "48000",
    "/tmp/cut-audio.mp4",
  ];
}

function assertAudioOnly(command, legacyCommand, expectedInputCount, allowedNonZeroTrimStarts = []) {
  const filter = command.args[command.args.indexOf("-filter_complex") + 1];
  assert.ok(command.args.includes("-vn"));
  assert.doesNotMatch(filter, /\[\d+:v\]/u);
  assert.doesNotMatch(filter, /\]trim=/u);
  assert.doesNotMatch(filter, /scale=/u);
  assert.equal(command.args.includes("-c:v"), false);
  assert.equal(command.args.includes("-pix_fmt"), false);
  assert.equal(command.args.includes("-framerate"), false);
  assert.equal(command.args.includes("-loop"), false);
  const inputIndexes = command.args.flatMap((value, index) => value === "-i" ? [index] : []);
  assert.equal(inputIndexes.length, expectedInputCount);
  for (const inputIndex of inputIndexes) {
    assert.equal(command.args[inputIndex - 4], "-ss");
    assert.equal(Number.isFinite(Number(command.args[inputIndex - 3])), true);
    assert.equal(command.args[inputIndex - 2], "-t");
    assert.equal(Number.isFinite(Number(command.args[inputIndex - 1])), true);
  }
  const trimStarts = [...filter.matchAll(/atrim=start=([^:;,]+)/gu)].map((match) => match[1]);
  assert.deepEqual([...new Set(trimStarts)].filter((value) => value !== "0"), allowedNonZeroTrimStarts);

  const audioCodecIndex = command.args.indexOf("-c:a");
  const legacyAudioCodecIndex = legacyCommand.args.indexOf("-c:a");
  assert.deepEqual(
    command.args.slice(audioCodecIndex, audioCodecIndex + 4),
    legacyCommand.args.slice(legacyAudioCodecIndex, legacyAudioCodecIndex + 4),
  );
}

function buildLegacyPlain({ sourceInputs, cuts }) {
  return buildMultiSourceCutCommand({
    sourceInputs,
    cuts,
    cutPath: "/tmp/cut.mp4",
    width: 320,
    height: 180,
    fps: 30,
    ffmpegCommand: "ffmpeg",
    ffprobeCommand: null,
    projectRoot: "/",
  });
}

test("audio-only single-source cut keeps the audio chain and exact command snapshot", () => {
  const sourceInputs = [{ id: "a", path: "/media/a.mp4", hasAudio: true }];
  const cuts = [{ src: "a", in: 1, out: 3 }];
  const command = buildMultiSourceAudioCutCommand({ ...common, sourceInputs, cuts });
  assert.deepEqual(command.args, expectedArgs(
    [{ ss: 1, duration: 2, path: "/media/a.mp4" }],
    "[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=2[a0];[a0]concat=n=1:v=0:a=1[joineda]",
  ));
  assertAudioOnly(command, buildLegacyPlain({ sourceInputs, cuts }), 1);
});

test("audio-only multi-source cut keeps every input index and exact command snapshot", () => {
  const sourceInputs = [
    { id: "a", path: "/media/a.mp4", hasAudio: true },
    { id: "b", path: "/media/b.mp4", hasAudio: true },
  ];
  const cuts = [{ src: "a", in: 0, out: 2 }, { src: "b", in: 1, out: 3 }];
  const command = buildMultiSourceAudioCutCommand({ ...common, sourceInputs, cuts });
  assert.deepEqual(command.args, expectedArgs(
    [
      { ss: 0, duration: 2, path: "/media/a.mp4" },
      { ss: 1, duration: 2, path: "/media/b.mp4" },
    ],
    "[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=2[a0];[1:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=2[a1];[a0][a1]concat=n=2:v=0:a=1[joineda]",
  ));
  assertAudioOnly(command, buildLegacyPlain({ sourceInputs, cuts }), 2);
});

test("audio-only gap-aware cut keeps delay/mix padding and exact command snapshot", () => {
  const sourceInputs = [
    { id: "a", path: "/media/a.mp4", hasAudio: true },
    { id: "b", path: "/media/b.mp4", hasAudio: true },
  ];
  const cuts = [
    { src: "a", at: 0, track: 0, in: 0, out: 2 },
    { src: "b", at: 4, track: 0, in: 1, out: 3 },
  ];
  const command = buildGapAwareMultiSourceAudioCutCommand({ ...common, sourceInputs, cuts, duration: 6 });
  assert.deepEqual(command.args, expectedArgs(
    [
      { ss: 0, duration: 2, path: "/media/a.mp4" },
      { ss: 1, duration: 2, path: "/media/b.mp4" },
    ],
    "[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,apad=whole_dur=2[araw1_0];[araw1_0]adelay=0:all=1[adelay1_0];[1:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,apad=whole_dur=2[araw1_1];[araw1_1]adelay=4000:all=1[adelay1_1];[adelay1_0][adelay1_1]amix=inputs=2:duration=longest:normalize=0,apad=whole_dur=6[joineda]",
  ));
  const legacy = buildGapAwareMultiSourceCutCommand({
    sourceInputs,
    cuts,
    cutPath: "/tmp/cut.mp4",
    duration: 6,
    width: 320,
    height: 180,
    fps: 30,
    ffmpegCommand: "ffmpeg",
    ffprobeCommand: null,
    projectRoot: "/",
  });
  assertAudioOnly(command, legacy, 2);
});

test("audio-only freeze cut reuses the silence insertion chain and exact command snapshot", () => {
  const sourceInputs = [{ id: "a", path: "/media/a.mp4", hasAudio: true }];
  const cuts = [{ src: "a", in: 5, out: 8, freeze: { at_sec: 1, duration_sec: 1 } }];
  const command = buildMultiSourceAudioCutCommand({ ...common, sourceInputs, cuts });
  assert.deepEqual(command.args, expectedArgs(
    [{ ss: 5, duration: 3, path: "/media/a.mp4" }],
    "anullsrc=r=48000:cl=stereo,atrim=duration=1,asetpts=PTS-STARTPTS[fza_v1_0_silence];[0:a]atrim=start=0:end=1,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[fza_v1_0_a];[0:a]atrim=start=1:end=3,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[fza_v1_0_b];[fza_v1_0_a][fza_v1_0_silence][fza_v1_0_b]concat=n=3:v=0:a=1,apad=whole_dur=4[a0];[a0]concat=n=1:v=0:a=1[joineda]",
  ));
  assertAudioOnly(command, buildLegacyPlain({ sourceInputs, cuts }), 1, ["1"]);
});

test("audio-only transition_out cut keeps acrossfade and exact command snapshot", () => {
  const sourceInputs = [
    { id: "a", path: "/media/a.mp4", hasAudio: true },
    { id: "b", path: "/media/b.mp4", hasAudio: true },
  ];
  const cuts = [
    { src: "a", in: 0, out: 2, transition_out: { type: "dissolve", duration: 0.5 } },
    { src: "b", in: 0, out: 2 },
  ];
  const command = buildMultiSourceAudioCutCommand({ ...common, sourceInputs, cuts });
  assert.deepEqual(command.args, expectedArgs(
    [
      { ss: 0, duration: 2, path: "/media/a.mp4" },
      { ss: 0, duration: 2, path: "/media/b.mp4" },
    ],
    "[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=2[a0];[1:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=2[a1];[a0][a1]acrossfade=d=0.5[joineda]",
  ));
  assertAudioOnly(command, buildLegacyPlain({ sourceInputs, cuts }), 2);
});

test("audio-only cut always exists for a silent still source and supplies anullsrc", () => {
  const sourceInputs = [{ id: "still", path: "/media/still.png", hasAudio: false }];
  const cuts = [{ src: "still", in: 0, out: 2 }];
  const command = buildMultiSourceAudioCutCommand({ ...common, sourceInputs, cuts });
  assert.deepEqual(command.args, expectedArgs(
    [],
    "anullsrc=r=48000:cl=stereo,atrim=duration=2,asetpts=PTS-STARTPTS[a0];[a0]concat=n=1:v=0:a=1[joineda]",
  ));
  assertAudioOnly(command, buildLegacyPlain({ sourceInputs, cuts }), 0);
});

test("audio-only input seek omits -t for a synthetic open-ended cut", () => {
  const sourceInputs = [{ id: "a", path: "/media/a.mp4", hasAudio: true }];
  const cuts = [{ src: "a", in: 4, out: null }];
  const command = buildMultiSourceAudioCutCommand({ ...common, sourceInputs, cuts });
  const inputIndex = command.args.indexOf("-i");
  assert.deepEqual(command.args.slice(inputIndex - 2, inputIndex + 2), ["-ss", "4", "-i", "/media/a.mp4"]);
  assert.equal(command.args.includes("-t"), false);
  assert.match(command.args.join(" "), /\[0:a\]atrim=start=0,asetpts=PTS-STARTPTS/u);
});

function makeAudioCuts(count) {
  return Array.from({ length: count }, (_, index) => ({
    src: "a",
    in: index,
    out: index + 1,
  }));
}

function countInputs(args) {
  return args.filter((value) => value === "-i").length;
}

test("audio-only sequential cuts split 201 inputs into PCM chunks and one concat encode", () => {
  assert.equal(MAX_AUDIO_INPUTS_PER_COMMAND, 200);
  const sourceInputs = [{ id: "a", path: "/media/a.mp4", hasAudio: true }];
  const command = buildMultiSourceAudioCutCommand({
    ...common,
    sourceInputs,
    cuts: makeAudioCuts(201),
  });

  assert.equal(command.chunks.length, 2);
  assert.deepEqual(command.chunks.map((chunk) => countInputs(chunk.args)), [200, 1]);
  assert.deepEqual(command.chunks.map((chunk) => chunk.output), [
    "/tmp/cut-audio-chunk-0001.wav",
    "/tmp/cut-audio-chunk-0002.wav",
  ]);
  for (const chunk of command.chunks) {
    assert.deepEqual(chunk.args.slice(-5), ["-c:a", "pcm_s16le", "-ar", "48000", chunk.output]);
  }
  assert.deepEqual(command.args, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "concat", "-safe", "0", "-i", "/tmp/cut-audio-chunks.txt",
    "-map", "0:a", "-vn", "-c:a", "aac", "-ar", "48000", "/tmp/cut-audio.mp4",
  ]);
  assert.deepEqual(command.concat_list, {
    path: "/tmp/cut-audio-chunks.txt",
    content: "file '/tmp/cut-audio-chunk-0001.wav'\nfile '/tmp/cut-audio-chunk-0002.wav'\n",
  });
  assert.deepEqual(command.intermediates, [
    "/tmp/cut-audio-chunk-0001.wav",
    "/tmp/cut-audio-chunk-0002.wav",
    "/tmp/cut-audio-chunks.txt",
  ]);
});

test("audio-only chunk boundary moves backward rather than splitting an acrossfade pair", () => {
  const sourceInputs = [{ id: "a", path: "/media/a.mp4", hasAudio: true }];
  const cuts = makeAudioCuts(201);
  cuts[199].transition_out = { type: "dissolve", duration: 0.25 };
  const command = buildMultiSourceAudioCutCommand({ ...common, sourceInputs, cuts });

  assert.deepEqual(command.chunks.map((chunk) => countInputs(chunk.args)), [199, 2]);
  const firstFilter = command.chunks[0].args[command.chunks[0].args.indexOf("-filter_complex") + 1];
  const secondFilter = command.chunks[1].args[command.chunks[1].args.indexOf("-filter_complex") + 1];
  assert.doesNotMatch(firstFilter, /acrossfade=/u);
  assert.match(secondFilter, /\[a0\]\[a1\]acrossfade=d=0\.25\[joineda\]/u);
});

test("gap-aware audio chunks remain full-duration timelines and are added by the final encode", () => {
  const sourceInputs = [{ id: "a", path: "/media/a.mp4", hasAudio: true }];
  const cuts = makeAudioCuts(201).map((cut, index) => ({ ...cut, at: index * 2, track: 0 }));
  const command = buildGapAwareMultiSourceAudioCutCommand({
    ...common,
    sourceInputs,
    cuts,
    duration: 401,
  });

  assert.equal(command.chunks.length, 2);
  assert.deepEqual(command.chunks.map((chunk) => countInputs(chunk.args)), [200, 1]);
  assert.equal(command.concat_list, undefined);
  assert.deepEqual(command.intermediates, [
    "/tmp/cut-audio-chunk-0001.wav",
    "/tmp/cut-audio-chunk-0002.wav",
  ]);
  assert.deepEqual(command.args, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", "/tmp/cut-audio-chunk-0001.wav",
    "-i", "/tmp/cut-audio-chunk-0002.wav",
    "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[joineda]",
    "-map", "[joineda]", "-vn", "-c:a", "aac", "-ar", "48000", "/tmp/cut-audio.mp4",
  ]);
  for (const chunk of command.chunks) {
    const filter = chunk.args[chunk.args.indexOf("-filter_complex") + 1];
    assert.match(filter, /apad=whole_dur=401\[joineda\]$/u);
  }
});
