import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGapAwareMultiSourceAudioCutCommand,
  buildGapAwareMultiSourceCutCommand,
  buildMultiSourceAudioCutCommand,
  buildMultiSourceCutCommand,
} from "../src/plan.mjs";

const common = {
  ffmpegCommand: "ffmpeg",
  ffprobeCommand: null,
  cutPath: "/tmp/cut-audio.mp4",
};

function expectedArgs(inputs, filter) {
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    ...inputs.flatMap(path => ["-i", path]),
    "-filter_complex", filter,
    "-map", "[joineda]", "-vn",
    "-c:a", "aac", "-ar", "48000",
    "/tmp/cut-audio.mp4",
  ];
}

function assertAudioOnly(command, legacyCommand) {
  const filter = command.args[command.args.indexOf("-filter_complex") + 1];
  assert.ok(command.args.includes("-vn"));
  assert.doesNotMatch(filter, /\[\d+:v\]/u);
  assert.doesNotMatch(filter, /\]trim=/u);
  assert.doesNotMatch(filter, /scale=/u);
  assert.equal(command.args.includes("-c:v"), false);
  assert.equal(command.args.includes("-pix_fmt"), false);
  assert.equal(command.args.includes("-framerate"), false);
  assert.equal(command.args.includes("-loop"), false);

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
    ["/media/a.mp4"],
    "[0:a]atrim=start=1:end=3,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=2[a0];[a0]concat=n=1:v=0:a=1[joineda]",
  ));
  assertAudioOnly(command, buildLegacyPlain({ sourceInputs, cuts }));
});

test("audio-only multi-source cut keeps every input index and exact command snapshot", () => {
  const sourceInputs = [
    { id: "a", path: "/media/a.mp4", hasAudio: true },
    { id: "b", path: "/media/b.mp4", hasAudio: true },
  ];
  const cuts = [{ src: "a", in: 0, out: 2 }, { src: "b", in: 1, out: 3 }];
  const command = buildMultiSourceAudioCutCommand({ ...common, sourceInputs, cuts });
  assert.deepEqual(command.args, expectedArgs(
    ["/media/a.mp4", "/media/b.mp4"],
    "[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=2[a0];[1:a]atrim=start=1:end=3,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=2[a1];[a0][a1]concat=n=2:v=0:a=1[joineda]",
  ));
  assertAudioOnly(command, buildLegacyPlain({ sourceInputs, cuts }));
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
    ["/media/a.mp4", "/media/b.mp4"],
    "[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,apad=whole_dur=2[araw1_0];[araw1_0]adelay=0:all=1[adelay1_0];[1:a]atrim=start=1:end=3,asetpts=PTS-STARTPTS,apad=whole_dur=2[araw1_1];[araw1_1]adelay=4000:all=1[adelay1_1];[adelay1_0][adelay1_1]amix=inputs=2:duration=longest:normalize=0,apad=whole_dur=6[joineda]",
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
  assertAudioOnly(command, legacy);
});

test("audio-only freeze cut reuses the silence insertion chain and exact command snapshot", () => {
  const sourceInputs = [{ id: "a", path: "/media/a.mp4", hasAudio: true }];
  const cuts = [{ src: "a", in: 0, out: 3, freeze: { at_sec: 1, duration_sec: 1 } }];
  const command = buildMultiSourceAudioCutCommand({ ...common, sourceInputs, cuts });
  assert.deepEqual(command.args, expectedArgs(
    ["/media/a.mp4"],
    "anullsrc=r=48000:cl=stereo,atrim=duration=1,asetpts=PTS-STARTPTS[fza_v1_0_silence];[0:a]atrim=start=0:end=1,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[fza_v1_0_a];[0:a]atrim=start=1:end=3,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[fza_v1_0_b];[fza_v1_0_a][fza_v1_0_silence][fza_v1_0_b]concat=n=3:v=0:a=1,apad=whole_dur=4[a0];[a0]concat=n=1:v=0:a=1[joineda]",
  ));
  assertAudioOnly(command, buildLegacyPlain({ sourceInputs, cuts }));
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
    ["/media/a.mp4", "/media/b.mp4"],
    "[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=2[a0];[1:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=2[a1];[a0][a1]acrossfade=d=0.5[joineda]",
  ));
  assertAudioOnly(command, buildLegacyPlain({ sourceInputs, cuts }));
});

test("audio-only cut always exists for a silent still source and supplies anullsrc", () => {
  const sourceInputs = [{ id: "still", path: "/media/still.png", hasAudio: false }];
  const cuts = [{ src: "still", in: 0, out: 2 }];
  const command = buildMultiSourceAudioCutCommand({ ...common, sourceInputs, cuts });
  assert.deepEqual(command.args, expectedArgs(
    ["/media/still.png"],
    "anullsrc=r=48000:cl=stereo,atrim=duration=2,asetpts=PTS-STARTPTS[a0];[a0]concat=n=1:v=0:a=1[joineda]",
  ));
  assertAudioOnly(command, buildLegacyPlain({ sourceInputs, cuts }));
});
