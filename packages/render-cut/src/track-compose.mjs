import {
  computeVideoRuns,
  needsGapAwareCutTimeline,
  resolveCutSegments,
  segmentDuration,
} from "./cut-timeline.mjs";
import { resolveFfmpeg } from "../../media-bin/src/index.mjs";
import { enableWindowExpr } from "./enable-window.mjs";

export function buildTrackBaseCommand({
  ffmpegCommand = resolveFfmpeg(),
  inputPath,
  outputPath,
  duration,
  width,
  height,
  fps,
  videoEncodeArgs = null,
}) {
  return {
    command: ffmpegCommand,
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      inputPath,
      "-f",
      "lavfi",
      "-i",
      `color=c=black:s=${width}x${height}:r=${formatNumber(fps)}:d=${formatNumber(duration)}`,
      "-filter_complex",
      "[1:v]scale=out_range=tv[outv]",
      "-map",
      "[outv]",
      "-map",
      "0:a:0",
      "-t",
      formatNumber(duration),
      ...(videoEncodeArgs ?? ["-c:v", "libx264", "-profile:v", "high", "-color_range", "tv"]),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      outputPath,
    ],
  };
}

export function buildCutTrackCompositeCommand({
  ffmpegCommand = resolveFfmpeg(),
  inputPath,
  trackPath,
  outputPath,
  ranges,
  duration,
  fps,
  videoEncodeArgs = null,
}) {
  const filters = [];
  const sources = ranges.length === 1
    ? ["[1:v]"]
    : ranges.map((_, index) => `[ct_src${index}]`);
  if (ranges.length > 1) {
    filters.push(`[1:v]split=${ranges.length}${sources.join("")}`);
  }

  let previous = "[0:v]";
  ranges.forEach((range, index) => {
    const prepared = `[ct_prepared${index}]`;
    const next = `[ct_out${index}]`;
    const inputEnd = range.inputStart + (range.outputEnd - range.outputStart);
    filters.push(
      `${sources[index]}trim=start=${formatNumber(range.inputStart)}:end=${formatNumber(inputEnd)},setpts=PTS-STARTPTS+${formatNumber(range.outputStart)}/TB${prepared}`,
    );
    filters.push(
      `${previous}${prepared}overlay=x=0:y=0:format=auto:eof_action=pass:enable='${enableWindowExpr(range.outputStart, range.outputEnd, fps)}'${next}`,
    );
    previous = next;
  });
  filters.push(`${previous}scale=out_range=tv[outv]`);

  return {
    command: ffmpegCommand,
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      inputPath,
      "-i",
      trackPath,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[outv]",
      "-map",
      "0:a:0",
      "-t",
      formatNumber(duration),
      ...(videoEncodeArgs ?? ["-c:v", "libx264", "-profile:v", "high", "-color_range", "tv"]),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      outputPath,
    ],
  };
}

export function resolveCutTrackRanges(cuts) {
  if (!Array.isArray(cuts) || cuts.length === 0) return [];

  const offsets = [];
  let cursor = 0;
  for (const cut of cuts) {
    offsets.push(cursor);
    cursor += segmentDuration(cut);
  }
  const resolved = resolveCutSegments(cuts);
  const trackDuration = Math.max(0, ...resolved.map(segment => segment.end));
  return computeVideoRuns(resolved, trackDuration)
    .filter(run => run.kind === "src")
    .map(run => {
      const segment = resolved.find(candidate =>
        candidate.cut === run.cut
        && candidate.start <= run.outStart
        && candidate.end >= run.outEnd
      );
      return {
        outputStart: run.outStart,
        outputEnd: run.outEnd,
        inputStart: offsets[segment.index] + (run.outStart - segment.start),
      };
    });
}

function formatNumber(value) {
  return Number(value).toString();
}
