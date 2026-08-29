import { statSync } from "node:fs";

import { generatedAt, probeRaw, resolveTarget, resolveTools, runChecked, sha256File } from "./common.mjs";
import { recordObservation } from "./record.mjs";

export async function probeMedia(targetArgument, options = {}) {
  const target = resolveTarget(targetArgument, options);
  const { ffprobe } = resolveTools(options);
  const { value, duration } = probeRaw(target.inputPath, ffprobe, options);
  const streams = Array.isArray(value.streams) ? value.streams : [];
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const audioStream = streams.find((stream) => stream.codec_type === "audio");
  const result = {
    path: target.displayPath,
    sha256: sha256File(target.inputPath),
    size_bytes: statSync(target.inputPath).size,
    container: String(value.format?.format_name ?? "").split(",")[0],
    duration_s: duration,
    video: videoStream ? normalizeVideo(videoStream) : null,
    audio: audioStream ? normalizeAudio(audioStream) : null,
    tool: { ffprobe: resolveFfprobeVersion(ffprobe, options) },
    generated_at: generatedAt(options),
  };
  await recordObservation({ target, kind: "probe", result, noRecord: options.noRecord });
  return result;
}

function normalizeVideo(stream) {
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    fps: parseRate(stream.avg_frame_rate || stream.r_frame_rate),
    codec: stream.codec_name,
    rotation: Number(stream.tags?.rotate ?? stream.side_data_list?.find((item) => Number.isFinite(item.rotation))?.rotation ?? 0),
  };
}

function normalizeAudio(stream) {
  return {
    codec: stream.codec_name,
    channels: Number(stream.channels),
    sample_rate: Number(stream.sample_rate),
  };
}

function parseRate(value) {
  const [numerator, denominator = "1"] = String(value ?? "0").split("/").map(Number);
  return denominator ? numerator / denominator : 0;
}

function resolveFfprobeVersion(command, options) {
  if (options.ffprobeVersion) return options.ffprobeVersion;
  const firstLine = String(runChecked(command, ["-version"], options).stdout).split(/\r?\n/, 1)[0];
  return /ffprobe version\s+([^\s]+)/i.exec(firstLine)?.[1] ?? "unknown";
}
