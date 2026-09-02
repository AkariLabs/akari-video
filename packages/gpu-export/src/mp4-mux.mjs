import { open, rm } from "node:fs/promises";

const UINT32_MAX = 0xffff_ffff;
const MOOV_FIXED_RESERVE_BYTES = 1024 * 1024;

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

export function buildAvcDecoderConfig(sampleBytes, description = null) {
  if (description?.length > 0) return Buffer.from(description);
  let sps = null;
  let pps = null;
  for (const nal of splitAnnexB(sampleBytes)) {
    const type = nal[0] & 0x1f;
    if (type === 7 && !sps) sps = Buffer.from(nal);
    if (type === 8 && !pps) pps = Buffer.from(nal);
  }
  if (!sps || !pps || sps.length < 4) throw new Error("could not derive SPS/PPS for avcC");
  return Buffer.concat([
    Buffer.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1]),
    uint16(sps.length), sps, Buffer.from([1]), uint16(pps.length), pps,
  ]);
}

// Choosing timescale = numerator makes one frame exactly `denominator` ticks, which leaves the
// rescale from the encoder's timebase nothing to round. Integer rates and the NTSC family are
// expressed exactly; other fractional rates are declared to three decimal places.
export function frameRateRational(fps) {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("fps must be a positive number");
  if (Number.isInteger(fps)) return { num: fps, den: 1, timescale: fps, frameTicks: 1 };
  const ntscNumerator = Math.round(fps * 1001);
  if (Math.abs(ntscNumerator / 1001 - fps) < 1e-9) {
    return { num: ntscNumerator, den: 1001, timescale: ntscNumerator, frameTicks: 1001 };
  }
  const num = Math.round(fps * 1000);
  return { num, den: 1000, timescale: num, frameTicks: 1000 };
}

export function buildIncrementalMp4Metadata({
  width,
  height,
  fps,
  frames,
  samples,
  avcDecoderConfig,
  decoderConfig = avcDecoderConfig,
  codec = "h264",
  mdatDataOffset,
}) {
  validateWriterOptions({ outputPath: "metadata", width, height, fps, frames });
  if (!samples || samples.length !== frames) {
    throw new Error(`encoded sample count mismatch: expected ${frames}, got ${samples?.length ?? 0}`);
  }
  const videoCodec = normalizeVideoCodec(codec);
  if (!decoderConfig?.length) throw new Error(`${videoCodec.configBox} decoder configuration is required`);
  if (!Number.isSafeInteger(mdatDataOffset) || mdatDataOffset < 0) {
    throw new Error("mdat data offset must be a non-negative safe integer");
  }
  const rate = frameRateRational(fps);
  const trackDuration = frames * rate.frameTicks;
  if (!Number.isSafeInteger(trackDuration) || trackDuration > UINT32_MAX) {
    throw new Error("MP4 track duration exceeds the version 0 box limit");
  }
  const moov = buildMoov({
    width,
    height,
    samples,
    decoderConfig: Buffer.from(decoderConfig),
    codec: videoCodec,
    timescale: rate.timescale,
    frameTicks: rate.frameTicks,
    trackDuration,
    mdatDataOffset,
  });
  return {
    moov,
    moovBytes: moov.length,
    reservedBytes: incrementalMp4ReservedBytes(frames),
    timescale: rate.timescale,
    frameTicks: rate.frameTicks,
    trackDuration,
  };
}

