import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { startRawVideoEncoder } from "../src/encode.mjs";

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

test("different output dimensions insert a Lanczos scale before video encoding args", () => {
  const recorder = spawnRecorder();
  const session = startRawVideoEncoder({
    ffmpegCommand: "ffmpeg", outputPath: "out.mp4", width: 1920, height: 1080,
    outputWidth: 1280, outputHeight: 720, fps: 30, quality: "standard", encoder: "x264",
    spawnImpl: recorder.spawnImpl,
  });
  const args = session.args;
  const scaleIndex = args.indexOf("-vf");
  assert.notEqual(scaleIndex, -1);
  assert.equal(args[scaleIndex + 1], "scale=1280:720:flags=lanczos");
  assert.ok(scaleIndex < args.indexOf("-c:v"));
});

test("same output dimensions leave the ffmpeg argument list unfiltered", () => {
  const recorder = spawnRecorder();
  const session = startRawVideoEncoder({
    ffmpegCommand: "ffmpeg", outputPath: "out.mp4", width: 1280, height: 720,
    outputWidth: 1280, outputHeight: 720, fps: 30, quality: "standard", encoder: "x264",
    spawnImpl: recorder.spawnImpl,
  });
  assert.equal(session.args.includes("-vf"), false);
});
