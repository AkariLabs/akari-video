import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  annexBToAvcc,
  buildAvcDecoderConfig,
  buildIncrementalMp4Metadata,
  createIncrementalMp4Writer,
  findStartCodes,
  frameRateRational,
  splitAnnexB,
} from "../src/mp4-mux.mjs";

const keySample = Buffer.from([
  0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28, 0xaa,
  0, 0, 1, 0x68, 0xbb, 0xcc,
  0, 0, 0, 1, 0x65, 0xdd,
]);
const deltaSample = Buffer.from([0, 0, 1, 0x41, 0x9a, 0x22]);

test("writer places moov in the reservation and records one 64-bit mdat chunk", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpu-incremental-mp4-"));
  const outputPath = join(directory, "out.mp4");
  try {
    const writer = await createIncrementalMp4Writer({ outputPath, width: 64, height: 48, fps: 30, frames: 3 });
    await writer.write({ bytes: keySample, type: "key", timestamp: 0, duration: 33_333 });
    await writer.write({ bytes: deltaSample, type: "delta", timestamp: 33_333, duration: 33_333 });
    await writer.write({ bytes: deltaSample, type: "key", timestamp: 66_666, duration: 33_333 });
    const result = await writer.finish();
    const output = await readFile(outputPath);
    const boxes = topLevelBoxes(output);
    assert.deepEqual(boxes.map((entry) => entry.type), ["ftyp", "moov", "free", "mdat"]);
    assert.equal(boxes[1].offset, result.moovOffset);
    assert.equal(boxes[1].size, result.moovBytes);
    assert.equal(boxes[1].size + boxes[2].size, result.reservedBytes);
    assert.equal(boxes[3].offset, result.mdatOffset);
    assert.equal(output.readUInt32BE(boxes[3].offset), 1);
    assert.equal(Number(output.readBigUInt64BE(boxes[3].offset + 8)), 16 + result.bytes);

    const expectedSizes = [keySample, deltaSample, deltaSample].map((sample) => annexBToAvcc(sample).output.length);
    const stsz = locateBox(output, "stsz");
    assert.equal(output.readUInt32BE(stsz.offset + 12), 0);
    assert.equal(output.readUInt32BE(stsz.offset + 16), 3);
    assert.deepEqual(Array.from({ length: 3 }, (_value, index) => output.readUInt32BE(stsz.offset + 20 + index * 4)), expectedSizes);

    const stss = locateBox(output, "stss");
    assert.equal(output.readUInt32BE(stss.offset + 12), 2);
    assert.deepEqual([output.readUInt32BE(stss.offset + 16), output.readUInt32BE(stss.offset + 20)], [1, 3]);
    const co64 = locateBox(output, "co64");
    assert.equal(output.readUInt32BE(co64.offset + 12), 1);
    assert.equal(Number(output.readBigUInt64BE(co64.offset + 16)), result.mdatOffset + 16);
    const stts = locateBox(output, "stts");
    assert.equal(output.readUInt32BE(stts.offset + 12), 1);
    assert.equal(output.readUInt32BE(stts.offset + 16), 3);
    assert.equal(output.readUInt32BE(stts.offset + 20), frameRateRational(30).frameTicks);
    const stsc = locateBox(output, "stsc");
    assert.equal(output.readUInt32BE(stsc.offset + 12), 1);
    assert.deepEqual([
      output.readUInt32BE(stsc.offset + 16),
      output.readUInt32BE(stsc.offset + 20),
      output.readUInt32BE(stsc.offset + 24),
    ], [1, 3, 1]);
    const mdhd = locateBox(output, "mdhd");
    assert.equal(output.readUInt32BE(mdhd.offset + 20), frameRateRational(30).timescale);
    assert.equal(output.readUInt32BE(mdhd.offset + 24), 3 * frameRateRational(30).frameTicks);
    assert.equal(result.method, "incremental-mp4");
    assert.equal(result.samples, 3);
    assert.equal(result.bytes, expectedSizes.reduce((sum, size) => sum + size, 0));
    assert.equal(result.timescale, 30);
    assert.equal(result.trackDuration, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("writer rejects invalid sample order and removes aborted output", async (t) => {
  await t.test("first sample must be key", async () => {
    await expectWriterFailure(1, async (writer) => {
      await assert.rejects(writer.write({ bytes: deltaSample, type: "delta", timestamp: 0 }), /first encoded sample/u);
    });
  });
  await t.test("timestamps must increase", async () => {
    await expectWriterFailure(2, async (writer) => {
      await writer.write({ bytes: keySample, type: "key", timestamp: 10 });
      await assert.rejects(writer.write({ bytes: deltaSample, type: "delta", timestamp: 9 }), /timestamp must increase/u);
    });
  });
  await t.test("finish requires the declared sample count and names the missing frames", async () => {
    await expectWriterFailure(2, async (writer) => {
      await writer.write({ bytes: keySample, type: "key", timestamp: 0 });
      await assert.rejects(writer.finish({ encoderFrames: 2 }), /expected 2, got 1; encoder submitted 2 \(missing frames: 1\)/u);
    });
  });
  await t.test("finish without the encoder count still reports the missing frames", async () => {
    await expectWriterFailure(3, async (writer) => {
      await writer.write({ bytes: keySample, type: "key", timestamp: 0 });
      await writer.write({ bytes: deltaSample, type: "delta", timestamp: 66_667 });
      await assert.rejects(writer.finish(), /expected 3, got 2 \(missing frames: 1\)/u);
    });
  });
  await t.test("write refuses samples beyond the declaration", async () => {
    await expectWriterFailure(1, async (writer) => {
      await writer.write({ bytes: keySample, type: "key", timestamp: 0 });
      await assert.rejects(writer.write({ bytes: deltaSample, type: "delta", timestamp: 1 }), /exceeds declared frames/u);
    });
  });
});

test("the reservation bounds a moov built for large frame counts", () => {
  const avcDecoderConfig = buildAvcDecoderConfig(keySample);
  for (const frames of [1, 6, 1000, 159_297, 1_000_000]) {
    const repeatedKeySample = { size: 1, isKey: true };
    const samples = { length: frames, at: () => repeatedKeySample };
    const metadata = buildIncrementalMp4Metadata({
      width: 1280,
      height: 720,
      fps: 30,
      frames,
      samples,
      avcDecoderConfig,
      mdatDataOffset: 16_000_000,
    });
    assert.ok(metadata.moovBytes <= metadata.reservedBytes - 8, `${frames} frames overflowed the reservation`);
  }
});

test("real H.264 samples produce an MP4 with the declared frame count", { skip: await mediaToolsSkipReason() }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpu-incremental-mp4-real-"));
  const sourcePath = join(directory, "source.h264");
  const outputPath = join(directory, "out.mp4");
  try {
    await run(resolveFfmpeg(), [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=64x64:rate=30",
      "-frames:v", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-x264-params", "aud=1:keyint=3:min-keyint=3:scenecut=0",
      "-f", "h264", sourcePath,
    ]);
    const accessUnits = splitAccessUnits(await readFile(sourcePath));
    assert.equal(accessUnits.length, 6);
    const writer = await createIncrementalMp4Writer({ outputPath, width: 64, height: 64, fps: 30, frames: 6 });
    for (let index = 0; index < accessUnits.length; index += 1) {
      const isKey = splitAnnexB(accessUnits[index]).some((nal) => (nal[0] & 0x1f) === 5);
      await writer.write({
        bytes: accessUnits[index],
        type: isKey ? "key" : "delta",
        timestamp: Math.round(index / 30 * 1e6),
        duration: Math.round(1e6 / 30),
      });
    }
    const result = await writer.finish();
    const probe = JSON.parse(await run(resolveFfprobe(), [
      "-v", "error", "-count_frames", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,width,height,nb_read_frames,duration",
      "-of", "json", outputPath,
    ], true));
    assert.equal(probe.streams[0].codec_name, "h264");
    assert.equal(probe.streams[0].width, 64);
    assert.equal(probe.streams[0].height, 64);
    assert.equal(Number(probe.streams[0].nb_read_frames), 6);
    assert.equal(result.timescale, frameRateRational(30).timescale);
    assert.equal(result.trackDuration, 6 * frameRateRational(30).frameTicks);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function expectWriterFailure(frames, operation) {
  const directory = await mkdtemp(join(tmpdir(), "gpu-incremental-mp4-reject-"));
  const outputPath = join(directory, "out.mp4");
  const writer = await createIncrementalMp4Writer({ outputPath, width: 64, height: 48, fps: 30, frames });
  try {
    await operation(writer);
    await writer.abort();
    await assert.rejects(stat(outputPath), { code: "ENOENT" });
  } finally {
    await writer.abort().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}

function topLevelBoxes(bytes) {
  const boxes = [];
  let offset = 0;
  while (offset < bytes.length) {
    const smallSize = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const size = smallSize === 1 ? Number(bytes.readBigUInt64BE(offset + 8)) : smallSize;
    assert.ok(size >= (smallSize === 1 ? 16 : 8), `invalid ${type} size ${size}`);
    boxes.push({ type, offset, size });
    offset += size;
  }
  assert.equal(offset, bytes.length);
  return boxes;
}

function locateBox(bytes, type) {
  const typeOffset = bytes.indexOf(Buffer.from(type, "ascii"));
  assert.ok(typeOffset >= 4, `${type} box is missing`);
  return { offset: typeOffset - 4, size: bytes.readUInt32BE(typeOffset - 4) };
}

function splitAccessUnits(bytes) {
  const starts = findStartCodes(bytes)
    .filter((start) => (bytes[start.offset + start.length] & 0x1f) === 9)
    .map((start) => start.offset);
  return starts.map((offset, index) => bytes.subarray(offset, starts[index + 1] ?? bytes.length));
}

function resolveFfmpeg() {
  return process.env.FFMPEG ?? process.env.AKARI_FFMPEG_BIN ?? "ffmpeg";
}

function resolveFfprobe() {
  return process.env.FFPROBE ?? process.env.AKARI_FFPROBE_BIN ?? "ffprobe";
}

function run(command, args, capture = false) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", rejectPromise);
    child.once("close", (code) => (code === 0 ? resolvePromise(stdout) : rejectPromise(new Error(stderr.trim()))));
  });
}

async function mediaToolsSkipReason() {
  try {
    await run(resolveFfmpeg(), [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=16x16:rate=30",
      "-frames:v", "1", "-c:v", "libx264", "-f", "null", "-",
    ]);
    await run(resolveFfprobe(), ["-version"]);
    return false;
  } catch {
    return "ffmpeg with libx264 and ffprobe are required";
  }
}