export async function createIncrementalMp4Writer({ outputPath, width, height, fps, frames, codec = "h264" }) {
  validateWriterOptions({ outputPath, width, height, fps, frames });
  const videoCodec = normalizeVideoCodec(codec);
  const rate = frameRateRational(fps);
  const ftyp = buildFtyp(videoCodec);
  const reservedBytes = incrementalMp4ReservedBytes(frames);
  const moovOffset = ftyp.length;
  const mdatOffset = moovOffset + reservedBytes;
  const mdatDataOffset = mdatOffset + 16;
  const fileHandle = await open(outputPath, "w+");
  let handle = fileHandle;
  let writeOffset = mdatDataOffset;
  let mdatBytes = 0;
  let previousTimestamp = null;
  let decoderConfig = null;
  let aborted = false;
  let finished = false;
  let chain = Promise.resolve();
  const samples = [];

  try {
    await writeFully(handle, ftyp, 0);
    await writeFully(handle, boxHeader("free", reservedBytes), moovOffset);
    await writeFully(handle, largeBoxHeader("mdat", 16n), mdatOffset);
  } catch (error) {
    await handle.close().catch(() => {});
    handle = null;
    await rm(outputPath, { force: true }).catch(() => {});
    throw error;
  }

  const setDecoderConfig = (description, codecName = videoCodec.codec) => {
    const declaredCodec = normalizeVideoCodec(codecName);
    if (declaredCodec.codec !== videoCodec.codec) {
      throw new Error(`decoder configuration codec ${declaredCodec.codec} does not match writer codec ${videoCodec.codec}`);
    }
    const next = Buffer.from(description ?? []);
    if (next.length === 0) throw new Error(`${videoCodec.configBox} decoder configuration is required`);
    if (decoderConfig !== null && !decoderConfig.equals(next)) {
      throw new Error(`${videoCodec.configBox} decoder configuration was already set`);
    }
    decoderConfig ??= next;
  };

  const write = (sample) => {
    chain = chain.then(async () => {
      assertWritable();
      if (samples.length >= frames) throw new Error(`encoded sample count exceeds declared frames: ${frames}`);
      const timestamp = Number(sample?.timestamp);
      if (!Number.isFinite(timestamp)) throw new Error("encoded sample timestamp must be finite");
      if (previousTimestamp !== null && timestamp <= previousTimestamp) {
        throw new Error(`encoded sample timestamp must increase: ${timestamp} <= ${previousTimestamp}`);
      }
      const isKey = sample?.type === "key";
      if (samples.length === 0 && !isKey) throw new Error("first encoded sample must be a keyframe");
      const encodedBytes = Buffer.from(sample?.bytes ?? []);
      const description = sample?.decoderConfig?.description ?? sample?.description ?? null;
      if (description?.length > 0) setDecoderConfig(description, videoCodec.codec);
      let output;
      if (videoCodec.codec === "hevc") {
        if (samples.length === 0 && decoderConfig === null) throw new Error("hvcC decoder configuration is required before the first HEVC sample");
        // WebCodecs `hevc: { format: 'hevc' }` already produces length-prefixed samples.
        // Do not run H.264's Annex B conversion over these bytes.
        output = encodedBytes;
      } else {
        if (samples.length === 0) decoderConfig = buildAvcDecoderConfig(encodedBytes, description);
        ({ output } = annexBToAvcc(encodedBytes));
      }
      await writeFully(handle, output, writeOffset);
      writeOffset += output.length;
      mdatBytes += output.length;
      samples.push({ size: output.length, isKey });
      previousTimestamp = timestamp;
      return samples.length;
    });
    return chain;
  };

  const finish = () => {
    chain = chain.then(async () => {
      assertWritable();
      if (samples.length !== frames) {
        throw new Error(`encoded sample count mismatch: expected ${frames}, got ${samples.length}`);
      }
      const metadata = buildIncrementalMp4Metadata({
        width,
        height,
        fps,
        frames,
        samples,
        decoderConfig,
        codec: videoCodec.codec,
        mdatDataOffset,
      });
      if (metadata.moovBytes > reservedBytes - 8) {
        throw new Error(`MP4 moov exceeds reserved space: ${metadata.moovBytes} > ${reservedBytes - 8}`);
      }
      const remainingFreeBytes = reservedBytes - metadata.moovBytes;
      await writeFully(handle, metadata.moov, moovOffset);
      await writeFully(handle, boxHeader("free", remainingFreeBytes), moovOffset + metadata.moovBytes);
      await writeFully(handle, uint64(BigInt(16 + mdatBytes)), mdatOffset + 8);
      await handle.close();
      handle = null;
      finished = true;
      return {
        method: "incremental-mp4",
        samples: samples.length,
        bytes: mdatBytes,
        outputPath,
        timescale: metadata.timescale,
        trackDuration: metadata.trackDuration,
        moovOffset,
        mdatOffset,
        reservedBytes,
        moovBytes: metadata.moovBytes,
        codec: videoCodec.codec,
      };
    });
    return chain;
  };

  const abort = async () => {
    aborted = true;
    await chain.catch(() => {});
    if (handle) {
      await handle.close().catch(() => {});
      handle = null;
    }
    await rm(outputPath, { force: true });
  };

  function assertWritable() {
    if (aborted) throw new Error("incremental MP4 writer was aborted");
    if (finished || !handle) throw new Error("incremental MP4 writer is already finished");
  }

  return { setDecoderConfig, write, finish, abort };
}

