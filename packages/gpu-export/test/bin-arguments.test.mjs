import assert from "node:assert/strict";
import test from "node:test";

import { CliArgumentError, USAGE, parse, runCli } from "../bin/akari-gpu-export.mjs";

const REQUIRED_ARGUMENTS = ["project", "--out", "out.mp4", "--duration", "1"];

test("GPU CLI parses --audio as audioSourcePath", () => {
  const options = parse([...REQUIRED_ARGUMENTS, "--audio", "tone.m4a"]);
  assert.equal(options.audioSourcePath, "tone.m4a");
  assert.equal(options.frames, 30);
});

test("GPU CLI keeps audioSourcePath null when --audio is omitted", () => {
  assert.equal(parse(REQUIRED_ARGUMENTS).audioSourcePath, null);
});

test("GPU CLI usage lists every flag and the render-cut product route", () => {
  for (const flag of [
    "--out", "--fps", "--width", "--height", "--duration", "--frames", "--queue-depth",
    "--quality", "--bitrate", "--audio", "--soft", "--trap-readback", "--verify-frames", "--help", "-h",
  ]) {
    assert.equal(USAGE.includes(flag), true, `${flag} is documented`);
  }
  assert.match(USAGE, /render-cut --engine gpu/u);
});

test("GPU CLI --help bypasses required arguments", () => {
  assert.equal(parse(["--help"]).help, true);
  assert.equal(parse(["-h"]).help, true);
});

test("GPU CLI rejects unknown arguments with exit-code-2 errors", () => {
  assert.throws(() => parse([...REQUIRED_ARGUMENTS, "--unknown"]),
    (error) => error instanceof CliArgumentError && error.exitCode === 2 && /不明な引数/u.test(error.message));
});

test("GPU CLI rejects missing required arguments with exit-code-2 errors", () => {
  assert.throws(() => parse([]),
    (error) => error instanceof CliArgumentError && error.exitCode === 2 && /必須/u.test(error.message));
});

test("GPU CLI rejects a flag without its value with exit-code-2 errors", () => {
  assert.throws(() => parse(["project", "--out"]),
    (error) => error instanceof CliArgumentError && error.exitCode === 2 && /値を指定/u.test(error.message));
});

test("GPU CLI help writes usage to stdout and exits 0 without building", async () => {
  const stdout = [];
  let built = false;
  const exitCode = await runCli(["--help"], {
    io: { log(message) { stdout.push(message); }, error() {} },
    loadAndBuildGpuPage: async () => { built = true; },
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [USAGE]);
  assert.equal(built, false);
});

test("GPU CLI without --audio announces video-only output and exports with audioSourcePath null", async () => {
  const errors = [];
  let exported;
  const exitCode = await runCli(REQUIRED_ARGUMENTS, {
    io: { log() {}, error(message) { errors.push(message); } },
    loadAndBuildGpuPage: async () => ({ eligibility: { eligible: true, entries: [] } }),
    resolveGpuRuntimeOptions: () => ({}),
    exportWithGpu: async (options) => { exported = options; },
  });
  assert.equal(exitCode, 0);
  assert.equal(exported.audioSourcePath, null);
  assert.deepEqual(errors, [
    "akari-gpu-export: --audio 未指定のため映像のみで書き出します（音声トラックなし）。音声を付けるには --audio <path> を指定してください",
  ]);
});

test("GPU CLI refuses an existing --audio source without an audio stream before export", async () => {
  const errors = [];
  let built = false;
  let exported = false;
  const exitCode = await runCli([...REQUIRED_ARGUMENTS, "--audio", "mute.mp4"], {
    io: { log() {}, error(message) { errors.push(message); } },
    exists: () => true,
    resolveFfprobe: () => "ffprobe-fixture",
    probeAudioStream: async (options) => {
      assert.deepEqual(options, { ffprobeCommand: "ffprobe-fixture", path: "mute.mp4" });
      return false;
    },
    loadAndBuildGpuPage: async () => { built = true; },
    exportWithGpu: async () => { exported = true; },
  });
  assert.equal(exitCode, 2);
  assert.equal(built, false);
  assert.equal(exported, false);
  assert.deepEqual(errors, [
    "akari-gpu-export: --audio <path> に音声ストリームがありません。無音トラックは作らず中止します",
  ]);
});

test("GPU CLI refuses a missing --audio path without resolving ffprobe", async () => {
  let resolved = false;
  const exitCode = await runCli([...REQUIRED_ARGUMENTS, "--audio", "missing.m4a"], {
    io: { log() {}, error() {} },
    exists: () => false,
    resolveFfprobe: () => { resolved = true; return "ffprobe-fixture"; },
  });
  assert.equal(exitCode, 2);
  assert.equal(resolved, false);
});

test("GPU CLI passes a probed --audio source to export", async () => {
  let exported;
  const exitCode = await runCli([...REQUIRED_ARGUMENTS, "--audio", "tone.m4a"], {
    io: { log() {}, error() {} },
    exists: () => true,
    resolveFfprobe: () => "ffprobe-fixture",
    probeAudioStream: async () => true,
    loadAndBuildGpuPage: async () => ({ eligibility: { eligible: true, entries: [] } }),
    resolveGpuRuntimeOptions: () => ({ queueDepth: 9 }),
    exportWithGpu: async (options) => { exported = options; },
  });
  assert.equal(exitCode, 0);
  assert.equal(exported.audioSourcePath, "tone.m4a");
  assert.equal(exported.queueDepth, 9);
});

test("GPU CLI reports argument failures with usage and exits 2", async () => {
  const errors = [];
  const exitCode = await runCli([], { io: { log() {}, error(message) { errors.push(message); } } });
  assert.equal(exitCode, 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /project-dir、--out、--duration は必須です/u);
  assert.match(errors[0], /使い方: akari-gpu-export/u);
});

test("GPU CLI reserves exit 1 for export failures", async () => {
  const errors = [];
  const exitCode = await runCli(REQUIRED_ARGUMENTS, {
    io: { log() {}, error(message) { errors.push(message); } },
    loadAndBuildGpuPage: async () => { throw new Error("export failed"); },
  });
  assert.equal(exitCode, 1);
  assert.match(errors.at(-1), /export failed/u);
});
