import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveOsrVideoEncodeArgs, startRawVideoEncoder } from "../src/encode.mjs";
import { verifyEncodedVideo } from "../src/ffprobe.mjs";

function spawnRecorder() {
  let invocation;
  const spawnImpl = (command, args) => {
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.write = () => true;
    child.stdin.end = () => {};
    child.stdin.destroy = () => {};
    child.stderr = new EventEmitter();
    child.kill = () => {};
    invocation = { command, args };
    return child;
  };
  return { spawnImpl, invocation: () => invocation };
}

test("OSR ProRes software video args use prores_ks HQ qscale 9", () => {
  assert.deepEqual(resolveOsrVideoEncodeArgs({ quality: "high", encoder: "x264", codec: "prores422" }).args, [
    "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-vendor", "apl0", "-qscale:v", "9",
  ]);
});

test("OSR ProRes VideoToolbox video args use the hq profile", () => {
  assert.deepEqual(resolveOsrVideoEncodeArgs({ quality: "high", encoder: "videotoolbox", codec: "prores422" }).args, [
    "-c:v", "prores_videotoolbox", "-profile:v", "hq", "-allow_sw", "1", "-pix_fmt", "yuv422p10le",
  ]);
});

test("OSR ProRes MOV keeps bt709 tags and never appends the H.264 pixel format", () => {
  const recorder = spawnRecorder();
  const session = startRawVideoEncoder({
    ffmpegCommand: "ffmpeg", outputPath: "/exports/final.mov", width: 1920, height: 1080,
    outputWidth: 1920, outputHeight: 1080, fps: 30, quality: "high", encoder: "x264", codec: "prores422",
    spawnImpl: recorder.spawnImpl,
  });
  const args = session.args;
  for (const [option, value] of [
    ["-color_primaries", "bt709"],
    ["-color_trc", "bt709"],
    ["-colorspace", "bt709"],
  ]) {
    const index = args.indexOf(option);
    assert.notEqual(index, -1, option);
    assert.equal(args[index + 1], value, option);
  }
  assert.equal(args.at(-1), "/exports/final.mov");
  assert.equal(args.includes("yuv420p"), false);
});

test("OSR PNG emits image2 frame-%05d.png without MP4-only args", () => {
  const recorder = spawnRecorder();
  const session = startRawVideoEncoder({
    ffmpegCommand: "ffmpeg", outputPath: "/exports/final", width: 1920, height: 1080,
    outputWidth: 640, outputHeight: 360, fps: 30, quality: "high", encoder: "x264", codec: "png",
    spawnImpl: recorder.spawnImpl,
  });
  assert.deepEqual(session.args.slice(-4), ["-c:v", "png", "-f", "image2", "/exports/final/frame-%05d.png"].slice(-4));
  assert.equal(session.args.at(-1), "/exports/final/frame-%05d.png");
  assert.equal(session.args.includes("+faststart"), false);
  assert.equal(session.args.includes("yuv420p"), false);
});

test("OSR H.264 argument sequence is unchanged", () => {
  const recorder = spawnRecorder();
  const session = startRawVideoEncoder({
    ffmpegCommand: "ffmpeg", outputPath: "out.mp4", width: 320, height: 180,
    outputWidth: 320, outputHeight: 180, fps: 30, quality: "high", encoder: "x264", codec: "h264",
    spawnImpl: recorder.spawnImpl,
  });
  assert.deepEqual(session.args, [
    "-hide_banner", "-loglevel", "warning", "-y", "-f", "rawvideo", "-pixel_format", "bgra",
    "-video_size", "320x180", "-framerate", "30", "-i", "pipe:0", "-c:v", "libx264",
    "-profile:v", "high", "-preset", "slow", "-crf", "18", "-color_range", "tv",
    "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-movflags", "+faststart", "out.mp4",
  ]);
});

test("OSR inner verification checks ProRes codec, HQ profile, and 10-bit 4:2:2 pixels", async () => {
  const directory = await mkdtemp(join(tmpdir(), "akari-osr-prores-verify-"));
  try {
    const ffprobe = join(directory, "ffprobe.mjs");
    await writeFile(ffprobe, `#!/usr/bin/env node
console.log(JSON.stringify({streams:[{codec_type:"video",codec_name:"prores",profile:"HQ",pix_fmt:"yuv422p10le",width:320,height:180,nb_read_frames:"10",duration:"1"}],format:{duration:"1"}}));
`);
    await chmod(ffprobe, 0o755);
    const verification = await verifyEncodedVideo({ command: ffprobe, path: "out.mov", frames: 10, fps: 10, width: 320, height: 180, codec: "prores422" });
    assert.equal(verification.matched, true, JSON.stringify(verification.checks));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("OSR inner verification checks exact PNG count and first/last dimensions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "akari-osr-png-verify-"));
  try {
    const ffprobe = join(directory, "ffprobe.mjs");
    await writeFile(ffprobe, `#!/usr/bin/env node
console.log(JSON.stringify({streams:[{codec_type:"video",codec_name:"png",width:640,height:360}],format:{}}));
`);
    await chmod(ffprobe, 0o755);
    await writeFile(join(directory, "frame-00001.png"), "first");
    await writeFile(join(directory, "frame-00002.png"), "last");
    const verification = await verifyEncodedVideo({ command: ffprobe, path: directory, frames: 2, fps: 30, width: 640, height: 360, codec: "png" });
    assert.equal(verification.matched, true, JSON.stringify(verification.checks));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
