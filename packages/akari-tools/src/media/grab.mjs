import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { renderLabeledContactSheet, splitContactSheetCounts } from "../../../render-cut/src/contact-sheet.mjs";
import {
  createOutputDirectory,
  formatNumber,
  formatTimecode,
  generatedAt,
  outputPathForJson,
  probeRaw,
  resolveTarget,
  resolveTools,
  runChecked,
  sheetTimecode,
  validateTime,
} from "./common.mjs";
import { recordObservation } from "./record.mjs";

export async function grabMedia(targetArgument, options = {}) {
  const target = resolveTarget(targetArgument, options);
  const { ffmpeg, ffprobe } = resolveTools(options);
  const { value, duration } = probeRaw(target.inputPath, ffprobe, options);
  const stream = value.streams?.find((item) => item.codec_type === "video");
  if (!stream) throw new Error("映像ストリームがありません");
  const times = (options.times ?? []).map((time) => validateTime(time, duration));
  if (times.length === 0) throw new Error("-t は 1 個以上必要です");
  const outputDirectory = await createOutputDirectory({ target, kind: "grab", out: options.out, now: options.now });
  const generated_at = generatedAt(options);
  const results = options.separate
    ? await renderSeparate({ ffmpeg, target, times, outputDirectory, generated_at, options })
    : await renderSheets({ ffmpeg, target, times, outputDirectory, generated_at, stream, perSheet: options.perSheet, options });
  const outputs = results.map((item) => path.resolve(target.projectRoot ?? process.cwd(), item.path));
  await recordObservation({
    target,
    kind: "grab",
    result: { generated_at },
    args: { times_s: times },
    outputs,
    noRecord: options.noRecord,
  });
  return results;
}

export async function renderSheets({ ffmpeg, target, times, outputDirectory, generated_at, stream, perSheet = 12, options = {} }) {
  const counts = splitContactSheetCounts(times.length, perSheet);
  const results = [];
  let offset = 0;
  for (let index = 0; index < counts.length; index += 1) {
    const sheetTimes = times.slice(offset, offset + counts[index]);
    offset += counts[index];
    const timecode = sheetTimecode(sheetTimes);
    const outputPath = path.join(outputDirectory, `${timecode}.png`);
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "akari-contact-sheet-"));
    try {
      await renderLabeledContactSheet({
        ffmpegCommand: ffmpeg,
        videoPath: target.inputPath,
        timestamps: sheetTimes,
        labels: sheetTimes.map(formatTimecode),
        sourceWidth: Number(stream.width),
        sourceHeight: Number(stream.height),
        temporaryDirectory,
        outputPath,
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
    results.push({ kind: "sheet", timecode, times_s: sheetTimes, path: outputPathForJson(outputPath, target), generated_at });
  }
  return results;
}

async function renderSeparate({ ffmpeg, target, times, outputDirectory, generated_at, options }) {
  const results = [];
  for (const time of times) {
    const timecode = formatTimecode(time);
    const outputPath = path.join(outputDirectory, `${timecode}.png`);
    runChecked(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-i", target.inputPath,
      "-ss", Number(time).toFixed(6),
      "-frames:v", "1",
      "-vf", "scale=-2:720:force_original_aspect_ratio=decrease",
      outputPath,
    ], options);
    results.push({ kind: "frame", timecode, times_s: [formatNumber(time)], path: outputPathForJson(outputPath, target), generated_at });
  }
  return results;
}

