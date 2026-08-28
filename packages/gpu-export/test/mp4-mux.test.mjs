import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { annexBToAvcc, buildAvcDecoderConfig, buildMp4SampleTiming, findStartCodes, muxMp4boxDirect, splitAnnexB } from "../src/mp4-mux.mjs";

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

test("mp4box writes one direct sample and finalizes moov", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpu-mp4-mux-"));
  try {
    const annexBPath = join(directory, "encoded.h264");
    const outputPath = join(directory, "output.mp4");
    await writeFile(annexBPath, bytes);
    const result = await muxMp4boxDirect({
      samples: [{ offset: 0, length: bytes.length, type: "key", timestamp: 0, duration: 33_333 }],
      annexBPath, outputPath, width: 64, height: 64, fps: 30, frames: 1,
    });
    const output = await readFile(outputPath);
    assert.equal(result.samples, 1);
    assert.equal(output.toString("ascii", 4, 8), "ftyp");
    assert.equal(output.includes(Buffer.from("moov")), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
