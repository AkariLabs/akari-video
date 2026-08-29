import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  generatedAt,
  outputPathForJson,
  probeRaw,
  resolveTarget,
  resolveTools,
  runChecked,
} from "./common.mjs";
import { recordObservation } from "./record.mjs";

export async function waveformMedia(targetArgument, options = {}) {
  const target = resolveTarget(targetArgument, options);
  const { ffmpeg, ffprobe } = resolveTools(options);
  const { value, duration } = probeRaw(target.inputPath, ffprobe, options);
  if (!value.streams?.some((stream) => stream.codec_type === "audio")) throw new Error("音声ストリームがありません");
  const silenceDb = options.silenceDb ?? -35;
  const minSilence = options.minSilence ?? 0.6;
  if (!Number.isFinite(silenceDb)) throw new Error("--silence-db は数値で指定してください");
  if (!Number.isFinite(minSilence) || minSilence <= 0) throw new Error("--min-silence は 0 より大きい秒数で指定してください");

  const silenceResult = runChecked(ffmpeg, [
    "-hide_banner", "-nostdin", "-i", target.inputPath,
    "-af", `silencedetect=noise=${silenceDb}dB:d=${minSilence}`,
    "-f", "null", "-",
  ], options);
  const silences = parseSilences(silenceResult.stderr, duration);
  const loudnessResult = runChecked(ffmpeg, [
    "-hide_banner", "-nostdin", "-i", target.inputPath,
    "-af", "ebur128=peak=true", "-f", "null", "-",
  ], options);
  const loudness = parseLoudness(loudnessResult.stderr);
  const outputDirectory = await resolveWaveformOutput(target, options.out);
  const pngPath = path.join(outputDirectory, "waveform.png");
  renderWaveformPng({ ffmpeg, inputPath: target.inputPath, outputPath: pngPath, silences, duration, options });

  const generated_at = generatedAt(options);
  const silentDuration = silences.reduce((sum, item) => sum + Math.max(0, item.end - item.start), 0);
  const result = {
    path: target.displayPath,
    duration_s: duration,
    png: outputPathForJson(pngPath, target),
    silences,
    speech_likely: duration > 0 && (duration - silentDuration) / duration >= 0.1 && (loudness.integrated_lufs ?? -Infinity) > -60,
    loudness,
    params: { silence_db: silenceDb, min_silence_s: minSilence },
    generated_at,
  };
  const jsonPath = path.join(outputDirectory, "waveform.json");
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await recordObservation({
    target,
    kind: "waveform",
    result,
    args: result.params,
    outputs: [jsonPath, pngPath],
    noRecord: options.noRecord,
  });
  return result;
}

async function resolveWaveformOutput(target, out) {
  if (out) {
    const resolved = path.resolve(out);
    await mkdir(resolved, { recursive: true });
    return resolved;
  }
  if (target.projectRoot) {
    const stem = path.basename(target.inputPath, path.extname(target.inputPath));
    const resolved = path.join(target.projectRoot, ".akari", "reports", "media", stem);
    await mkdir(resolved, { recursive: true });
    return resolved;
  }
  return mkdtemp(path.join(os.tmpdir(), "akari-waveform-"));
}

export function parseSilences(stderr, duration) {
  const result = [];
  let start = null;
  for (const line of String(stderr).split(/\r?\n/)) {
    const startMatch = /silence_start:\s*([0-9.]+)/.exec(line);
    if (startMatch) start = Number(startMatch[1]);
    const endMatch = /silence_end:\s*([0-9.]+)/.exec(line);
    if (endMatch && start !== null) {
      result.push({ start, end: Math.min(duration, Number(endMatch[1])) });
      start = null;
    }
  }
  if (start !== null) result.push({ start, end: duration });
  return result.filter((item) => item.end > item.start);
}

export function parseLoudness(stderr) {
  const integrated = [...String(stderr).matchAll(/\bI:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*LUFS/g)].at(-1)?.[1];
  const peak = [...String(stderr).matchAll(/\bPeak:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dBFS/g)].at(-1)?.[1];
  return {
    integrated_lufs: finiteOrNull(integrated),
    peak_dbfs: finiteOrNull(peak),
  };
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function renderWaveformPng({ ffmpeg, inputPath, outputPath, silences, duration, options }) {
  const width = 1600;
  const height = 400;
  const boxes = silences.map(({ start, end }) => {
    const x = Math.round(width * start / duration);
    const boxWidth = Math.max(1, Math.round(width * (end - start) / duration));
    return `drawbox=x=${x}:y=0:w=${boxWidth}:h=${height}:color=0x666666@0.65:t=fill`;
  });
  runChecked(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", inputPath,
    "-filter_complex", [`aformat=channel_layouts=mono,showwavespic=s=${width}x${height}:colors=0x55d6be`, ...boxes].join(","),
    "-frames:v", "1", outputPath,
  ], options);
}

