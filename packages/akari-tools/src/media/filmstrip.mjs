import path from "node:path";

import {
  createOutputDirectory,
  formatNumber,
  generatedAt,
  probeRaw,
  resolveTarget,
  resolveTools,
  runChecked,
} from "./common.mjs";
import { renderSheets } from "./grab.mjs";
import { recordObservation } from "./record.mjs";

export async function filmstripMedia(targetArgument, options = {}) {
  const target = resolveTarget(targetArgument, options);
  const { ffmpeg, ffprobe } = resolveTools(options);
  const { value, duration } = probeRaw(target.inputPath, ffprobe, options);
  const stream = value.streams?.find((item) => item.codec_type === "video");
  if (!stream) throw new Error("映像ストリームがありません");
  const times = options.scenes !== undefined
    ? detectScenes({ ffmpeg, inputPath: target.inputPath, threshold: options.scenes, count: options.count, options })
    : options.every !== undefined
      ? timesEvery(duration, options.every)
      : timesCount(duration, options.count ?? 12);
  const normalizedTimes = [...new Set(times.map(formatNumber))].filter((time) => time >= 0 && time <= duration);
  if (normalizedTimes.length === 0) normalizedTimes.push(0);
  const outputDirectory = await createOutputDirectory({ target, kind: "filmstrip", out: options.out, now: options.now });
  const generated_at = generatedAt(options);
  const results = await renderSheets({
    ffmpeg,
    target,
    times: normalizedTimes,
    outputDirectory,
    generated_at,
    stream,
    perSheet: options.perSheet,
    options,
  });
  const outputs = results.map((item) => path.resolve(target.projectRoot ?? process.cwd(), item.path));
  await recordObservation({
    target,
    kind: "filmstrip",
    result: { generated_at },
    args: filmstripArgs(options, normalizedTimes),
    outputs,
    noRecord: options.noRecord,
  });
  return results;
}

export function timesCount(duration, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error("--count は 1 以上の整数で指定してください");
  if (count === 1) return [0];
  const last = Math.max(0, duration - 1 / 30);
  return Array.from({ length: count }, (_, index) => last * index / (count - 1));
}

export function timesEvery(duration, every) {
  if (!Number.isFinite(every) || every <= 0) throw new Error("--every は 0 より大きい秒数で指定してください");
  const times = [];
  for (let time = 0; time < duration; time += every) times.push(time);
  return times;
}

export function detectScenes({ ffmpeg, inputPath, threshold = 0.3, count, options = {} }) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("--scenes の閾値は 0〜1 で指定してください");
  const result = runChecked(ffmpeg, [
    "-hide_banner", "-nostdin", "-i", inputPath,
    "-vf", `select='gt(scene,${threshold})',showinfo`,
    "-an", "-f", "null", "-",
  ], options);
  const times = [0];
  for (const match of String(result.stderr).matchAll(/pts_time:([0-9.]+)/g)) times.push(Number(match[1]));
  return count === undefined ? times : times.slice(0, count);
}

function filmstripArgs(options, times) {
  if (options.scenes !== undefined) return { scenes: options.scenes, ...(options.count === undefined ? {} : { count: options.count }), times_s: times };
  if (options.every !== undefined) return { every_s: options.every, times_s: times };
  return { count: options.count ?? 12, times_s: times };
}

