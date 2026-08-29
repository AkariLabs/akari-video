import assert from "node:assert/strict";
import test from "node:test";

import { buildTailPadCommand } from "../src/content-duration.mjs";
import {
  buildGapAwareMultiSourceCutCommand,
  buildMultiSourceCutCommand,
} from "../src/plan.mjs";

const common = {
  cutPath: "/tmp/cut.mp4",
  width: 320,
  height: 180,
  fps: 30,
  ffmpegCommand: "ffmpeg",
  ffprobeCommand: null,
  projectRoot: "/",
  videoEncodeArgs: null,
};

const expected = {
  single: [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", "/media/a.mp4",
    "-filter_complex",
    "[0:v]trim=start=1:end=3,setpts=PTS-STARTPTS,scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[vrange0];[vrange0]scale=out_range=tv[v0];[0:a]atrim=start=1:end=3,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=2[a0];[v0][a0]concat=n=1:v=1:a=1[joinedv][joineda];[joinedv]null[outv_tv]",
    "-map", "[outv_tv]", "-map", "[joineda]",
    "-c:v", "libx264", "-profile:v", "high", "-color_range", "tv", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "48000", "/tmp/cut.mp4",
  ],
  multi: [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", "/media/a.mp4", "-i", "/media/b.mp4",
    "-filter_complex",
    "[0:v]trim=start=0:end=2,setpts=PTS-STARTPTS,scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[vrange0];[vrange0]scale=out_range=tv[v0];[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=2[a0];[1:v]trim=start=1:end=3,setpts=PTS-STARTPTS,scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[vrange1];[vrange1]scale=out_range=tv[v1];[1:a]atrim=start=1:end=3,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=2[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[joinedv][joineda];[joinedv]null[outv_tv]",
    "-map", "[outv_tv]", "-map", "[joineda]",
    "-c:v", "libx264", "-profile:v", "high", "-color_range", "tv", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "48000", "/tmp/cut.mp4",
  ],
  gap: [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", "/media/a.mp4", "-i", "/media/b.mp4",
    "-filter_complex",
    "[0:v]trim=start=0:end=2,setpts=PTS-STARTPTS[gv1raw0];[gv1raw0]scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[gv1_0];color=c=black:s=320x180:r=30:d=2[gv1_1];[1:v]trim=start=1:end=3,setpts=PTS-STARTPTS[gv1raw2];[gv1raw2]scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[gv1_2];[gv1_0][gv1_1][gv1_2]concat=n=3:v=1:a=0[joinedv];[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,apad=whole_dur=2[araw1_0];[araw1_0]adelay=0:all=1[adelay1_0];[1:a]atrim=start=1:end=3,asetpts=PTS-STARTPTS,apad=whole_dur=2[araw1_1];[araw1_1]adelay=4000:all=1[adelay1_1];[adelay1_0][adelay1_1]amix=inputs=2:duration=longest:normalize=0,apad=whole_dur=6[joineda];[joinedv]scale=out_range=tv[outv_tv]",
    "-map", "[outv_tv]", "-map", "[joineda]",
    "-c:v", "libx264", "-profile:v", "high", "-color_range", "tv", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "48000", "/tmp/cut.mp4",
  ],
  freeze: [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", "/media/a.mp4",
    "-filter_complex",
    "[0:v]trim=start=0:end=1,setpts=PTS-STARTPTS[fzv_v1_0_a];[fzv_v1_0_a]tpad=stop_mode=clone:stop_duration=1[fzv_v1_0_ah];[0:v]trim=start=1:end=3,setpts=PTS-STARTPTS[fzv_v1_0_b];[fzv_v1_0_ah][fzv_v1_0_b]concat=n=2:v=1:a=0[fz_v1_0_pre_tb];[fz_v1_0_pre_tb]scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[vrange0];[vrange0]scale=out_range=tv[v0];anullsrc=r=48000:cl=stereo,atrim=duration=1,asetpts=PTS-STARTPTS[fza_v1_0_silence];[0:a]atrim=start=0:end=1,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[fza_v1_0_a];[0:a]atrim=start=1:end=3,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[fza_v1_0_b];[fza_v1_0_a][fza_v1_0_silence][fza_v1_0_b]concat=n=3:v=0:a=1,apad=whole_dur=4[a0];[v0][a0]concat=n=1:v=1:a=1[joinedv][joineda];[joinedv]null[outv_tv]",
    "-map", "[outv_tv]", "-map", "[joineda]",
    "-c:v", "libx264", "-profile:v", "high", "-color_range", "tv", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "48000", "/tmp/cut.mp4",
  ],
  transition: [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", "/media/a.mp4", "-i", "/media/b.mp4",
    "-filter_complex",
    "[0:v]trim=start=0:end=2,setpts=PTS-STARTPTS,scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[vrange0];[vrange0]scale=out_range=tv[vpre0];[vpre0]settb=AVTB[v0];[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=2[a0];[1:v]trim=start=0:end=2,setpts=PTS-STARTPTS,scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[vrange1];[vrange1]scale=out_range=tv[vpre1];[vpre1]settb=AVTB[v1];[1:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=2[a1];[v0][v1]xfade=transition=dissolve:duration=0.5:offset=1.5[joinedv];[a0][a1]acrossfade=d=0.5[joineda];[joinedv]null[outv_tv]",
    "-map", "[outv_tv]", "-map", "[joineda]",
    "-c:v", "libx264", "-profile:v", "high", "-color_range", "tv", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "48000", "/tmp/cut.mp4",
  ],
  tail_pad: [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", "/tmp/cut.mp4",
    "-filter_complex",
    "[0:v]tpad=stop_mode=add:stop_duration=3.25:color=black[padv_raw];[padv_raw]scale=out_range=tv[padv];[0:a]apad=whole_dur=13.25[pada]",
    "-map", "[padv]", "-map", "[pada]",
    "-c:v", "libx264", "-profile:v", "high", "-color_range", "tv", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "48000", "-t", "13.25", "/tmp/cut-tail-padded.mp4",
  ],
};

