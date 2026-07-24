import {
  computeVideoRuns,
  needsGapAwareCutTimeline,
  resolveCutSegments,
  segmentDuration,
} from "./cut-timeline.mjs";

export function buildTrackBaseCommand({
  ffmpegCommand = "ffmpeg",
  inputPath,
  outputPath,
  duration,
  width,
  height,
  fps,
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
      "-map",
      "1:v:0",
      "-map",
      "0:a:0",
      "-t",
      formatNumber(duration),
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      outputPath,
    ],
  };
}

export function buildCutTrackCompositeCommand({
  ffmpegCommand = "ffmpeg",
  inputPath,
  trackPath,
  outputPath,
  ranges,
  duration,
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
      `${previous}${prepared}overlay=x=0:y=0:format=auto:eof_action=pass:enable='between(t,${formatNumber(range.outputStart)},${formatNumber(range.outputEnd)})'${next}`,
    );
    previous = next;
  });

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
      previous,
      "-map",
      "0:a:0",
      "-t",
      formatNumber(duration),
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      outputPath,
    ],
  };
}

export function resolveCutTrackRanges(cuts, {
  version,
  sourceDuration,
  outputDuration,
} = {}) {
  if (!Array.isArray(cuts) || cuts.length === 0) return [];

  if (version === 0) {
    if (needsGapAwareCutTimeline(cuts)) {
      return computeVideoRuns(resolveCutSegments(cuts), outputDuration)
        .filter(run => run.kind === "src")
        .map(run => ({
          outputStart: run.outStart,
          outputEnd: run.outEnd,
          inputStart: run.outStart,
        }));
    }
    return [{
      outputStart: 0,
      outputEnd: legacySequentialDuration(cuts, sourceDuration),
      inputStart: 0,
    }];
  }

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

function legacySequentialDuration(cuts, sourceDuration) {
  if (cuts.length === 0) return sourceDuration;
  const segmentsTotal = cuts.reduce((sum, cut) => sum + segmentDuration(cut), 0);
  const transitionOverlap = cuts
    .slice(0, -1)
    .reduce((sum, cut) => sum + (
      typeof cut.transition_out?.duration === "number"
      && Number.isFinite(cut.transition_out.duration)
      && cut.transition_out.duration > 0
        ? cut.transition_out.duration
        : 0
    ), 0);
  return segmentsTotal - transitionOverlap;
}

function formatNumber(value) {
  return Number(value).toString();
}