function incrementalMp4ReservedBytes(frames) {
  const reservedBytes = MOOV_FIXED_RESERVE_BYTES + frames * 8 + 8;
  if (!Number.isSafeInteger(reservedBytes) || reservedBytes > UINT32_MAX) {
    throw new Error("frame count requires a free box larger than 32 bits");
  }
  return reservedBytes;
}

function validateWriterOptions({ outputPath, width, height, fps, frames }) {
  if (typeof outputPath !== "string" || outputPath.length === 0) throw new Error("outputPath is required");
  if (!Number.isInteger(width) || width <= 0 || width > 0xffff) throw new Error("width must be a positive 16-bit integer");
  if (!Number.isInteger(height) || height <= 0 || height > 0xffff) throw new Error("height must be a positive 16-bit integer");
  if (!Number.isInteger(frames) || frames <= 0) throw new Error("frames must be a positive integer");
  frameRateRational(fps);
}

function buildFtyp(codec) {
  const compatibleBrands = codec.codec === "hevc" ? "isomiso2hvc1mp41" : "isomiso2avc1mp41";
  return box("ftyp", Buffer.from("isom", "ascii"), uint32(512), Buffer.from(compatibleBrands, "ascii"));
}

function buildMoov({ width, height, samples, decoderConfig, codec, timescale, frameTicks, trackDuration, mdatDataOffset }) {
  const stszPayload = Buffer.alloc(8 + samples.length * 4);
  stszPayload.writeUInt32BE(0, 0);
  stszPayload.writeUInt32BE(samples.length, 4);
  let keyframeCount = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = sampleAt(samples, index);
    if (!Number.isInteger(sample?.size) || sample.size <= 0 || sample.size > UINT32_MAX) {
      throw new Error(`invalid encoded sample size at index ${index}`);
    }
    stszPayload.writeUInt32BE(sample.size, 8 + index * 4);
    if (sample.isKey) keyframeCount += 1;
  }
  const stssPayload = Buffer.alloc(4 + keyframeCount * 4);
  stssPayload.writeUInt32BE(keyframeCount, 0);
  let keyframeIndex = 0;
  for (let index = 0; index < samples.length; index += 1) {
    if (!sampleAt(samples, index).isKey) continue;
    stssPayload.writeUInt32BE(index + 1, 4 + keyframeIndex * 4);
    keyframeIndex += 1;
  }

  const sampleEntry = box(codec.sampleEntry, visualSampleEntry(width, height), box(codec.configBox, decoderConfig));
  const stsd = fullBox("stsd", 0, 0, uint32(1), sampleEntry);
  const stts = fullBox("stts", 0, 0, uint32(1), uint32(samples.length), uint32(frameTicks));
  const stss = fullBox("stss", 0, 0, stssPayload);
  const stsc = fullBox("stsc", 0, 0, uint32(1), uint32(1), uint32(samples.length), uint32(1));
  const stsz = fullBox("stsz", 0, 0, stszPayload);
  const co64 = fullBox("co64", 0, 0, uint32(1), uint64(BigInt(mdatDataOffset)));
  const stbl = box("stbl", stsd, stts, stss, stsc, stsz, co64);
  const minf = box("minf", fullBox("vmhd", 0, 1, Buffer.alloc(8)), buildDinf(), stbl);
  const mdia = box("mdia", buildMdhd(timescale, trackDuration), buildHdlr(), minf);
  const trak = box("trak", buildTkhd(width, height, trackDuration), mdia);
  return box("moov", buildMvhd(timescale, trackDuration), trak);
}