test("legacy cut command args remain byte-stable across five branches", () => {
  const a = { id: "a", path: "/media/a.mp4", hasAudio: true };
  const b = { id: "b", path: "/media/b.mp4", hasAudio: true };
  const actual = {
    single: buildMultiSourceCutCommand({
      ...common,
      sourceInputs: [a],
      cuts: [{ src: "a", in: 1, out: 3 }],
    }).args,
    multi: buildMultiSourceCutCommand({
      ...common,
      sourceInputs: [a, b],
      cuts: [{ src: "a", in: 0, out: 2 }, { src: "b", in: 1, out: 3 }],
    }).args,
    gap: buildGapAwareMultiSourceCutCommand({
      ...common,
      sourceInputs: [a, b],
      duration: 6,
      cuts: [
        { src: "a", at: 0, track: 0, in: 0, out: 2 },
        { src: "b", at: 4, track: 0, in: 1, out: 3 },
      ],
    }).args,
    freeze: buildMultiSourceCutCommand({
      ...common,
      sourceInputs: [a],
      cuts: [{ src: "a", in: 0, out: 3, freeze: { at_sec: 1, duration_sec: 1 } }],
    }).args,
    transition: buildMultiSourceCutCommand({
      ...common,
      sourceInputs: [a, b],
      cuts: [
        { src: "a", in: 0, out: 2, transition_out: { type: "dissolve", duration: 0.5 } },
        { src: "b", in: 0, out: 2 },
      ],
    }).args,
  };

  assert.deepEqual(actual, {
    single: expected.single,
    multi: expected.multi,
    gap: expected.gap,
    freeze: expected.freeze,
    transition: expected.transition,
  });
});

test("legacy tail-pad command args remain byte-stable", () => {
  const actual = buildTailPadCommand({
    ffmpegCommand: "ffmpeg",
    inputPath: "/tmp/cut.mp4",
    outputPath: "/tmp/cut-tail-padded.mp4",
    cutsEndSeconds: 10,
    finalDurationSeconds: 13.25,
    videoEncodeArgs: null,
  });
  assert.deepEqual(actual.args, expected.tail_pad);
});
