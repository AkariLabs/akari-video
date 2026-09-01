import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  annexBToAvcc,
  buildAvcDecoderConfig,
  findStartCodes,
  frameRateRational,
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

test("Annex B becomes length-prefixed AVC samples", () => {
  const converted = annexBToAvcc(bytes);
  assert.equal(converted.nals.length, 3);
  assert.equal(converted.output.readUInt32BE(0), 5);
  assert.equal(converted.output.length, bytes.length + 1);
});

test("SPS and PPS derive an AVC decoder configuration from one sample", () => {
  const config = buildAvcDecoderConfig(bytes);
  assert.equal(config[0], 1);
  assert.equal(config[1], 0x64);
  assert.ok(config.includes(0x68));
});

test("an explicit decoder configuration takes precedence", () => {
  const description = Buffer.from([1, 2, 3, 4]);
  assert.deepEqual(buildAvcDecoderConfig(Buffer.from([0]), description), description);
});

test("mux modules retain no whole-stream or subprocess implementation", async () => {
  const muxSource = stripComments(await readFile(new URL("../src/mp4-mux.mjs", import.meta.url), "utf8"));
  for (const forbidden of ["readFile", "child_process", "spawn", "@webav/mp4box.js"]) {
    assert.equal(muxSource.includes(forbidden), false, `mp4-mux must not contain ${forbidden}`);
  }
  const mainSource = stripComments(await readFile(new URL("../src/electron-main.mjs", import.meta.url), "utf8"));
  for (const forbidden of ["appendFile", "encoded.h264", "ffmpegCommand"]) {
    assert.equal(mainSource.includes(forbidden), false, `electron-main must not contain ${forbidden}`);
  }
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

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/(^|\s)\/\/.*$/gmu, "$1");
}
