import { resolve } from "node:path";
import { createRequire } from "node:module";

import { resolveFfmpeg } from "../../media-bin/src/index.mjs";

const { visualContentEndSeconds } = createRequire(import.meta.url)("../../edit-store/lib/index.js");

export function computeContentDurationSeconds({
  edit,
  cutsEndSeconds,
  internalEdit,
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
    const materialDuration = probeAudioDurationSeconds(ffprobeCommand, resolve(projectRoot, path));
    if (materialDuration === null) continue;
    // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: the audible span is [in, out), not
    // the whole material -- mirrors plan.mjs's resolveSfxTrim clamp so a trimmed sfx only extends
    // the predicted content duration by what actually plays, never by the untrimmed file length.
    const inSeconds = Number.isFinite(item?.in) && item.in >= 0 ? item.in : 0;
    const rawOut = Number.isFinite(item?.out) && item.out > 0 ? item.out : materialDuration;
    const outSeconds = Math.min(rawOut, materialDuration);
    if (inSeconds >= materialDuration || outSeconds <= inSeconds) continue; // render-cut plays this silently; contributes no duration.
    sfxEnd = Math.max(sfxEnd, t + (outSeconds - inSeconds));
  }

  let layersEnd = 0;
  for (const layer of Array.isArray(edit.layers) ? edit.layers : []) {
    const t = Number(layer?.t);
    const duration = Number(layer?.duration);
    if (!Number.isFinite(t) || !Number.isFinite(duration)) continue;
    layersEnd = Math.max(layersEnd, t + duration);
  }

  // edit-store の visualContentEndSeconds（全 visual トラックのアイテムの最大終端）と同じ定義を
  // 共有する（P0 2026-08-20 track-identity-and-duration 指示 2）。cuts/layers のどちらに
  // 振り分けられたクリップかに関わらず、段を移動しても総尺が変わらない。cutsEndSeconds /
  // layersEnd は既存の呼び出し（internalEdit を渡さない単体テスト含む）との後方互換のため残し、
  // Math.max の一項として足すだけにする（internalEdit を渡す実呼び出しではこちらが上回る）。
  const visualEnd = internalEdit ? visualContentEndSeconds(internalEdit) : 0;

  let captionsEnd = 0;
  for (const overlay of Array.isArray(captionOverlays) ? captionOverlays : []) {
    const start = Number(overlay?.start);
    const duration = Number(overlay?.duration);
    if (!Number.isFinite(start) || !Number.isFinite(duration)) continue;
    captionsEnd = Math.max(captionsEnd, start + duration);
  }

  return Math.max(cutsEndSeconds, layersEnd, visualEnd, sfxEnd, captionsEnd);
}

export function buildTailPadCommand({
  ffmpegCommand = resolveFfmpeg(),
  inputPath,
  outputPath,
  cutsEndSeconds,
  finalDurationSeconds,
  videoEncodeArgs = null,
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
      `[0:v]tpad=stop_mode=add:stop_duration=${formatNumber(padSeconds)}:color=black[padv_raw];[padv_raw]scale=out_range=tv[padv];[0:a]apad=whole_dur=${formatNumber(finalDurationSeconds)}[pada]`,
      "-map",
      "[padv]",
      "-map",
      "[pada]",
      ...(videoEncodeArgs ?? ["-c:v", "libx264", "-profile:v", "high", "-color_range", "tv"]),
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

export function buildAudioTailPadCommand({
  ffmpegCommand = resolveFfmpeg(),
  inputPath,
  outputPath,
  finalDurationSeconds,
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
      "-filter_complex",
      `[0:a]apad=whole_dur=${formatNumber(finalDurationSeconds)}[pada]`,
      "-map",
      "[pada]",
      "-vn",
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
