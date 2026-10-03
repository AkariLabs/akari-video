import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { COLOR_ARGS, H264_COLOR_TAG_BSF, HEVC_COLOR_TAG_BSF } from "../../render-cut/src/encode-preset.mjs";
import { exportWithOsr, muxSourceAudio } from "../src/index.mjs";

const prefix = ["-hide_banner", "-loglevel", "warning", "-y"];

async function withStubbedSpawn(run) {
  const originalSpawn = childProcess.spawn;
  const calls = [];
  let hasAudio = true;
  let probedCodec = "h264";
  childProcess.spawn = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      if (command === "ffprobe-fixture") {
        const output = args.includes("stream=index")
          ? (hasAudio ? "0\n" : "")
          : JSON.stringify({ format: { duration: "1" }, streams: [
            { codec_type: "video", codec_name: probedCodec, width: 320, height: 180, nb_read_frames: "30", duration: "1" },
            { codec_type: "audio", codec_name: "aac", sample_rate: "48000", duration: "1" },
          ] });
        child.stdout.end(output);
      } else {
        child.stdout.end();
      }
      child.stderr.end();
      setImmediate(() => child.emit("close", 0));
    });
    return child;
  };
  syncBuiltinESMExports();
  try {
    await run({
      calls,
      setHasAudio(value) { hasAudio = value; },
      setProbedCodec(value) { probedCodec = value; },
    });
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
}

test("muxSourceAudio inserts optional video tags after stream copy", async () => {
  await withStubbedSpawn(async ({ calls, setHasAudio }) => {
    for (const codec of ["h264", "hevc"]) {
      const tags = [...(codec === "h264" ? H264_COLOR_TAG_BSF : HEVC_COLOR_TAG_BSF), ...COLOR_ARGS];
      for (const sourceHasAudio of [true, false]) {
        setHasAudio(sourceHasAudio);
        calls.length = 0;
        assert.equal(await muxSourceAudio({
          ffmpegCommand: "ffmpeg-fixture", ffprobeCommand: "ffprobe-fixture",
          videoPath: "video.mp4", audioPath: "source.mp4", outputPath: "out.mp4",
          frames: 30, fps: 30, codec, videoTagArgs: tags,
        }), sourceHasAudio);
        const expected = sourceHasAudio
          ? ["-i", "video.mp4", "-i", "source.mp4", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", ...tags, "-c:a", "copy", "-t", "1", "out.mp4"]
          : ["-i", "video.mp4", "-f", "lavfi", "-t", "1", "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", ...tags, "-c:a", "aac", "-t", "1", "out.mp4"];
        assert.deepEqual(calls.map(({ command }) => command), ["ffprobe-fixture", "ffmpeg-fixture"]);
        assert.deepEqual(calls.find((call) => call.command === "ffmpeg-fixture")?.args, [...prefix, ...expected]);
      }
    }
  });
});

test("exportWithOsr keeps the baseline audio mux arguments", async () => {
  await withStubbedSpawn(async ({ calls, setHasAudio, setProbedCodec }) => {
    for (const codec of ["h264", "hevc"]) {
      setProbedCodec(codec);
      for (const sourceHasAudio of [true, false]) {
        setHasAudio(sourceHasAudio);
        calls.length = 0;
        const projectRoot = await mkdtemp(join(tmpdir(), "osr-color-tags-"));
        try {
          const renderDirectory = join(projectRoot, "render");
          const out = join(renderDirectory, "composite.mp4");
          const audioPath = join(projectRoot, "source.mp4");
          await mkdir(renderDirectory);
          await exportWithOsr({
            projectRoot, out, audioSourcePath: audioPath, codec,
            fps: 30, frames: 30, width: 320, height: 180, duration: 1,
            ffmpegCommand: "ffmpeg-fixture", ffprobeCommand: "ffprobe-fixture",
            launcher: { tier: 2, kind: "fixture", executable: "electron-fixture" },
            launcherRunner: async (_launcher, options) => {
              await writeFile(options.out, "encoded-video");
              await writeFile(join(renderDirectory, "run.json"), JSON.stringify({ status: "completed", memory: {} }));
            },
          });
          const inputs = sourceHasAudio
            ? ["-i", `${out}.osr-video.mp4`, "-i", audioPath]
            : ["-i", `${out}.osr-video.mp4`, "-f", "lavfi", "-t", "1", "-i", "anullsrc=r=48000:cl=stereo"];
          assert.deepEqual(calls.map(({ command }) => command), ["ffprobe-fixture", "ffmpeg-fixture", "ffprobe-fixture"]);
          assert.deepEqual(calls.find((call) => call.command === "ffmpeg-fixture")?.args, [
            ...prefix, ...inputs, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
            "-c:a", sourceHasAudio ? "copy" : "aac", "-t", "1", out,
          ]);
        } finally {
          await rm(projectRoot, { recursive: true, force: true });
        }
      }
    }
  });
});
