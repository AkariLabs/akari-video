import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { COLOR_ARGS, H264_COLOR_TAG_BSF, HEVC_COLOR_TAG_BSF } from "../../render-cut/src/encode-preset.mjs";
import { exportWithGpu } from "../src/index.mjs";

async function runCase({ codec, withAudio, soft, defaultTagger = false, defaultMuxer = false }) {
  const projectRoot = await mkdtemp(join(tmpdir(), "gpu-color-tags-"));
  const renderDirectory = join(projectRoot, "render");
  const out = join(renderDirectory, "composite.mp4");
  await mkdir(renderDirectory);
  let tagOptions;
  let muxOptions;
  try {
    await exportWithGpu({
      projectRoot, out, codec, soft,
      audioSourcePath: withAudio ? join(projectRoot, "audio.mp4") : null,
      ffmpegCommand: "ffmpeg-fixture", ffprobeCommand: "ffprobe-fixture",
      fps: 30, frames: 30, width: 320, height: 180, duration: 1,
      eligibility: { eligible: true, entries: [] },
      io: { log() {}, error() {} },
      launcher: { tier: 2, kind: "fixture", executable: "electron-fixture" },
      launcherRunner: async (_launcher, options) => {
        await writeFile(options.out, "encoded-video");
        await writeFile(join(renderDirectory, "run.json"), JSON.stringify({ status: "completed", gpu: {}, memory: {} }));
      },
      ...(!defaultTagger ? { videoTagger: async (options) => {
        tagOptions = options;
        await writeFile(options.outputPath, "tagged-video");
      } } : {}),
      ...(!defaultMuxer ? { audioMuxer: async (options) => {
        muxOptions = options;
        await writeFile(options.outputPath, "muxed-video");
        return true;
      } } : {}),
      finalVerifier: async () => ({
        matched: true, checks: { frames: true },
        measured: { streams: [
          { codec_type: "video", codec_name: codec, duration: "1" },
          ...(withAudio ? [{ codec_type: "audio", duration: "1" }] : []),
        ] },
      }),
    });
    return { tagOptions, muxOptions, out, content: await readFile(out, "utf8") };
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("default video tagger streams a video-only MP4 through ffmpeg", async () => {
  const originalSpawn = childProcess.spawn;
  const calls = [];
  childProcess.spawn = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    queueMicrotask(async () => {
      try {
        await writeFile(args.at(-1), "tagged-video");
        child.emit("close", 0);
      } catch (error) {
        child.emit("error", error);
      }
    });
    return child;
  };
  syncBuiltinESMExports();
  try {
    for (const codec of ["h264", "hevc"]) {
      const result = await runCase({ codec, withAudio: false, soft: false, defaultTagger: true });
      assert.equal(result.content, "tagged-video");
      assert.deepEqual(calls.at(-1), {
        command: "ffmpeg-fixture",
        args: ["-hide_banner", "-loglevel", "warning", "-y", "-i", `${result.out}.gpu-video.mp4`,
          "-map", "0:v:0", "-c:v", "copy", ...(codec === "h264" ? H264_COLOR_TAG_BSF : HEVC_COLOR_TAG_BSF),
          ...COLOR_ARGS, result.out],
      });
    }
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});

test("default video tagger reports ffmpeg failure without copying the untagged video", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "gpu-color-tags-"));
  const renderDirectory = join(projectRoot, "render");
  const out = join(renderDirectory, "composite.mp4");
  const videoOnlyPath = `${out}.gpu-video.mp4`;
  const originalSpawn = childProcess.spawn;
  await mkdir(renderDirectory);
  childProcess.spawn = () => {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.stderr.end("tagging failed\n");
      setImmediate(() => child.emit("close", 7));
    });
    return child;
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(exportWithGpu({
      projectRoot, out, codec: "h264", soft: false,
      ffmpegCommand: "ffmpeg-fixture", ffprobeCommand: "ffprobe-fixture",
      fps: 30, frames: 30, width: 320, height: 180, duration: 1,
      eligibility: { eligible: true, entries: [] },
      launcher: { tier: 2, kind: "fixture", executable: "electron-fixture" },
      launcherRunner: async (_launcher, options) => {
        await writeFile(options.out, "encoded-video");
        await writeFile(join(renderDirectory, "run.json"), JSON.stringify({ status: "completed", gpu: {}, memory: {} }));
      },
      finalVerifier: async () => assert.fail("failed tagging must stop before final verification"),
    }), /tagging failed/u);
    await assert.rejects(readFile(out), { code: "ENOENT" });
    await assert.rejects(readFile(videoOnlyPath), { code: "ENOENT" });
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("default audio muxer tags copied GPU video and leaves soft output unchanged", async () => {
  const originalSpawn = childProcess.spawn;
  const calls = [];
  let sourceHasAudio = true;
  childProcess.spawn = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(async () => {
      try {
        if (command === "ffprobe-fixture") {
          assert.ok(args.includes("stream=index"));
          child.stdout.end(sourceHasAudio ? "0\n" : "");
        } else {
          await writeFile(args.at(-1), "muxed-video");
          child.stdout.end();
        }
        child.stderr.end();
        setImmediate(() => child.emit("close", 0));
      } catch (error) {
        child.emit("error", error);
      }
    });
    return child;
  };
  syncBuiltinESMExports();
  try {
    for (const codec of ["h264", "hevc"]) {
      for (const hasAudio of [true, false]) {
        sourceHasAudio = hasAudio;
        for (const soft of [false, true]) {
          calls.length = 0;
          const result = await runCase({ codec, withAudio: true, soft, defaultMuxer: true });
          const tags = soft ? [] : [
            ...(codec === "h264" ? H264_COLOR_TAG_BSF : HEVC_COLOR_TAG_BSF), ...COLOR_ARGS,
          ];
          const inputs = hasAudio
            ? ["-i", `${result.out}.gpu-video.mp4`, "-i", join(dirname(dirname(result.out)), "audio.mp4")]
            : ["-i", `${result.out}.gpu-video.mp4`, "-f", "lavfi", "-t", "1", "-i", "anullsrc=r=48000:cl=stereo"];
          const expected = [
            "-hide_banner", "-loglevel", "warning", "-y", ...inputs,
            "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", ...tags,
            "-c:a", hasAudio ? "copy" : "aac", "-t", "1", result.out,
          ];
          assert.deepEqual(calls.map(({ command }) => command), ["ffprobe-fixture", "ffmpeg-fixture"]);
          assert.deepEqual(calls[1].args, expected);
          assert.equal(result.content, "muxed-video");
        }
      }
    }
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});

