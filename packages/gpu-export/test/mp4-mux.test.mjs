import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  annexBToAvcc,
  buildAvcDecoderConfig,
  buildMp4SampleTiming,
  buildRemuxArguments,
  findStartCodes,
  frameRateRational,
  muxEncodedVideo,
  splitAnnexB,
} from "../src/mp4-mux.mjs";

const bytes = Buffer.from([
  0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28, 0xaa,
  0, 0, 1, 0x68, 0xbb, 0xcc,
  0, 0, 0, 1, 0x65, 0xdd,
]);

test("Annex B recognizes three- and four-byte start codes", () => {
  assert.deepEqual(findStartCodes(bytes), [
    { offset: 0, length: 4 }, { offset: 9, length: 3 }, { offset: 15, length: 4 },
  ]);
  assert.deepEqual(splitAnnexB(bytes).map((nal) => nal[0] & 0x1f), [7, 8, 5]);
});

test("Annex B becomes length-prefixed avcC samples", () => {
  const converted = annexBToAvcc(bytes);
  assert.equal(converted.nals.length, 3);
  assert.equal(converted.output.readUInt32BE(0), 5);
});

test("SPS and PPS derive an AVC decoder configuration", () => {
  const config = buildAvcDecoderConfig([{ offset: 0, length: bytes.length }], bytes);
  assert.equal(config[0], 1);
  assert.equal(config[1], 0x64);
  assert.ok(config.includes(0x68));
});

for (const fps of [30, 60, 24]) {
  test(`${fps}fps sample timing has zero cumulative rounding error`, () => {
    const frames = fps * 12;
    const timing = buildMp4SampleTiming({ fps, frames });
    assert.equal(timing.timestamps.length, frames);
    assert.equal(timing.durations.length, frames);
    for (let index = 0; index < frames; index += 1) {
      assert.equal(timing.timestamps[index], Math.round(index * timing.timescale / fps));
      assert.equal(timing.durations[index], Math.round((index + 1) * timing.timescale / fps) - timing.timestamps[index]);
    }
    assert.ok(Math.max(...timing.durations) - Math.min(...timing.durations) <= 1);
    assert.equal(timing.durations.reduce((sum, value) => sum + value, 0), 12_000_000);
    assert.equal(timing.trackDuration, 12_000_000);
  });
}

// The regression this whole path exists for. fs.readFile carries its own 2 GiB cap (kIoMaxLength),
// separate from buffer.constants.MAX_LENGTH, and throws ERR_FS_FILE_TOO_LARGE above it -- so the
// previous in-memory mux could not write a single byte for any export whose elementary stream
// passed 2 GiB (a 720p30 1:28:30 export produces 7.4 GiB). Reading the stream at all is the defect;
// this asserts the module never does, rather than trying to stage a multi-gigabyte fixture in CI.
test("the elementary stream is never read into this process's memory", async () => {
  const source = await readFile(new URL("../src/mp4-mux.mjs", import.meta.url), "utf8");
  // Comments are stripped first so the explanation of the defect cannot satisfy the check.
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/(^|\s)\/\/.*$/gmu, "$1");
  assert.equal(
    /\breadFile\b/.test(code),
    false,
    "mp4-mux must hand the Annex B path to ffmpeg, never buffer it (fs.readFile caps at 2 GiB)",
  );
});

test("integer frame rates put one frame on exactly one tick", () => {
  for (const fps of [24, 25, 30, 50, 60]) {
    assert.deepEqual(frameRateRational(fps), { num: fps, den: 1, timescale: fps, frameTicks: 1 });
  }
});

test("NTSC frame rates stay exact rationals", () => {
  assert.deepEqual(frameRateRational(30000 / 1001), { num: 30000, den: 1001, timescale: 30000, frameTicks: 1001 });
  assert.deepEqual(frameRateRational(24000 / 1001), { num: 24000, den: 1001, timescale: 24000, frameTicks: 1001 });
});

test("other fractional rates keep exact ticks at three declared decimals", () => {
  assert.deepEqual(frameRateRational(30.5), { num: 30500, den: 1000, timescale: 30500, frameTicks: 1000 });
});

test("a non-positive frame rate is refused", () => {
  assert.throws(() => frameRateRational(0), /positive/u);
  assert.throws(() => frameRateRational(Number.NaN), /positive/u);
});

test("the remux argv copies the bitstream, drops audio, and writes moov first", () => {
  const args = buildRemuxArguments({
    annexBPath: "/tmp/encoded.h264",
    outputPath: "/tmp/out.mp4",
    rate: frameRateRational(30),
  });
  assert.deepEqual(args, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "h264",
    "-framerate", "30/1",
    "-i", "/tmp/encoded.h264",
    "-c:v", "copy",
    "-an",
    "-video_track_timescale", "30",
    "-movflags", "+faststart",
    "/tmp/out.mp4",
  ]);
});

