import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

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

// annexBToAvcc, buildAvcDecoderConfig and buildMp4SampleTiming are no longer on the live mux path:
// ffmpeg's h264 demuxer reads the elementary stream directly, so nothing here converts to AVCC,
// derives an avcC, or computes per-sample timing any more. They stay exported because an
// incremental muxer -- the one shape that could carry each sample's own duration through this
// path -- would need exactly this logic again, and because they are covered by their own tests.
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

// The MP4Box path built the whole MP4 in memory: it read the entire Annex B elementary stream with
// fs.readFile and then materialised the muxed result through getBuffer(). fs.readFile carries its
// own 2 GiB cap (kIoMaxLength) that is independent of buffer.constants.MAX_LENGTH, so any export
// whose elementary stream passed 2 GiB threw ERR_FS_FILE_TOO_LARGE -- "File size (…) is greater
// than 2 GiB" -- before a single byte of MP4 was written. That is not an edge case at delivery
// bitrates: a 1280x720 / 30 fps / 1:28:30 export produces a 7.4 GiB stream.
//
// ffmpeg streams the same remux with a flat memory profile, so duration no longer bounds what can
// be muxed. `-c:v copy` keeps it a remux: the encoder's own H.264 bitstream is not touched. The
// elementary stream carries in-band SPS/PPS, which is what lets the h264 demuxer read it without
// the avcC we used to hand MP4Box.
export async function muxEncodedVideo({
  samples,
  annexBPath,
  outputPath,
  fps,
  frames,
  ffmpegCommand,
  spawnImpl = spawn,
}) {
  if (samples.length !== frames) throw new Error(`encoded sample count mismatch: expected ${frames}, got ${samples.length}`);
  if (!ffmpegCommand) throw new Error("muxEncodedVideo requires an ffmpeg command");
  const rate = frameRateRational(fps);
  // stat, never readFile: the whole point of this path is that the elementary stream is handed to
  // ffmpeg by path and never enters this process's memory.
  const { size } = await stat(annexBPath);
  await runFfmpeg(spawnImpl, ffmpegCommand, buildRemuxArguments({ annexBPath, outputPath, rate }));
  return {
    method: "ffmpeg-remux",
    samples: samples.length,
    bytes: size,
    outputPath,
    timescale: rate.timescale,
    trackDuration: frames * rate.frameTicks,
  };
}

export function buildRemuxArguments({ annexBPath, outputPath, rate }) {
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    // The raw h264 demuxer carries no timing of its own, so -framerate is what makes the output CFR
    // at exactly the declared rate.
    "-f", "h264",
    "-framerate", `${rate.num}/${rate.den}`,
    "-i", annexBPath,
    "-c:v", "copy",
    "-an",
    "-video_track_timescale", String(rate.timescale),
    // moov before mdat, so the readers that come straight after this (verifyEncodedVideo's
    // ffprobe, then muxSourceAudio) find the index without scanning gigabytes to reach the tail.
    "-movflags", "+faststart",
    outputPath,
  ];
}

// Choosing timescale = numerator makes one frame exactly `denominator` ticks, which leaves the
// rescale from the demuxer's timebase nothing to round: frame i lands on i*denominator ticks for
// every i. A timescale that is not a multiple of the frame duration loses the same fraction every
// frame and the error compounds over a long export.
//
// Integer rates and the NTSC family are expressed exactly. Any other fractional rate is declared to
// three decimal places, so the output's nominal rate can differ slightly from the one requested --
// the ticks stay exact, but 30.123456 fps is muxed as 30.123. verifyEncodedVideo compares the
// resulting duration against frames/fps and fails the export when that difference matters.
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

function runFfmpeg(spawnImpl, command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnImpl(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => rejectPromise(new Error(`ffmpeg remux could not start: ${error.message}`)));
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`ffmpeg remux exited ${code}: ${stderr.trim()}`));
    });
  });
}