for (const codec of ["h264", "hevc"]) {
  const expected = [...(codec === "h264" ? H264_COLOR_TAG_BSF : HEVC_COLOR_TAG_BSF), ...COLOR_ARGS];
  test(`GPU ${codec} video-only tags the final output`, async () => {
    const result = await runCase({ codec, withAudio: false, soft: false });
    assert.equal(result.tagOptions.ffmpegCommand, "ffmpeg-fixture");
    assert.equal(result.tagOptions.videoPath, `${result.out}.gpu-video.mp4`);
    assert.equal(result.tagOptions.outputPath, result.out);
    assert.deepEqual(result.tagOptions.videoTagArgs, expected);
    assert.equal(result.muxOptions, undefined);
    assert.equal(result.content, "tagged-video");
  });

  test(`GPU ${codec} audio mux receives codec-specific tags`, async () => {
    const result = await runCase({ codec, withAudio: true, soft: false });
    assert.equal(result.tagOptions, undefined);
    assert.deepEqual(result.muxOptions.videoTagArgs, expected);
    assert.equal(result.content, "muxed-video");
  });

  test(`soft ${codec} keeps its own color tags`, async () => {
    const videoOnly = await runCase({ codec, withAudio: false, soft: true });
    assert.equal(videoOnly.tagOptions, undefined);
    assert.equal(videoOnly.muxOptions, undefined);
    assert.equal(videoOnly.content, "encoded-video");
    const withAudio = await runCase({ codec, withAudio: true, soft: true });
    assert.equal(withAudio.tagOptions, undefined);
    assert.equal(Object.hasOwn(withAudio.muxOptions, "videoTagArgs"), false);
    assert.equal(withAudio.content, "muxed-video");
  });
}