test("a sample count that disagrees with the frame count is refused before spawning", async () => {
  let spawned = false;
  await assert.rejects(
    muxEncodedVideo({
      samples: [{ offset: 0, length: 1, type: "key" }],
      annexBPath: "/tmp/missing.h264",
      outputPath: "/tmp/out.mp4",
      fps: 30,
      frames: 2,
      ffmpegCommand: "ffmpeg",
      spawnImpl: () => { spawned = true; throw new Error("must not spawn"); },
    }),
    /encoded sample count mismatch: expected 2, got 1/u,
  );
  assert.equal(spawned, false);
});

test("the mux reports the method, the stream size, and exact track timing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpu-mp4-mux-"));
  try {
    const annexBPath = join(directory, "encoded.h264");
    await writeFile(annexBPath, bytes);
    let seenArgs = null;
    const result = await muxEncodedVideo({
      samples: [{ offset: 0, length: bytes.length, type: "key" }],
      annexBPath,
      outputPath: join(directory, "out.mp4"),
      fps: 30,
      frames: 1,
      ffmpegCommand: "ffmpeg",
      spawnImpl: (_command, args) => {
        seenArgs = args;
        return fakeChild(0);
      },
    });
    assert.equal(result.method, "ffmpeg-remux");
    assert.equal(result.samples, 1);
    assert.equal(result.bytes, bytes.length);
    assert.equal(result.timescale, 30);
    assert.equal(result.trackDuration, 1);
    assert.ok(seenArgs.includes(annexBPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a non-zero ffmpeg exit surfaces its stderr", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpu-mp4-mux-"));
  try {
    const annexBPath = join(directory, "encoded.h264");
    await writeFile(annexBPath, bytes);
    await assert.rejects(
      muxEncodedVideo({
        samples: [{ offset: 0, length: bytes.length, type: "key" }],
        annexBPath,
        outputPath: join(directory, "out.mp4"),
        fps: 30,
        frames: 1,
        ffmpegCommand: "ffmpeg",
        spawnImpl: () => fakeChild(1, "Invalid data found when processing input"),
      }),
      /ffmpeg remux exited 1: Invalid data found when processing input/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real ffmpeg produces a faststart mp4 whose moov precedes mdat", { skip: await ffmpegSkipReason() }, async () => {
  const ffmpegCommand = resolveTestFfmpeg();
  const directory = await mkdtemp(join(tmpdir(), "gpu-mp4-mux-real-"));
  try {
    const annexBPath = join(directory, "encoded.h264");
    const outputPath = join(directory, "out.mp4");
    await run(ffmpegCommand, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=64x64:rate=30",
      "-frames:v", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-f", "h264", annexBPath,
    ]);
    const result = await muxEncodedVideo({
      samples: Array.from({ length: 6 }, () => ({ type: "key" })),
      annexBPath,
      outputPath,
      fps: 30,
      frames: 6,
      ffmpegCommand,
    });
    const output = await readFile(outputPath);
    assert.equal(result.method, "ffmpeg-remux");
    assert.equal(output.toString("ascii", 4, 8), "ftyp");
    const moov = output.indexOf(Buffer.from("moov"));
    const mdat = output.indexOf(Buffer.from("mdat"));
    assert.ok(moov > 0, "muxed file has no moov box");
    assert.ok(mdat > 0, "muxed file has no mdat box");
    assert.ok(moov < mdat, `faststart failed: moov at ${moov} is not before mdat at ${mdat}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function fakeChild(code, stderr = "") {
  const listeners = new Map();
  const child = {
    stderr: { on: (event, handler) => { if (event === "data" && stderr) handler(Buffer.from(stderr)); } },
    once: (event, handler) => { listeners.set(event, handler); return child; },
  };
  queueMicrotask(() => listeners.get("close")?.(code, null));
  return child;
}

function resolveTestFfmpeg() {
  return process.env.FFMPEG ?? process.env.AKARI_FFMPEG_BIN ?? "ffmpeg";
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", rejectPromise);
    child.once("close", (code) => (code === 0 ? resolvePromise() : rejectPromise(new Error(stderr.trim()))));
  });
}

// Vendor binaries are not present in every checkout, and libx264 is not guaranteed even when ffmpeg
// is, so the end-to-end case reports why it stood down instead of failing the suite.
async function ffmpegSkipReason() {
  try {
    await run(resolveTestFfmpeg(), ["-hide_banner", "-loglevel", "error", "-f", "lavfi",
      "-i", "testsrc=size=16x16:rate=30", "-frames:v", "1", "-c:v", "libx264", "-f", "null", "-"]);
    return false;
  } catch {
    return "ffmpeg with libx264 is unavailable in this checkout";
  }
}