function normalizeVideoCodec(value) {
  if (value === undefined || value === null || value === "h264" || value === "avc1") {
    return { codec: "h264", sampleEntry: "avc1", configBox: "avcC" };
  }
  if (value === "hevc" || value === "hvc1") {
    return { codec: "hevc", sampleEntry: "hvc1", configBox: "hvcC" };
  }
  throw new Error(`MP4 video codec must be h264|hevc, got: ${value}`);
}

function sampleAt(samples, index) {
  return typeof samples.at === "function" ? samples.at(index) : samples[index];
}

function buildMvhd(timescale, duration) {
  const payload = Buffer.alloc(96);
  payload.writeUInt32BE(timescale, 8);
  payload.writeUInt32BE(duration, 12);
  payload.writeUInt32BE(0x0001_0000, 16);
  payload.writeUInt16BE(0x0100, 20);
  identityMatrix().copy(payload, 32);
  payload.writeUInt32BE(2, 92);
  return fullBox("mvhd", 0, 0, payload);
}

function buildTkhd(width, height, duration) {
  const payload = Buffer.alloc(80);
  payload.writeUInt32BE(1, 8);
  payload.writeUInt32BE(duration, 16);
  identityMatrix().copy(payload, 36);
  payload.writeUInt32BE(width * 0x1_0000, 72);
  payload.writeUInt32BE(height * 0x1_0000, 76);
  return fullBox("tkhd", 0, 7, payload);
}

function buildMdhd(timescale, duration) {
  const payload = Buffer.alloc(20);
  payload.writeUInt32BE(timescale, 8);
  payload.writeUInt32BE(duration, 12);
  payload.writeUInt16BE(0x55c4, 16);
  return fullBox("mdhd", 0, 0, payload);
}

function buildHdlr() {
  return fullBox(
    "hdlr",
    0,
    0,
    uint32(0),
    Buffer.from("vide", "ascii"),
    Buffer.alloc(12),
    Buffer.from("VideoHandler\0", "ascii"),
  );
}

function buildDinf() {
  const url = fullBox("url ", 0, 1);
  return box("dinf", fullBox("dref", 0, 0, uint32(1), url));
}

function visualSampleEntry(width, height) {
  const entry = Buffer.alloc(78);
  entry.writeUInt16BE(1, 6);
  entry.writeUInt16BE(width, 24);
  entry.writeUInt16BE(height, 26);
  entry.writeUInt32BE(0x0048_0000, 28);
  entry.writeUInt32BE(0x0048_0000, 32);
  entry.writeUInt16BE(1, 40);
  entry.writeUInt16BE(0x0018, 74);
  entry.writeUInt16BE(0xffff, 76);
  return entry;
}

function identityMatrix() {
  const matrix = Buffer.alloc(36);
  matrix.writeUInt32BE(0x0001_0000, 0);
  matrix.writeUInt32BE(0x0001_0000, 16);
  matrix.writeUInt32BE(0x4000_0000, 32);
  return matrix;
}

function box(type, ...parts) {
  const size = 8 + parts.reduce((total, part) => total + part.length, 0);
  return Buffer.concat([boxHeader(type, size), ...parts], size);
}

function fullBox(type, version, flags, ...parts) {
  const header = Buffer.from([version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff]);
  return box(type, header, ...parts);
}

function boxHeader(type, size) {
  if (!Number.isInteger(size) || size < 8 || size > UINT32_MAX) throw new Error(`invalid ${type} box size: ${size}`);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(size, 0);
  header.write(type, 4, 4, "ascii");
  return header;
}

function largeBoxHeader(type, size) {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(1, 0);
  header.write(type, 4, 4, "ascii");
  header.writeBigUInt64BE(size, 8);
  return header;
}

function uint16(value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  return bytes;
}

function uint32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function uint64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(value);
  return bytes;
}

async function writeFully(handle, bytes, position) {
  let written = 0;
  while (written < bytes.length) {
    const result = await handle.write(bytes, written, bytes.length - written, position + written);
    if (result.bytesWritten <= 0) throw new Error("MP4 write made no progress");
    written += result.bytesWritten;
  }
}
