import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import test from "node:test";

import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { verifyFinalVideo } from "../src/ffprobe.mjs";
import { resolveOsrLauncher } from "../src/index.mjs";
import { exportWithOsr, resolveOsrRuntimeOptions } from "../src/index.mjs";
import { launchElectronExport } from "../src/runner.mjs";

const execFileAsync = promisify(execFile);

test("OSR 環境変数を renderer オプションへ正規化する", () => {
  assert.deepEqual(resolveOsrRuntimeOptions({ env: {
    AKARI_OSR_SOFT: "1",
    AKARI_OSR_VERIFY: "hash",
    AKARI_OSR_QUEUE_DEPTH: "2",
    AKARI_OSR_DUMP_FRAMES: "359,0,150,150",
  } }), { soft: true, verify: "hash", queueDepth: 2, dumpFrames: [0, 150, 359] });
  assert.throws(() => resolveOsrRuntimeOptions({ env: { AKARI_OSR_QUEUE_DEPTH: "0" } }), /positive integer/);
  assert.throws(() => resolveOsrRuntimeOptions({ env: { AKARI_OSR_VERIFY: "bad" } }), /stamp\|hash\|off/);
});

test("Electron が exit 0 でも出力しない経路は mux 前に launcher エラーで止まる", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "osr-index-launcher-"));
  try {
    const out = join(projectRoot, "render", "composite.mp4");
    await mkdir(join(projectRoot, "render"), { recursive: true });
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      setImmediate(() => child.emit("close", 0, null));
      return child;
    };
    await assert.rejects(exportWithOsr({
      projectRoot,
      out,
      fps: 30,
      width: 64,
      height: 64,
      duration: 1,
      frames: 30,
      launcher: { tier: 1, kind: "desktop", executable: "/electron" },
      launcherRunner: (launcher, options) => launchElectronExport(launcher, options, { spawnImpl }),
    }), (error) => {
      assert.match(error.message, /osr-export error: OSR Electron/);
      assert.match(error.message, /単一インスタンスロック/);
      assert.doesNotMatch(error.message, /ffmpeg mux exited/);
      return true;
    });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("音声 mux は短い・長い・音声なしの全てで 90 コマを維持する", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "osr-index-"));
  const ffmpeg = resolveFfmpeg();
  const ffprobe = resolveFfprobe();
  const width = 64;
  const height = 64;
  const fps = 30;
  const frames = 90;
  const duration = frames / fps;
  const shortAudio = join(projectRoot, "short.m4a");
  const longAudio = join(projectRoot, "long.m4a");
  let shortBaselineVideo;
  let shortResult;
  try {
    await execFileAsync(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "2.993", "-c:a", "aac", shortAudio,
    ]);
    await execFileAsync(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000",
      "-t", "3.05", "-c:a", "aac", longAudio,
    ]);

    const runCase = async ({ name, audioSource, preserveVideo = false }) => {
      const renderDirectory = join(projectRoot, `render-${name}`);
      const out = join(renderDirectory, "composite.mp4");
      await mkdir(renderDirectory, { recursive: true });
      let launchedOptions;
      const result = await exportWithOsr({
        projectRoot,
        out,
        audioSourcePath: audioSource === "intermediate" ? `${out}.osr-video.mp4` : audioSource,
        fps,
        width,
        height,
        duration,
        frames,
        env: { ...process.env, AKARI_OSR_SOFT: "1", AKARI_OSR_DUMP_FRAMES: "0,89" },
        ffmpegCommand: ffmpeg,
        ffprobeCommand: ffprobe,
        launcherResolver: async () => ({ tier: 2, kind: "npm-electron", executable: "/electron" }),
        launcherRunner: async (_launcher, options) => {
          launchedOptions = options;
          await execFileAsync(ffmpeg, [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", `testsrc=size=${width}x${height}:rate=${fps}`,
            "-frames:v", String(frames), "-c:v", "libx264", "-pix_fmt", "yuv420p", options.out,
          ]);
          if (preserveVideo) {
            shortBaselineVideo = join(projectRoot, "baseline-video.mp4");
            await copyFile(options.out, shortBaselineVideo);
          }
          await writeFile(join(renderDirectory, "run.json"), JSON.stringify({
            status: "completed",
            framesRequested: frames,
            framesCompleted: frames,
            memory: { peakBytes: 10 },
          }));
        },
      });
      const video = result.run.finalVerify.measured.streams.find((stream) => stream.codec_type === "video");
      const audio = result.run.finalVerify.measured.streams.find((stream) => stream.codec_type === "audio");
      assert.equal(launchedOptions.soft, true);
      assert.deepEqual(launchedOptions.dumpFrames, [0, 89]);
      assert.equal(Number(video.nb_read_frames), frames);
      assert.equal(Number(video.duration), duration);
      assert.ok(Number(audio.duration) <= result.run.finalVerify.expected.audioMaxDuration);
      assert.equal(result.run.finalVerify.expected.audioPacketSeconds, 1024 / 48000);
      assert.equal(result.run.finalVerify.expected.audioMaxDuration, duration + Math.max(1 / fps, 1024 / 48000) + 0.002);
      assert.equal(result.run.finalVerify.checks.audioDuration, true);
      assert.equal(result.run.finalVerify.matched, true);
      assert.equal(result.receipt.finalVerify.matched, true);
      assert.equal(result.receipt.run, ".akari/osr-run.json");
      const persistentRun = JSON.parse(await readFile(join(projectRoot, ".akari", "osr-run.json"), "utf8"));
      assert.equal(persistentRun.status, "completed");
      assert.equal(persistentRun.finalVerify.matched, true);
      await assert.rejects(access(`${out}.osr-video.mp4`));
      return { out, result };
    };

    await t.test("2.993 秒の AAC でも映像を切り詰めない", async () => {
      shortResult = await runCase({ name: "short", audioSource: shortAudio, preserveVideo: true });
    });
    await t.test("3.05 秒の AAC は要求映像尺以内に収める", async () => {
      await runCase({ name: "long", audioSource: longAudio });
    });
    await t.test("音声ストリームがない source には要求尺の無音を付ける", async () => {
      await runCase({ name: "silent", audioSource: "intermediate" });
    });
    await t.test("従来の shortest 引数列は短い AAC で 90 コマ未満になる", async () => {
      const baselineOut = join(projectRoot, "baseline-shortest.mp4");
      await execFileAsync(ffmpeg, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", shortBaselineVideo, "-i", shortAudio,
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy", "-shortest", baselineOut,
      ]);
      const baseline = await verifyFinalVideo({ command: ffprobe, path: baselineOut, frames, fps, width, height, requireAudio: true });
      const baselineVideo = baseline.measured.streams.find((stream) => stream.codec_type === "video");
      assert.ok(Number(baselineVideo.nb_read_frames) < frames);
    });
    await t.test("最終映像のコマ数不一致は run に記録して失敗する", async () => {
      const renderDirectory = join(projectRoot, "render-mismatch");
      const out = join(renderDirectory, "composite.mp4");
      await mkdir(renderDirectory, { recursive: true });
      await assert.rejects(exportWithOsr({
        projectRoot,
        out,
        fps,
        width,
        height,
        duration: 91 / fps,
        frames: 91,
        ffprobeCommand: ffprobe,
        launcherResolver: async () => ({ tier: 2, kind: "npm-electron", executable: "/electron" }),
        launcherRunner: async (_launcher, options) => {
          await copyFile(shortResult.out, options.out);
          await writeFile(join(renderDirectory, "run.json"), JSON.stringify({ status: "completed", framesRequested: 91 }));
        },
      }), /final ffprobe verification failed/);
      const failedRun = JSON.parse(await readFile(join(renderDirectory, "run.json"), "utf8"));
      assert.equal(failedRun.finalVerify.matched, false);
      assert.equal(failedRun.finalVerify.checks.frames, false);
      await assert.rejects(access(`${out}.osr-video.mp4`));
    });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("60 fps・196 コマ・音声 3.4 秒の copy mux を許容する", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "osr-index-60fps-"));
  const ffmpeg = resolveFfmpeg();
  const ffprobe = resolveFfprobe();
  const width = 64;
  const height = 64;
  const fps = 60;
  const frames = 196;
  const duration = frames / fps;
  const audioPath = join(projectRoot, "long.m4a");
  const renderDirectory = join(projectRoot, "render");
  const out = join(renderDirectory, "composite.mp4");
  const baselineVideo = join(projectRoot, "baseline-video.mp4");
  try {
    await mkdir(renderDirectory, { recursive: true });
    await execFileAsync(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
      "-t", "3.4", "-c:a", "aac", audioPath,
    ]);

    const result = await exportWithOsr({
      projectRoot,
      out,
      audioSourcePath: audioPath,
      fps,
      width,
      height,
      duration,
      frames,
      env: { ...process.env, AKARI_OSR_SOFT: "1" },
      ffmpegCommand: ffmpeg,
      ffprobeCommand: ffprobe,
      launcherResolver: async () => ({ tier: 2, kind: "npm-electron", executable: "/electron" }),
      launcherRunner: async (_launcher, options) => {
        await execFileAsync(ffmpeg, [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi", "-i", `testsrc=size=${width}x${height}:rate=${fps}`,
          "-frames:v", String(frames), "-c:v", "libx264", "-pix_fmt", "yuv420p", options.out,
        ]);
        await copyFile(options.out, baselineVideo);
        await writeFile(join(renderDirectory, "run.json"), JSON.stringify({
          status: "completed",
          framesRequested: frames,
          framesCompleted: frames,
          memory: { peakBytes: 10 },
        }));
      },
    });

    const video = result.run.finalVerify.measured.streams.find((stream) => stream.codec_type === "video");
    const audio = result.run.finalVerify.measured.streams.find((stream) => stream.codec_type === "audio");
    assert.equal(Number(video.nb_read_frames), frames);
    assert.ok(Math.abs(Number(video.duration) - duration) <= 1e-6);
    assert.ok(Number(audio.duration) <= result.run.finalVerify.expected.audioMaxDuration);
    assert.equal(result.run.finalVerify.expected.audioPacketSeconds, 1024 / 48000);
    assert.equal(result.run.finalVerify.expected.audioMaxDuration, duration + Math.max(1 / fps, 1024 / 48000) + 0.002);
    assert.equal(result.run.finalVerify.checks.audioDuration, true);
    assert.equal(result.run.finalVerify.matched, true);
    const persistentRun = JSON.parse(await readFile(join(projectRoot, ".akari", "osr-run.json"), "utf8"));
    assert.equal(persistentRun.status, "completed");

    const baselineOut = join(projectRoot, "baseline-copy-without-t.mp4");
    await execFileAsync(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", baselineVideo, "-i", audioPath,
      "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy", baselineOut,
    ]);
    const baseline = await verifyFinalVideo({
      command: ffprobe,
      path: baselineOut,
      frames,
      fps,
      width,
      height,
      requireAudio: true,
    });
    const baselineAudio = baseline.measured.streams.find((stream) => stream.codec_type === "audio");
    assert.equal(baseline.checks.frames, true);
    assert.equal(baseline.checks.duration, true);
    assert.ok(Number(baselineAudio.duration) >= duration + 2 * baseline.expected.audioPacketSeconds);
    assert.ok(Number(baselineAudio.duration) > baseline.expected.audioMaxDuration);
    assert.equal(baseline.checks.audioDuration, false);
    assert.equal(baseline.matched, false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("resolveOsrLauncher はインストール済みデスクトップアプリを既定で候補から外す（明示 env は尊重）", async () => {
  const skipped = await resolveOsrLauncher({
    env: {}, platform: "darwin", homeDirectory: "/opt/akari-test",
    probe: async () => true, resolveElectron: () => null,
  });
  assert.equal(skipped.tier, 3);
  assert.equal(skipped.skippedInstalledDesktop, true);
  const explicit = await resolveOsrLauncher({
    env: { AKARI_OSR_ELECTRON: "/desktop" }, platform: "darwin", homeDirectory: "/opt/akari-test",
    probe: async (path) => path === "/desktop", resolveElectron: () => null,
  });
  assert.equal(explicit.tier, 1);
});
