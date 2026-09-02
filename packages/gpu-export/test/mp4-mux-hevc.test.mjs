import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildIncrementalMp4Metadata, createIncrementalMp4Writer } from "../src/mp4-mux.mjs";

const hvcc = Buffer.from([1, 1, 0x60, 0, 0, 0, 0x90]);
const keySample = Buffer.from([0, 0, 0, 2, 0x26, 0x01]);
const deltaSample = Buffer.from([0, 0, 0, 2, 0x02, 0x01]);

test("HEVC metadata writes hvc1 and embeds the hvcC description verbatim", () => {
  const metadata = buildIncrementalMp4Metadata({
    width: 1920,
    height: 1080,
    fps: 30,
    frames: 1,
    samples: [{ size: keySample.length, isKey: true }],
    decoderConfig: hvcc,
    codec: "hevc",
    mdatDataOffset: 2_000_000,
  });
  const hvc1 = locateBox(metadata.moov, "hvc1");
  const hvcC = locateBox(metadata.moov, "hvcC");
  assert.ok(hvcC.offset > hvc1.offset);
  assert.deepEqual(metadata.moov.subarray(hvcC.offset + 8, hvcC.offset + hvcC.size), hvcc);
  assert.equal(metadata.moov.includes(Buffer.from("avc1", "ascii")), false);
  assert.equal(metadata.moov.includes(Buffer.from("avcC", "ascii")), false);
});

test("HEVC writer brands hvc1 and stores length-prefixed samples without Annex B conversion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpu-hevc-mp4-"));
  const outputPath = join(directory, "out.mp4");
  try {
    const writer = await createIncrementalMp4Writer({
      outputPath, width: 64, height: 48, fps: 30, frames: 2, codec: "hevc",
    });
    writer.setDecoderConfig(hvcc, "hevc");
    await writer.write({ bytes: keySample, type: "key", timestamp: 0, duration: 33_333 });
    await writer.write({ bytes: deltaSample, type: "delta", timestamp: 33_333, duration: 33_333 });
    await writer.finish();

    const output = await readFile(outputPath);
    const ftyp = locateBox(output, "ftyp");
    assert.match(output.subarray(ftyp.offset, ftyp.offset + ftyp.size).toString("ascii"), /isomiso2hvc1mp41/u);
    assert.ok(locateBox(output, "hvc1", ftyp.offset + ftyp.size).offset > 0);
    assert.ok(locateBox(output, "hvcC").offset > 0);
    const mdat = locateBox(output, "mdat");
    assert.deepEqual(output.subarray(mdat.offset + 16, mdat.offset + mdat.size), Buffer.concat([keySample, deltaSample]));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function locateBox(bytes, type, start = 0) {
  const typeOffset = bytes.indexOf(Buffer.from(type, "ascii"), start);
  assert.ok(typeOffset >= 4, `${type} box is missing`);
  const offset = typeOffset - 4;
  const smallSize = bytes.readUInt32BE(offset);
  return { offset, size: smallSize === 1 ? Number(bytes.readBigUInt64BE(offset + 8)) : smallSize };
}
