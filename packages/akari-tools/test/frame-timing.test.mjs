import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  analyzeFrameTiming,
  frameTimingIntervals,
  resolveNominalFrameRate,
} from "../src/media/frame-timing.mjs";
import { probeMedia } from "../src/media/probe.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";

test("frame timing sampling is bounded to a 60 second head and at most five 10 second windows", () => {
  assert.deepEqual(frameTimingIntervals(35), [{ start: 0, duration: 35 }]);
  assert.deepEqual(frameTimingIntervals(80), [
    { start: 0, duration: 60 },
    { start: 60, duration: 10 },
    { start: 70, duration: 10 },
  ]);
  const long = frameTimingIntervals(600);
  assert.equal(long.length, 6);
  assert.deepEqual(long[0], { start: 0, duration: 60 });
  assert.deepEqual(long.at(-1), { start: 590, duration: 10 });
  assert.equal(long.reduce((sum, interval) => sum + interval.duration, 0), 110);
});

test("frame timing classifies CFR and persistent VFR drift on a local presentation grid", () => {
  const cfr = analyzeFrameTiming([[
    { pts_time: "0" }, { pts_time: "0.033333" }, { pts_time: "0.066667" },
  ]], 30);
  assert.equal(cfr.mode, "cfr");
  assert.equal(cfr.irregular_deltas, 0);
  assert.equal(cfr.sampled_frames, 3);

  const vfr = analyzeFrameTiming([[
    { pts_time: "0" }, { pts_time: "0.033333" }, { pts_time: "0.066667" },
    { pts_time: "0.101667" }, { pts_time: "0.135000" },
  ]], 30);
  assert.equal(vfr.mode, "vfr");
  assert.equal(vfr.irregular_deltas, 1);
  assert.equal(vfr.max_deviation_ms, 1.667);
  assert.equal(vfr.cumulative_drift_ms, 1.667);
  assert.equal(vfr.nominal_frame_ms, 33.333);

  const quantized60Fps = analyzeFrameTiming([[
    { pts_time: "0" }, { pts_time: "0.016" }, { pts_time: "0.033" },
  ]], 60);
  assert.equal(quantized60Fps.mode, "cfr");
  assert.equal(quantized60Fps.irregular_deltas, 0);
});

test("nominal frame rate prefers r_frame_rate and falls back to avg_frame_rate", () => {
  assert.equal(resolveNominalFrameRate({
    rFrameRate: "30/1",
    avgFrameRate: "540000/18001",
  }), 30);
  assert.equal(resolveNominalFrameRate({
    rFrameRate: "0/0",
    avgFrameRate: "30000/1001",
  }), 30000 / 1001);
  assert.equal(resolveNominalFrameRate({ rFrameRate: "0", avgFrameRate: "0/0" }), 0);
});

test("probeMedia records frame_timing and keeps probing when packet sampling fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "akari-frame-timing-"));
  const input = join(root, "source.mp4");
  await writeFile(input, "fixture");
  const packetArgs = [];
  const spawn = (_command, args) => {
    if (args.includes("-show_format")) {
      return {
        status: 0,
        stdout: JSON.stringify({
          format: { duration: "120", format_name: "mov,mp4" },
          streams: [{
            codec_type: "video", width: 1920, height: 1080,
            r_frame_rate: "30/1", avg_frame_rate: "540000/18001", codec_name: "h264",
          }],
        }),
        stderr: "",
      };
    }
    if (args.includes("-show_packets")) {
      packetArgs.push(args);
      return {
        status: 0,
        stdout: JSON.stringify({ packets: [
          { pts_time: "0" }, { pts_time: "0.033333" }, { pts_time: "0.068333" },
        ] }),
        stderr: "",
      };
    }
    return { status: 0, stdout: "ffprobe version fixture\n", stderr: "" };
  };
  try {
    const result = await probeMedia(input, { ffprobeCommand: "ffprobe", spawn, noRecord: true });
    assert.equal(result.video.frame_timing.mode, "vfr");
    assert.equal(result.video.frame_timing.irregular_deltas, 1);
    assert.equal(result.video.frame_timing.nominal_frame_ms, 33.333);
    assert.ok(Math.abs(result.video.fps - 29.9983) < 0.0001);
    assert.equal(packetArgs.length, 1);
    const readIntervals = packetArgs[0][packetArgs[0].indexOf("-read_intervals") + 1];
    assert.equal(readIntervals.split(",").length, 6);

    const failed = await probeMedia(input, {
      ffprobeCommand: "ffprobe",
      noRecord: true,
      spawn: (_command, args) => args.includes("-show_packets")
        ? { status: 1, stdout: "", stderr: "packet failure" }
        : spawn(_command, args),
    });
    assert.equal(failed.video.frame_timing, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real ffmpeg fixtures distinguish CFR from a 1.667 ms persistent PTS shift", async (t) => {
  let ffmpeg;
  let ffprobe;
  try {
    ffmpeg = resolveFfmpeg();
    ffprobe = resolveFfprobe();
  } catch {
    t.skip("ffmpeg and ffprobe are required");
    return;
  }
  if (spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status !== 0
    || spawnSync(ffprobe, ["-version"], { stdio: "ignore" }).status !== 0) {
    t.skip("ffmpeg and ffprobe are required");
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "akari-frame-timing-real-"));
  const cfrPath = join(root, "cfr.mp4");
  const vfrPath = join(root, "vfr.mp4");
  try {
    execFileSync(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=30",
      "-t", "4", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-bf", "0", "-video_track_timescale", "30000", cfrPath,
    ]);
    const cfr = await probeMedia(cfrPath, { ffprobeCommand: ffprobe, noRecord: true });
    assert.equal(cfr.video.frame_timing.mode, "cfr");
    assert.equal(cfr.video.frame_timing.irregular_deltas, 0);
    assert.ok(Math.abs(cfr.video.frame_timing.cumulative_drift_ms) < 0.1);

    try {
      execFileSync(ffmpeg, [
        "-hide_banner", "-loglevel", "error", "-y", "-i", cfrPath,
        "-an", "-c", "copy",
        "-bsf:v", "setts=pts=if(gte(N\\,60)\\,PTS+50\\,PTS)",
        vfrPath,
      ]);
    } catch {
      t.skip("ffmpeg setts bitstream filter is unavailable");
      return;
    }
    const vfr = await probeMedia(vfrPath, { ffprobeCommand: ffprobe, noRecord: true });
    assert.equal(vfr.video.frame_timing.mode, "vfr");
    assert.equal(vfr.video.frame_timing.irregular_deltas, 1);
    assert.ok(Math.abs(vfr.video.frame_timing.cumulative_drift_ms - 1.667) <= 0.1);
    assert.ok(Math.abs(vfr.video.frame_timing.max_deviation_ms - 1.667) <= 0.1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
