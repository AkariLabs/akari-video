import { readFile, writeFile } from "node:fs/promises";

import MP4Box from "@webav/mp4box.js";

export function findStartCodes(bytes) {
  const starts = [];
  for (let index = 0; index + 2 < bytes.length; index += 1) {
    if (bytes[index] !== 0 || bytes[index + 1] !== 0) continue;
    if (bytes[index + 2] === 1) {
      starts.push({ offset: index, length: 3 });
      index += 2;
    } else if (index + 3 < bytes.length && bytes[index + 2] === 0 && bytes[index + 3] === 1) {
      starts.push({ offset: index, length: 4 });
      index += 3;
    }
  }
  return starts;
}

export function splitAnnexB(bytes) {
  const starts = findStartCodes(bytes);
  if (starts.length === 0) throw new Error("H.264 chunk has no Annex B start code");
  return starts.map((start, index) => bytes.subarray(
    start.offset + start.length,
    starts[index + 1]?.offset ?? bytes.length,
  )).filter((nal) => nal.length > 0);
}

export function annexBToAvcc(bytes) {
  const nals = splitAnnexB(bytes);
  const output = Buffer.alloc(nals.reduce((total, nal) => total + 4 + nal.length, 0));
  let cursor = 0;
  for (const nal of nals) {
    output.writeUInt32BE(nal.length, cursor);
    cursor += 4;
    Buffer.from(nal).copy(output, cursor);
    cursor += nal.length;
  }
  return { output, nals };
}

export function buildAvcDecoderConfig(samples, source, description = null) {
  if (description?.length > 0) return Buffer.from(description);
  let sps = null;
  let pps = null;
  for (const sample of samples) {
    const bytes = source.subarray(sample.offset, sample.offset + sample.length);
    for (const nal of splitAnnexB(bytes)) {
      const type = nal[0] & 0x1f;
      if (type === 7 && !sps) sps = Buffer.from(nal);
      if (type === 8 && !pps) pps = Buffer.from(nal);
    }
    if (sps && pps) break;
  }
  if (!sps || !pps || sps.length < 4) throw new Error("could not derive SPS/PPS for avcC");
  const spsLength = Buffer.alloc(2);
  const ppsLength = Buffer.alloc(2);
  spsLength.writeUInt16BE(sps.length);
  ppsLength.writeUInt16BE(pps.length);
  return Buffer.concat([
    Buffer.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1]),
    spsLength, sps, Buffer.from([1]), ppsLength, pps,
  ]);
}

export function buildMp4SampleTiming({ fps, frames, timescale = 1_000_000 }) {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("fps must be a positive number");
  if (!Number.isInteger(frames) || frames <= 0) throw new Error("frames must be a positive integer");
  if (!Number.isInteger(timescale) || timescale <= 0) throw new Error("timescale must be a positive integer");
  const boundaries = Array.from({ length: frames + 1 }, (_value, index) => Math.round(index * timescale / fps));
  const timestamps = boundaries.slice(0, -1);
  const durations = timestamps.map((_timestamp, index) => boundaries[index + 1] - boundaries[index]);
  if (durations.some((duration) => duration <= 0)) throw new Error("fps is too high for the selected MP4 timescale");
  return {
    timescale,
    timestamps,
    durations,
    trackDuration: boundaries.at(-1),
    defaultSampleDuration: Math.round(timescale / fps),
  };
}

export async function muxMp4boxDirect({ samples, annexBPath, outputPath, width, height, fps, frames, decoderConfigDescription = null }) {
  if (samples.length !== frames) throw new Error(`encoded sample count mismatch: expected ${frames}, got ${samples.length}`);
  const source = await readFile(annexBPath);
  const avcC = buildAvcDecoderConfig(samples, source, decoderConfigDescription);
  const file = MP4Box.createFile();
  const timing = buildMp4SampleTiming({ fps, frames });
  const track = file.addTrack({
    timescale: timing.timescale,
    duration: timing.trackDuration,
    media_duration: timing.trackDuration,
    width,
    height,
    hdlr: "vide",
    type: "avc1",
    avcDecoderConfigRecord: exactArrayBuffer(avcC),
    default_sample_duration: timing.defaultSampleDuration,
  });
  for (const [index, sample] of samples.entries()) {
    const bytes = source.subarray(sample.offset, sample.offset + sample.length);
    const timestamp = timing.timestamps[index];
    file.addSample(track, exactArrayBuffer(annexBToAvcc(bytes).output), {
      duration: timing.durations[index],
      dts: timestamp,
      cts: timestamp,
      is_sync: sample.type === "key",
    });
  }
  await writeFile(outputPath, Buffer.from(file.getBuffer()));
  return {
    method: "mp4box-direct",
    samples: samples.length,
    bytes: source.length,
    outputPath,
    timescale: timing.timescale,
    trackDuration: timing.trackDuration,
  };
}

function exactArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
