import { resolve } from "node:path";

export function computeContentDurationSeconds({
  edit,
  cutsEndSeconds,
  projectRoot,
  captionOverlays,
  probeAudioDurationSeconds,
  ffprobeCommand,
}) {
  let sfxEnd = 0;
  for (const item of Array.isArray(edit.audio?.sfx) ? edit.audio.sfx : []) {
    const path = typeof item?.path === "string" ? item.path : null;
    const t = Number(item?.t);
    if (!path || !Number.isFinite(t) || t < 0) continue;
    const duration = probeAudioDurationSeconds(ffprobeCommand, resolve(projectRoot, path));
    if (duration === null) continue;
    sfxEnd = Math.max(sfxEnd, t + duration);
  }

  let layersEnd = 0;
  for (const layer of Array.isArray(edit.layers) ? edit.layers : []) {
    const t = Number(layer?.t);
    const duration = Number(layer?.duration);
    if (!Number.isFinite(t) || !Number.isFinite(duration)) continue;
    layersEnd = Math.max(layersEnd, t + duration);
  }

  let captionsEnd = 0;
  for (const overlay of Array.isArray(captionOverlays) ? captionOverlays : []) {
    const start = Number(overlay?.start);
    const duration = Number(overlay?.duration);
    if (!Number.isFinite(start) || !Number.isFinite(duration)) continue;
    captionsEnd = Math.max(captionsEnd, start + duration);
  }

  return Math.max(cutsEndSeconds, sfxEnd, layersEnd, captionsEnd);
}

export function buildTailPadCommand({
  ffmpegCommand = "ffmpeg",
  inputPath,
  outputPath,
  cutsEndSeconds,
  finalDurationSeconds,
}) {
  const padSeconds = finalDurationSeconds - cutsEndSeconds;
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
      "-filter_complex",
      `[0:v]tpad=stop_mode=add:stop_duration=${formatNumber(padSeconds)}:color=black[padv];[0:a]apad=whole_dur=${formatNumber(finalDurationSeconds)}[pada]`,
      "-map",
      "[padv]",
      "-map",
      "[pada]",
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-t",
      formatNumber(finalDurationSeconds),
      outputPath,
    ],
  };
}

function formatNumber(value) {
  return Number(value).toString();
}
