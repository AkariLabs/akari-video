import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, normalize as normalizePath, relative, resolve } from "node:path";

import {
  cutSpeed,
  effectiveTransitionDurations,
  needsGapAwareCutTimeline,
  resolveCutSegments,
  segmentDuration,
} from "./cut-timeline.mjs";
import {
  appendFreezeAwareRelativeAudioTrim,
  hasCutFreeze,
} from "./cut-freeze.mjs";
import { buildAudioTailPadCommand, computeContentDurationSeconds } from "./content-duration.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { buildAtempoChain } from "../../media-bin/src/speech-atempo.mjs";
import { buildAudioClipFxFilters } from "../../media-bin/src/preview-audio-sidecar.mjs";
import { appliedTruePeakDbtp, hasExplicitTruePeakDbtp } from "./audio-qc.mjs";
import { buildTelopRasterCommands, readRenderEdit } from "./internal-render.mjs";

const require = createRequire(import.meta.url);
const {
  composeEnvelopesDb,
  computeDuckEnvelope,
  DEFAULT_DUCK_KEYS,
  projectSpeechKeyIntervals,
  sampleEnvelopeLinear,
} = require("../../edit-store/lib/index.js");

const GAIN_DB_MIN = -60;
const GAIN_DB_MAX = 12;
export const MAX_AUDIO_INPUTS_PER_COMMAND = 200;
export const AUDIO_SEEK_PREROLL_SECONDS = 0.5;

export function buildPlan({
  edit,
  internalEdit,
  projectRoot,
  outputPath,
  capabilities,
  captionOverlays = [],
  temporaryDirectory = join(projectRoot, ".akari", "render-tmp"),
  encodingPolicy,
  fpsOverride,
  resolvedEngine = "osr",
}) {
  const normalizedInternalEdit = internalEdit ?? readRenderEdit(edit, temporaryDirectory).internal;
  if (isPositiveNumber(fpsOverride) && fpsOverride !== edit.output.fps) {
    throw new Error(
      "v2 の出力 fps は宣言が正本です。fps を変えるときは retime（全体再スケール）を通してください。",
    );
  }
  const fps = isPositiveNumber(fpsOverride) ? fpsOverride : edit.output.fps;
  const cutsEndSeconds = predictedDuration(
    edit.cuts,
    Math.max(0, ...capabilities.sourceInputs.map((source) => Number(source.duration) || 0)),
  );
  const sourceAudioDurationCache = new Map();
  const finalDurationSeconds = computeContentDurationSeconds({
    edit,
    cutsEndSeconds,
    internalEdit: normalizedInternalEdit,
    projectRoot,
    captionOverlays,
    probeAudioDurationSeconds,
    ffprobeCommand: capabilities.ffprobeCommand,
  });
  const cutAudioPath = join(temporaryDirectory, "cut-audio.mp4");
  const tailPaddedAudioPath = join(temporaryDirectory, "cut-audio-tail-padded.mp4");
  const compositePath = join(temporaryDirectory, "composite.mp4");
  const finalPath = join(temporaryDirectory, "final.mp4");
  const cutAudio = needsGapAwareCutTimeline(edit.cuts)
    ? buildGapAwareMultiSourceAudioCutCommand({
        sourceInputs: capabilities.sourceInputs,
        cutPath: cutAudioPath,
        cuts: edit.cuts,
        duration: cutsEndSeconds,
        ffmpegCommand: capabilities.ffmpegCommand,
        ffprobeCommand: capabilities.ffprobeCommand,
        audioDurationCache: sourceAudioDurationCache,
      })
    : buildMultiSourceAudioCutCommand({
        sourceInputs: capabilities.sourceInputs,
        cutPath: cutAudioPath,
        cuts: edit.cuts,
        ffmpegCommand: capabilities.ffmpegCommand,
        ffprobeCommand: capabilities.ffprobeCommand,
        audioDurationCache: sourceAudioDurationCache,
      });
  const tailPadAudio = finalDurationSeconds > cutsEndSeconds + 0.001
    ? buildAudioTailPadCommand({
        ffmpegCommand: capabilities.ffmpegCommand,
        inputPath: cutAudioPath,
        outputPath: tailPaddedAudioPath,
        finalDurationSeconds,
      })
    : null;
  const telopRasterCommands = buildTelopRasterCommands(normalizedInternalEdit, temporaryDirectory);
  const audioMix = buildAudioMixCommand({
    edit,
    projectRoot,
    inputPath: compositePath,
    outputPath: finalPath,
    duration: finalDurationSeconds,
    ffmpegCommand: capabilities.ffmpegCommand,
    ffprobeCommand: capabilities.ffprobeCommand,
    workDirectory: temporaryDirectory,
  });

  return {
    predicted_duration_seconds: finalDurationSeconds,
    duration_tolerance_seconds: Math.max(0.1, 2 / fps),
    output: relativeOrAbsolute(projectRoot, outputPath),
    preset: {
      video_codec: "h264",
      profile: "high",
      pixel_format: "yuv420p",
      color_range: "tv",
      audio_codec: "aac",
      width: edit.output.width,
      height: edit.output.height,
      fps,
    },
    ...(encodingPolicy ? { encoding: encodingPolicy } : {}),
    rasterizer: { selected: resolvedEngine, order: [resolvedEngine] },
    intermediates: [
      cutAudioPath,
      ...(cutAudio.intermediates ?? []),
      ...(tailPadAudio ? [tailPaddedAudioPath] : []),
      ...telopRasterCommands.map((command) => command.output),
      compositePath,
      finalPath,
    ].map((value) => relative(projectRoot, value)),
    commands: {
      cut_audio: cutAudio,
      telops: telopRasterCommands,
      tail_pad_audio: tailPadAudio,
      audio_mix: audioMix,
      verify: {
        command: capabilities.ffprobeCommand,
        args: ["-v", "error", "-show_streams", "-show_format", "-of", "json", relativeOrAbsolute(projectRoot, outputPath)],
      },
    },
  };
}

export function buildAudioMixCommand({
  edit,
  projectRoot,
  inputPath,
  outputPath,
  duration,
  ffmpegCommand = resolveFfmpeg(),
  ffprobeCommand = resolveFfprobe(),
  workDirectory = dirname(outputPath),
}) {
  const audio = normalizeAudioPlan(edit.audio);
  const { tracks: narrationTracks, warnings } = resolveNarrationTracks({
    narration: edit.audio?.narration,
    projectRoot,
    duration,
    ffprobeCommand,
  });
  const hasNarration = narrationTracks.length > 0;
  const master = normalizeMasterPlan(edit.audio?.master);
  const duckKeys = normalizeDuckKeys(edit.audio?.duck_keys);
  const hasDuckTarget = audio.bgm?.ducking === true || audio.sfx.some(item => item?.ducking === true);
  const speech = hasDuckTarget
    ? resolveSpeechDuckIntervals({ edit, projectRoot, duckKeys })
    : { intervals: [], warnings: [] };
  warnings.push(...speech.warnings);
  const narrationIntervals = narrationTracks.map(track => ({
    startSec: track.t,
    endSec: Math.min(duration, track.t + track.durationSec),
  })).filter(interval => interval.endSec > interval.startSec);
  const duckIntervals = mergeTimelineIntervals([
    ...(duckKeys.includes("narration") ? narrationIntervals : []),
    ...(duckKeys.includes("speech") ? speech.intervals : []),
  ]);
  const envelopes = [];
  const duckedItems = new Set();
  const keyframedItems = new Set();
  const envelopeProvenance = () => ({
    duck_keys: duckKeys,
    speech_intervals: speech.intervals.length,
    ducked_items: [...duckedItems],
    keyframed_items: [...keyframedItems],
  });
  const clipFxProcessedItems = new Set();
  const clipFxFilterCounts = { highpass: 0, afftdn: 0, anlmdn: 0, rubberband: 0 };
  const clipFxProvenance = () => ({
    processed_items: [...clipFxProcessedItems],
    filters: { ...clipFxFilterCounts },
  });
  const clipFxPrefix = (item, id, { narration = false } = {}) => {
    const declaration = narration ? { denoise: item?.denoise, lowcut_hz: item?.lowcut_hz } : item;
    const clipFilters = buildAudioClipFxFilters(declaration);
    if (clipFilters.length === 0) return "";
    clipFxProcessedItems.add(id);
    for (const filter of clipFilters) {
      const kind = Object.keys(clipFxFilterCounts).find(candidate => filter.startsWith(candidate));
      if (kind) clipFxFilterCounts[kind] += 1;
    }
    return `${clipFilters.join(",")},`;
  };

  if (!audio.bgm && audio.sfx.length === 0 && !hasNarration && !master) {
    return {
      operation: "copy", input: inputPath, output: outputPath, warnings, hasNarration,
      hasAudibleAudio: Boolean(audio.bgm) || audio.sfx.length > 0 || hasNarration || Boolean(master),
      envelopes, envelope: envelopeProvenance(), clip_fx: clipFxProvenance(),
    };
  }
  const args = [
    "-hide_banner",
    "-loglevel",
    master ? "info" : "error",
    ...(master ? ["-nostats"] : []),
    "-nostdin",
    "-y",
    "-i",
    inputPath,
  ];
  const labels = ["[0:a]"];
  const filters = [];
  let inputIndex = 1;

  // Build the narration track(s) first so the merged [narration] label exists before bgm decides
  // whether to route ducking's sidechain input through it (contract-2026-07-20 §3).
  let narrationLabel = null;
  if (hasNarration) {
    const rawLabels = [];
    for (const [index, track] of narrationTracks.entries()) {
      args.push("-i", track.path);
      const narrationInputIndex = inputIndex++;
      const delay = Math.max(0, Math.round(track.t * 1000));
      const rawLabel = `nar_raw${index}`;
      const baseLabel = `nar_base${index}`;
      const narrationClipFx = clipFxPrefix(track.declaration, track.id, { narration: true });
      const envelope = createClipEnvelope({
        item: track.declaration,
        intervals: [],
        clipStartSec: track.t,
        clipDurationSec: Math.min(track.durationSec, Math.max(0, duration - track.t)),
      });
      if (envelope) {
        const envelopeInput = appendEnvelopeInput({
          args, workDirectory, label: `narration-${index}`, envelope,
          durationSec: Math.min(track.durationSec, Math.max(0, duration - track.t)), envelopes,
          inputIndex,
        });
        inputIndex += 1;
        if (envelope.keyframed) keyframedItems.add(track.id);
        filters.push(`[${narrationInputIndex}:a]${track.trimFilter}${narrationClipFx}volume=${formatNumber(track.gain_db)}dB,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[${baseLabel}]`);
        filters.push(`[${envelopeInput}:a]aformat=sample_fmts=fltp:sample_rates=48000,pan=stereo|c0=c0|c1=c0[env_nar${index}]`);
        filters.push(`[${baseLabel}][env_nar${index}]amultiply,adelay=${delay}:all=1[${rawLabel}]`);
      } else {
        filters.push(
          `[${narrationInputIndex}:a]${track.trimFilter}${narrationClipFx}volume=${formatNumber(track.gain_db)}dB,adelay=${delay}:all=1[${rawLabel}]`,
        );
      }
      rawLabels.push(`[${rawLabel}]`);
    }
    if (rawLabels.length === 1) {
      filters.push(`${rawLabels[0]}apad=whole_dur=${formatNumber(duration)}[narration]`);
    } else {
      filters.push(
        `${rawLabels.join("")}amix=inputs=${rawLabels.length}:duration=longest:normalize=0,apad=whole_dur=${formatNumber(duration)}[narration]`,
      );
    }
    narrationLabel = "[narration]";
  }

  let bgmLabel = null;
  if (audio.bgm) {
    const bgmSourcePath = resolve(projectRoot, audio.bgm.path);
    const bgmIn = resolveBgmInSeconds(audio.bgm, ffprobeCommand, bgmSourcePath);
    warnings.push(...bgmIn.warnings);
    if (bgmIn.seconds > 0) args.push("-ss", formatNumber(bgmIn.seconds));
    args.push("-stream_loop", "-1", "-i", bgmSourcePath);
    const bgmFade = resolveBgmFadeSeconds(audio.bgm, duration);
    warnings.push(...bgmFade.warnings);
    // afade は volume/atrim に直結し、その後に決定論 envelope を amultiply する。
    // 乗算同士なので可換だが、この順序を契約として固定する。
    const bgmInputIndex = inputIndex++;
    const bgmClipFx = clipFxPrefix(audio.bgm, audio.bgm.id ?? "bgm");
    const bgmEnvelope = createClipEnvelope({
      item: audio.bgm,
      intervals: audio.bgm.ducking === true ? duckIntervals : [],
      clipStartSec: 0,
      clipDurationSec: duration,
    });
    if (bgmEnvelope) {
      const envelopeInput = appendEnvelopeInput({
        args, workDirectory, label: "bgm", envelope: bgmEnvelope, durationSec: duration,
        envelopes, inputIndex,
      });
      inputIndex += 1;
      if (bgmEnvelope.keyframed) keyframedItems.add(audio.bgm.id ?? "bgm");
      if (bgmEnvelope.ducked) duckedItems.add(audio.bgm.id ?? "bgm");
      filters.push(
        `[${bgmInputIndex}:a]${bgmClipFx}volume=${formatNumber(audio.bgm.gain_db ?? 0)}dB,atrim=duration=${formatNumber(duration)}${buildBgmFadeSuffix(bgmFade, duration)},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[bgm_base]`,
      );
      filters.push(`[${envelopeInput}:a]aformat=sample_fmts=fltp:sample_rates=48000,pan=stereo|c0=c0|c1=c0[env_bgm]`);
      filters.push(`[bgm_base][env_bgm]amultiply[bgm_env]`);
      bgmLabel = "[bgm_env]";
    } else {
      filters.push(
        `[${bgmInputIndex}:a]${bgmClipFx}volume=${formatNumber(audio.bgm.gain_db ?? 0)}dB,atrim=duration=${formatNumber(duration)}${buildBgmFadeSuffix(bgmFade, duration)}[bgm]`,
      );
      bgmLabel = "[bgm]";
    }
    labels.push(bgmLabel);
  }
  for (const [index, sfx] of audio.sfx.entries()) {
    const sfxSourcePath = resolve(projectRoot, sfx.path);
    const needsEnvelopeDuration = Array.isArray(sfx.keyframes) || sfx.ducking === true;
    const clipSpeed = isFiniteNumber(sfx.speed) && sfx.speed > 0 ? sfx.speed : 1;
    const trim = resolveSfxTrim(sfx, ffprobeCommand, sfxSourcePath, index, needsEnvelopeDuration, clipSpeed);
    warnings.push(...trim.warnings);
    if (trim.skip) continue;
    args.push("-i", sfxSourcePath);
    const sfxInputIndex = inputIndex++;
    const sfxClipFx = clipFxPrefix(sfx, sfx.id ?? `sfx-${index}`);
    const delay = Math.max(0, Math.round((sfx.t ?? 0) * 1000));
    let fadeSuffix = "";
    if (trim.effectiveDuration !== null) {
      const fade = resolveSfxFadeSeconds(sfx, trim.effectiveDuration, `audio.sfx[${index}]`);
      warnings.push(...fade.warnings);
      fadeSuffix = buildSfxFadeSuffix(fade, trim.effectiveDuration);
    }
    // fade is chained directly onto volume -- i.e. before adelay -- for the same reason as
    // trim's atrim/asetpts: afade's st=0 must land on the clip's own content start, not on
    // adelay's leading silence padding. Appending it after adelay would fade the silence, not
    // the sound (mirrors buildBgmFadeSuffix's placement rationale, just one filter stage earlier
    // in this chain since sfx additionally has adelay).
    const effectiveDuration = trim.effectiveDuration === null
      ? Math.max(0, duration - (sfx.t ?? 0))
      : Math.min(trim.effectiveDuration, Math.max(0, duration - (sfx.t ?? 0)));
    const sfxEnvelope = createClipEnvelope({
      item: sfx,
      intervals: sfx.ducking === true ? duckIntervals : [],
      clipStartSec: sfx.t ?? 0,
      clipDurationSec: effectiveDuration,
    });
    if (sfxEnvelope) {
      const envelopeInput = appendEnvelopeInput({
        args, workDirectory, label: `sfx-${index}`, envelope: sfxEnvelope,
        durationSec: effectiveDuration, envelopes, inputIndex,
      });
      inputIndex += 1;
      if (sfxEnvelope.keyframed) keyframedItems.add(sfx.id ?? `sfx-${index}`);
      if (sfxEnvelope.ducked) duckedItems.add(sfx.id ?? `sfx-${index}`);
      filters.push(
        `[${sfxInputIndex}:a]${trim.trimFilter}${sfxClipFx}volume=${formatNumber(sfx.gain_db ?? 0)}dB${fadeSuffix},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[sfx_base${index}]`,
      );
      filters.push(`[${envelopeInput}:a]aformat=sample_fmts=fltp:sample_rates=48000,pan=stereo|c0=c0|c1=c0[env_sfx${index}]`);
      filters.push(`[sfx_base${index}][env_sfx${index}]amultiply,adelay=${delay}:all=1[sfx${index}]`);
    } else {
      filters.push(
        `[${sfxInputIndex}:a]${trim.trimFilter}${sfxClipFx}volume=${formatNumber(sfx.gain_db ?? 0)}dB${fadeSuffix},adelay=${delay}:all=1[sfx${index}]`,
      );
    }
    labels.push(`[sfx${index}]`);
  }
  if (narrationLabel) labels.push(narrationLabel);

  filters.push(`${labels.join("")}amix=inputs=${labels.length}:duration=first:normalize=0[mixed]`);

  // docs/contract-2026-07-22-render-basics.md #5: master processing (denoise / loudnorm) runs on
  // the fully mixed bus, after bgm/sfx/narration/ducking are combined — it is a mastering step, not
  // a per-track one. 1-pass loudnorm is accepted for v0 (contract explicitly allows it over 2-pass).
  let finalLabel = "[mixed]";
  if (master) {
    if (master.denoise !== "off") {
      const nr = master.denoise === "strong" ? 24 : 12;
      // afftdn's default noise_floor (-50dB) assumes near-silent background hiss and barely
      // engages against realistically-proportioned recording noise (measured empirically: a
      // -47dB noise floor under a normal-level dialogue tone saw <1.5dB reduction at the
      // default nf). nf=-30 (near the top of ffmpeg's -80..-20 range) makes both std and strong
      // measurably and monotonically effective against typical background noise levels.
      filters.push(`${finalLabel}afftdn=nr=${nr}:nf=-30[master_dn]`);
      finalLabel = "[master_dn]";
    }
    filters.push(`${finalLabel}loudnorm=I=${formatNumber(master.loudnormTarget)}:TP=${formatNumber(master.truePeakTarget)}:LRA=11:print_format=json[master_ln]`);
    finalLabel = "[master_ln]";
  }

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "0:v:0",
    "-map",
    finalLabel,
    "-t",
    formatNumber(duration),
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    outputPath,
  );
  return {
    operation: "ffmpeg", command: ffmpegCommand, args, warnings, hasNarration,
    hasAudibleAudio: Boolean(audio.bgm) || audio.sfx.length > 0 || hasNarration || Boolean(master),
    envelopes,
    envelope: envelopeProvenance(),
    clip_fx: clipFxProvenance(),
  };
}

// docs/contract-2026-07-22-render-basics.md #5: denoise has an explicit off value; loudnorm does
// not, so once the master object is present at all, loudness normalization is on by default at
// -14 LUFS unless overridden (command-center judgment call, documented in edit.schema.json's
// $defs/audioMaster $comment).
function normalizeMasterPlan(master) {
  if (!master || typeof master !== "object") return null;
  const denoise = ["off", "std", "strong"].includes(master.denoise) ? master.denoise : "off";
  const rawTarget = master.loudnorm;
  const loudnormTarget = typeof rawTarget === "number" && Number.isFinite(rawTarget) ? rawTarget : -14;
  const truePeakExplicit = hasExplicitTruePeakDbtp(master);
  const configuredTruePeak = truePeakExplicit ? master.true_peak_dbtp : -1.5;
  // Real AAC re-encode overshoots loudnorm's PCM-stage true peak target (audio-qc.mjs's
  // AAC_TRUE_PEAK_OVERSHOOT_MARGIN_DBTP; measured +1.2 dB on real material — planning/
  // notes-2026-08-17-mac-fresh-install-bug-reports.md #05). Bake the margin into what loudnorm is
  // told to target only when true_peak_dbtp is explicit — the -1.5 dBTP default already carries
  // its own headroom and must not double up (task 2026-08-17-render-cut-true-peak-guard 裁定 B).
  const truePeakTarget = truePeakExplicit ? appliedTruePeakDbtp(configuredTruePeak) : configuredTruePeak;
  return { denoise, loudnormTarget, truePeakTarget };
}

// docs/contract-2026-07-20-edit-json-v1-narration.md §4: resolve each narration element against the
// filesystem and its declared values, skipping (with a warning) whatever cannot be rendered safely
// instead of failing the whole export. Runs during planning so the resulting command is deterministic
// for a fixed filesystem/edit.json pair.
function resolveNarrationTracks({ narration, projectRoot, duration, ffprobeCommand }) {
  const warnings = [];
  const tracks = [];
  if (!Array.isArray(narration)) return { tracks, warnings };

  for (const raw of narration) {
    const item = raw && typeof raw === "object" ? raw : {};
    const id = typeof item.id === "string" && item.id !== "" ? item.id : "narration";
    const path = typeof item.path === "string" && item.path !== "" ? item.path : null;
    if (!path) {
      warnings.push(`narration ${id}: path is missing; skipped`);
      continue;
    }
    const resolvedPath = resolve(projectRoot, path);
    if (!existsSync(resolvedPath)) {
      warnings.push(`narration ${id}: file not found at ${path}; skipped`);
      continue;
    }
    const probe = probeNarrationAudio(ffprobeCommand, resolvedPath);
    if (!probe.hasAudio || !isFiniteNumber(probe.duration) || probe.duration <= 0) {
      warnings.push(`narration ${id}: file could not be decoded as audio at ${path}; skipped`);
      continue;
    }
    const t = Number(item.t);
    if (!Number.isFinite(t) || t < 0) {
      warnings.push(`narration ${id}: t is not a finite non-negative number (${item.t}); skipped`);
      continue;
    }
    if (Number.isFinite(duration) && t >= duration) {
      warnings.push(`narration ${id}: t (${t}s) is at or beyond the timeline duration (${duration}s); skipped`);
      continue;
    }
    const rawGain = item.gain_db === undefined ? 0 : Number(item.gain_db);
    if (!Number.isFinite(rawGain)) {
      warnings.push(`narration ${id}: gain_db is not a finite number (${item.gain_db}); skipped`);
      continue;
    }
    const gain_db = Math.min(GAIN_DB_MAX, Math.max(GAIN_DB_MIN, rawGain));
    if (gain_db !== rawGain) {
      warnings.push(`narration ${id}: gain_db ${rawGain} clamped to ${gain_db}`);
    }
    const trim = resolveNarrationTrim(item, probe.duration, id);
    warnings.push(...trim.warnings);
    if (trim.skip) continue;
    tracks.push({
      id, path: resolvedPath, t, gain_db, trimFilter: trim.trimFilter,
      durationSec: trim.effectiveDuration,
      declaration: item,
    });
  }
  return { tracks, warnings };
}

function resolveNarrationTrim(item, actualDuration, id) {
  const hasIn = item.in !== undefined;
  const hasOut = item.out !== undefined;
  if (!hasIn && !hasOut) {
    return { skip: false, trimFilter: "", effectiveDuration: actualDuration, warnings: [] };
  }

  const warnings = [];
  let inSeconds = hasIn && isFiniteNumber(item.in) && item.in >= 0 ? item.in : 0;
  let outSeconds = hasOut && isFiniteNumber(item.out) && item.out > 0 ? item.out : actualDuration;
  if (inSeconds >= actualDuration) {
    warnings.push(
      `narration ${id}: in ${formatNumber(inSeconds)}s is at or beyond the material duration (${formatNumber(actualDuration)}s); clamped to 0s`,
    );
    inSeconds = 0;
  }
  if (outSeconds > actualDuration) {
    warnings.push(
      `narration ${id}: out ${formatNumber(outSeconds)}s exceeds the material duration (${formatNumber(actualDuration)}s); clamped to ${formatNumber(actualDuration)}s`,
    );
    outSeconds = actualDuration;
  }
  if (outSeconds <= inSeconds) {
    warnings.push(
      `narration ${id}: out <= in after clamping (in=${formatNumber(inSeconds)}s, out=${formatNumber(outSeconds)}s); skipped (silent)`,
    );
    return { skip: true, trimFilter: "", effectiveDuration: 0, warnings };
  }
  return {
    skip: false,
    trimFilter: `atrim=start=${formatNumber(inSeconds)}:end=${formatNumber(outSeconds)},asetpts=PTS-STARTPTS,`,
    effectiveDuration: outSeconds - inSeconds,
    warnings,
  };
}

function probeNarrationAudio(ffprobeCommand, path) {
  const result = spawnSync(
    ffprobeCommand,
    [
      "-v", "error", "-select_streams", "a:0",
      "-show_entries", "stream=codec_type:format=duration", "-of", "json", path,
    ],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) return { hasAudio: false, duration: null };
  try {
    const parsed = JSON.parse(result.stdout);
    const hasAudio = Array.isArray(parsed.streams)
      && parsed.streams.some((stream) => stream.codec_type === "audio");
    const duration = Number(parsed.format?.duration);
    return {
      hasAudio,
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    };
  } catch {
    return { hasAudio: false, duration: null };
  }
}

export function probeAudioDurationSeconds(ffprobeCommand, path) {
  if (!existsSync(path)) return null;
  const result = spawnSync(
    ffprobeCommand,
    ["-v", "error", "-show_entries", "format=duration", "-of", "json", path],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    const value = Number(parsed.format?.duration);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function normalizeDuckKeys(value) {
  if (!Array.isArray(value)) return [...DEFAULT_DUCK_KEYS];
  return [...new Set(value.filter(key => key === "narration" || key === "speech"))];
}

function resolveSpeechDuckIntervals({ edit, projectRoot, duckKeys }) {
  if (!duckKeys.includes("speech")) return { intervals: [], warnings: [] };
  const analysisPath = join(projectRoot, "analysis.json");
  let analysis;
  try {
    analysis = JSON.parse(readFileSync(analysisPath, "utf8"));
  } catch {
    return { intervals: [], warnings: ["speech duck key: analysis.json is unavailable; speech intervals are empty"] };
  }
  if (!Array.isArray(analysis?.transcript) || analysis.transcript.length === 0) {
    return { intervals: [], warnings: ["speech duck key: analysis transcript is empty; speech intervals are empty"] };
  }
  const hasExplicitSources = Array.isArray(edit.cuts)
    && edit.cuts.some(cut => typeof cut?.src === "string" && cut.src !== "");
  let sourceId;
  if (hasExplicitSources) {
    if (typeof analysis.source !== "string" || analysis.source === "") {
      return { intervals: [], warnings: ["speech duck key: analysis source is missing; speech intervals are empty"] };
    }
    const analysisSource = normalizedAbsolutePath(projectRoot, analysis.source);
    const source = (edit.sources ?? []).find(candidate => typeof candidate?.path === "string"
      && normalizedAbsolutePath(projectRoot, candidate.path) === analysisSource);
    if (!source) {
      return { intervals: [], warnings: ["speech duck key: analysis source does not match sources[]; speech intervals are empty"] };
    }
    sourceId = source.id;
  }
  const projected = projectSpeechKeyIntervals(edit.cuts ?? [], analysis.transcript, {
    fps: edit.output?.fps,
    sourceId,
  });
  return { intervals: projected.intervals, warnings: [] };
}

function normalizedAbsolutePath(projectRoot, value) {
  const normalized = normalizePath(resolve(projectRoot, value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function mergeTimelineIntervals(values) {
  const sorted = values.filter(interval => isFiniteNumber(interval?.startSec)
      && isFiniteNumber(interval?.endSec) && interval.endSec > interval.startSec)
    .map(interval => ({ ...interval }))
    .sort((left, right) => left.startSec - right.startSec || left.endSec - right.endSec);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.startSec <= last.endSec) last.endSec = Math.max(last.endSec, interval.endSec);
    else merged.push(interval);
  }
  return merged;
}

function createClipEnvelope({ item, intervals, clipStartSec, clipDurationSec }) {
  if (!(clipDurationSec > 0)) return null;
  const keyframes = Array.isArray(item?.keyframes) ? item.keyframes.flatMap(point =>
    point && isFiniteNumber(point.t) && point.t >= 0 && isFiniteNumber(point.gain_db)
      ? [{ t: point.t, gainDb: point.gain_db, ...(typeof point.easing === "string" ? { easing: point.easing } : {}) }]
      : []).sort((left, right) => left.t - right.t) : [];
  const duck = intervals.length > 0 ? computeDuckEnvelope(intervals, {
    duckDb: item?.duck_db,
    attackSec: item?.duck_attack,
    releaseSec: item?.duck_release,
    clipStartSec,
    clipDurationSec,
  }) : [];
  const points = composeEnvelopesDb(keyframes, duck);
  if (points.length === 0 || points.every(point => Math.abs(point.gainDb) <= 1e-12)) return null;
  return { points, ducked: duck.some(point => Math.abs(point.gainDb) > 1e-12), keyframed: keyframes.length > 0 };
}

function appendEnvelopeInput({
  args, workDirectory, label, envelope, durationSec, envelopes, inputIndex,
}) {
  mkdirSync(workDirectory, { recursive: true });
  const path = join(workDirectory, `env-${label}.f32`);
  const samples = sampleEnvelopeLinear(envelope.points, { sampleRate: 48_000, durationSec });
  writeFileSync(path, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  args.push("-f", "f32le", "-ar", "48000", "-ac", "1", "-i", path);
  envelopes.push({
    label,
    path,
    points: envelope.points.length,
    ducked: envelope.ducked,
    keyframed: envelope.keyframed,
  });
  return inputIndex;
}

function normalizeAudioPlan(audio) {
  if (!audio) return { bgm: null, sfx: [] };
  const normalize = (value) => (typeof value === "string" ? { path: value } : value);
  return {
    bgm: audio.bgm ? normalize(audio.bgm) : null,
    sfx: Array.isArray(audio.sfx) ? audio.sfx.map(normalize) : [],
  };
}

// docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 (bgm): `in` is a file-internal start
// offset, applied as an input-side -ss ahead of the existing -stream_loop -1 -- verified empirically
// (ss-loop-test/, not checked in) that this seeks once before the loop begins and does not disturb
// the loop's own restart-from-file-start behavior, so "ループの既存意味論は不変" holds. Only probes
// the real file duration when `in` is actually present, so the omitted-in path (the common case)
// never pays the extra ffprobe call and stays byte-identical to pre-R6b output.
function resolveBgmInSeconds(bgm, ffprobeCommand, resolvedPath) {
  if (bgm.in === undefined) return { seconds: 0, warnings: [] };
  const raw = bgm.in;
  if (!isFiniteNumber(raw) || raw <= 0) return { seconds: 0, warnings: [] }; // schema/edit-lint reject negative; render tolerates as "no offset".
  const actualDuration = probeAudioDurationSeconds(ffprobeCommand, resolvedPath);
  if (isFiniteNumber(actualDuration) && actualDuration > 0 && raw >= actualDuration) {
    return {
      seconds: 0,
      warnings: [
        `audio.bgm.in ${formatNumber(raw)}s is at or beyond the material duration (${formatNumber(actualDuration)}s); clamped to 0s`,
      ],
    };
  }
  return { seconds: raw, warnings: [] };
}

// docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 (sfx): playback window = material's
// [in, out). in defaults to 0, out defaults to the material's own end. Only probes the material's
// real duration (an extra ffprobe call) when in/out or fade_in/fade_out is actually present on
// this item -- the fully-bare path (the vast majority of existing sfx) returns immediately with
// no trim filter and no known effectiveDuration, keeping its output byte-identical to pre-R6b.
// effectiveDuration (the [in,out) window's own length, once knowable) is what audio-clip-fades'
// resolveSfxFadeSeconds clamps fade_in/fade_out against -- null means "not knowable without a
// probe that didn't happen" and the caller skips fade application rather than guessing.
function resolveSfxTrim(sfx, ffprobeCommand, resolvedPath, index, needsEnvelopeDuration = false, speed = 1) {
  const hasIn = sfx.in !== undefined;
  const hasOut = sfx.out !== undefined;
  const hasFade = sfx.fade_in !== undefined || sfx.fade_out !== undefined;
  if (!hasIn && !hasOut && !hasFade && !needsEnvelopeDuration) {
    return { skip: false, trimFilter: "", effectiveDuration: null, warnings: [] };
  }

  const label = `audio.sfx[${index}]`;
  const warnings = [];
  const inSeconds = hasIn && isFiniteNumber(sfx.in) && sfx.in >= 0 ? sfx.in : 0;
  let outSeconds = hasOut && isFiniteNumber(sfx.out) && sfx.out > 0 ? sfx.out : null;

  const actualDuration = probeAudioDurationSeconds(ffprobeCommand, resolvedPath);
  if (isFiniteNumber(actualDuration) && actualDuration > 0) {
    if (inSeconds >= actualDuration) {
      warnings.push(
        `${label}: in ${formatNumber(inSeconds)}s is at or beyond the material duration (${formatNumber(actualDuration)}s); skipped (silent)`,
      );
      return { skip: true, trimFilter: "", effectiveDuration: null, warnings };
    }
    if (outSeconds === null || outSeconds > actualDuration) {
      if (outSeconds !== null) {
        warnings.push(
          `${label}: out ${formatNumber(outSeconds)}s exceeds the material duration (${formatNumber(actualDuration)}s); clamped to ${formatNumber(actualDuration)}s`,
        );
      }
      outSeconds = actualDuration;
    }
  }

  // out<=in is edit-lint's job to reject (contract §2: "out > in が必須（edit-lint が検証する）").
  // render-cut's defense here is deliberately minimal per the task brief: if it ever slips through
  // anyway, stay safe-side with a silent skip rather than pass a negative-duration atrim to ffmpeg.
  if (outSeconds !== null && outSeconds <= inSeconds) {
    warnings.push(
      `${label}: out <= in after clamping (in=${formatNumber(inSeconds)}s, out=${formatNumber(outSeconds)}s); skipped (silent)`,
    );
    return { skip: true, trimFilter: "", effectiveDuration: null, warnings };
  }

  const end = outSeconds === null ? "" : `:end=${formatNumber(outSeconds)}`;
  const trimFilter =
    inSeconds > 0 || end !== "" ? `atrim=start=${formatNumber(inSeconds)}${end},asetpts=PTS-STARTPTS,` : "";
  const effectiveDuration = outSeconds === null ? null : (outSeconds - inSeconds) / speed;
  return { skip: false, trimFilter, effectiveDuration, warnings };
}

// audio.bgm.fadeIn/fadeOut clamp rule: the "clip" bgm occupies is the full timeline (it is
// stream_loop'd and atrim'd to `duration` above), so each of fadeIn/fadeOut is independently capped
// at duration/2 -- the standard NLE handle ceiling that guarantees a fade-in and a fade-out can
// never together exceed the full duration, regardless of the other one's value.
function resolveBgmFadeSeconds(bgm, duration) {
  const warnings = [];
  const ceiling = isFiniteNumber(duration) && duration > 0 ? duration / 2 : 0;
  const resolveField = (label) => {
    const raw = bgm[label];
    if (raw === undefined) return 0;
    if (!isFiniteNumber(raw) || raw < 0) return 0; // schema/edit-lint reject this; render tolerates it as "no fade".
    if (ceiling > 0 && raw > ceiling) {
      warnings.push(
        `audio.bgm.${label} ${formatNumber(raw)}s exceeds half the timeline duration (${formatNumber(duration)}s); clamped to ${formatNumber(ceiling)}s`,
      );
      return ceiling;
    }
    return raw;
  };
  return { fadeIn: resolveField("fadeIn"), fadeOut: resolveField("fadeOut"), warnings };
}

function buildBgmFadeSuffix({ fadeIn, fadeOut }, duration) {
  const parts = [];
  if (fadeIn > 0) parts.push(`afade=t=in:st=0:d=${formatNumber(fadeIn)}`);
  if (fadeOut > 0) {
    const start = Math.max(0, duration - fadeOut);
    parts.push(`afade=t=out:st=${formatNumber(start)}:d=${formatNumber(fadeOut)}`);
  }
  return parts.length > 0 ? `,${parts.join(",")}` : "";
}

// docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 addendum (audio-clip-fades,
// 2026-08-18 — owner ruling "クリップ主義" T2): audio.sfx[].fade_in/fade_out clamp rule mirrors
// bgm's fadeIn/fadeOut (resolveBgmFadeSeconds above) but against the sfx clip's own effective
// playback window [t, t + effectiveDuration) instead of the full timeline -- effectiveDuration is
// resolveSfxTrim's [in,out) window length (or the full material duration when in/out are
// omitted), so each of fade_in/fade_out is independently capped at effectiveDuration/2. Only
// called once effectiveDuration is known (non-null); the caller skips fade entirely otherwise.
function resolveSfxFadeSeconds(sfx, effectiveDuration, label) {
  const warnings = [];
  const ceiling = isFiniteNumber(effectiveDuration) && effectiveDuration > 0 ? effectiveDuration / 2 : 0;
  const resolveField = (field) => {
    const raw = sfx[field];
    if (raw === undefined) return 0;
    if (!isFiniteNumber(raw) || raw < 0) return 0; // schema/edit-lint reject this; render tolerates it as "no fade".
    if (ceiling > 0 && raw > ceiling) {
      warnings.push(
        `${label}.${field} ${formatNumber(raw)}s exceeds half the clip's effective duration (${formatNumber(effectiveDuration)}s); clamped to ${formatNumber(ceiling)}s`,
      );
      return ceiling;
    }
    return raw;
  };
  return { fadeIn: resolveField("fade_in"), fadeOut: resolveField("fade_out"), warnings };
}

function buildSfxFadeSuffix({ fadeIn, fadeOut }, effectiveDuration) {
  const parts = [];
  if (fadeIn > 0) parts.push(`afade=t=in:st=0:d=${formatNumber(fadeIn)}`);
  if (fadeOut > 0) {
    const start = Math.max(0, effectiveDuration - fadeOut);
    parts.push(`afade=t=out:st=${formatNumber(start)}:d=${formatNumber(fadeOut)}`);
  }
  return parts.length > 0 ? `,${parts.join(",")}` : "";
}

export function buildMultiSourceAudioCutCommand({
  sourceInputs,
  cutPath,
  cuts,
  ffmpegCommand = resolveFfmpeg(),
  ffprobeCommand = resolveFfprobe(),
  audioDurationCache = new Map(),
  maxInputsPerCommand = MAX_AUDIO_INPUTS_PER_COMMAND,
}) {
  const sourcesById = new Map(sourceInputs.map((source) => [source.id, source]));
  const inputLimit = normalizeAudioInputLimit(maxInputsPerCommand);
  if (countAudioInputs(cuts, sourcesById) <= inputLimit) {
    return buildSequentialAudioCutCommand({
      sourceInputs, cutPath, cuts, ffmpegCommand, ffprobeCommand, audioDurationCache,
    });
  }

  const groups = splitAudioCuts(cuts, sourcesById, inputLimit);
  const { chunkPaths, listPath } = buildAudioChunkPaths(cutPath, groups.length);
  const chunkResults = groups.map((group, index) => buildSequentialAudioCutCommand({
    sourceInputs,
    cutPath: chunkPaths[index],
    cuts: group,
    ffmpegCommand,
    ffprobeCommand,
    audioDurationCache,
    audioCodecArgs: ["-c:a", "pcm_f32le", "-ar", "48000"],
  }));
  const concatListContent = chunkPaths
    .map((path) => `file '${escapeConcatListPath(resolve(path))}'`)
    .join("\n") + "\n";
  return {
    command: ffmpegCommand,
    warnings: chunkResults.flatMap((result) => result.warnings),
    args: [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-f", "concat", "-safe", "0", "-i", listPath,
      "-map", "0:a", "-vn", "-c:a", "aac", "-ar", "48000", cutPath,
    ],
    chunks: chunkResults.map((result, index) => ({
      command: result.command,
      args: result.args,
      output: chunkPaths[index],
    })),
    concat_list: { path: listPath, content: concatListContent },
    intermediates: [...chunkPaths, listPath].map((path) => resolve(path)),
  };
}

function buildSequentialAudioCutCommand({
  sourceInputs,
  cutPath,
  cuts,
  ffmpegCommand,
  ffprobeCommand,
  audioDurationCache,
  audioCodecArgs = ["-c:a", "aac", "-ar", "48000"],
}) {
  const { inputArgs, sourcesByCutIndex } = buildSeekedAudioInputs({ sourceInputs, cuts });
  const filters = [];
  const warnings = [];
  const audioLabels = [];
  const hasAnyTransition = cuts.slice(0, -1).some((cut) => cut.transition_out);

  for (const [index, cut] of cuts.entries()) {
    const source = sourcesByCutIndex.get(index);
    appendInputSeekedCutAudioFilter({
      filters, warnings, cut, source, index, ffprobeCommand, audioDurationCache,
    });
    audioLabels.push(`[a${index}]`);
  }

  if (!hasAnyTransition) {
    filters.push(`${audioLabels.join("")}concat=n=${cuts.length}:v=0:a=1[joineda]`);
  } else {
    const transitionDurations = effectiveTransitionDurations(cuts);
    let audioAcc = "[a0]";
    for (let index = 1; index < cuts.length; index += 1) {
      const boundary = cuts[index - 1].transition_out;
      const nextAudioLabel = index === cuts.length - 1 ? "[joineda]" : `[aacc${index}]`;
      if (boundary) {
        filters.push(`${audioAcc}[a${index}]acrossfade=d=${formatNumber(transitionDurations[index - 1])}${nextAudioLabel}`);
      } else {
        filters.push(`${audioAcc}[a${index}]concat=n=2:v=0:a=1${nextAudioLabel}`);
      }
      audioAcc = nextAudioLabel;
    }
  }

  return buildMultiSourceAudioCommandResult({
    ffmpegCommand, inputArgs, filters, cutPath, warnings, audioCodecArgs,
  });
}

function appendInputSeekedCutAudioFilter({
  filters, warnings, cut, source, index, ffprobeCommand, audioDurationCache,
}) {
  const speed = cutSpeed(cut);
  if (source.hasAudio === true) {
    appendAudioEndPaddingWarning({ warnings, cut, source, index, ffprobeCommand, audioDurationCache });
    const atempoSuffix = buildAtempoChain(speed)
      .map((factor) => `,atempo=${formatNumber(factor)}`)
      .join("");
    appendFreezeAwareRelativeAudioTrim({
      filters,
      inputLabel: `[${source.inputIndex}:a]`,
      outputLabel: `[a${index}]`,
      sourceIn: cut.in,
      sourceOut: cut.out,
      preroll: source.preroll ?? 0,
      speed,
      atempoSuffix,
      freeze: cut.freeze,
      id: `v1_${index}`,
      normalize: true,
      padToSeconds: Number.isFinite(cut.out) ? segmentDuration(cut) : undefined,
    });
  } else {
    filters.push(
      `anullsrc=r=48000:cl=stereo,atrim=duration=${formatNumber(segmentDuration(cut))},asetpts=PTS-STARTPTS[a${index}]`,
    );
  }
}

function buildMultiSourceAudioCommandResult({
  ffmpegCommand,
  inputArgs,
  filters,
  cutPath,
  warnings = [],
  audioCodecArgs = ["-c:a", "aac", "-ar", "48000"],
}) {
  return {
    command: ffmpegCommand,
    warnings,
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      ...inputArgs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[joineda]",
      "-vn",
      ...audioCodecArgs,
      cutPath,
    ],
  };
}

function buildSeekedAudioInputs({ sourceInputs, cuts }) {
  const sourcesById = new Map(sourceInputs.map((source) => [source.id, source]));
  const sourcesByCutIndex = new Map();
  const inputArgs = [];
  let inputIndex = 0;
  for (const [cutIndex, cut] of cuts.entries()) {
    const source = sourcesById.get(cut.src);
    if (source?.hasAudio === true) {
      const seekStart = Math.max(0, cut.in - AUDIO_SEEK_PREROLL_SECONDS);
      const preroll = cut.in - seekStart;
      inputArgs.push("-ss", formatNumber(seekStart));
      if (Number.isFinite(cut.out)) {
        inputArgs.push("-t", formatNumber((cut.out - cut.in) + preroll));
      }
      inputArgs.push("-i", source.path);
      sourcesByCutIndex.set(cutIndex, { ...source, inputIndex, preroll });
      inputIndex += 1;
    } else {
      sourcesByCutIndex.set(cutIndex, source);
    }
  }
  return { inputArgs, sourcesByCutIndex };
}

function countAudioInputs(cuts, sourcesById) {
  return cuts.reduce(
    (count, cut) => count + (sourcesById.get(cut.src)?.hasAudio === true ? 1 : 0),
    0,
  );
}

function normalizeAudioInputLimit(value) {
  return Number.isInteger(value) && value > 0 ? value : MAX_AUDIO_INPUTS_PER_COMMAND;
}

function splitAudioCuts(cuts, sourcesById, inputLimit) {
  const groups = [];
  let start = 0;
  while (start < cuts.length) {
    let inputCount = 0;
    let lastCleanBoundary = null;
    let end = start;
    for (; end < cuts.length; end += 1) {
      if (sourcesById.get(cuts[end].src)?.hasAudio === true) inputCount += 1;
      const cleanBoundary = end === cuts.length - 1 || !cuts[end].transition_out;
      if (cleanBoundary) lastCleanBoundary = end + 1;
      if (inputCount < inputLimit) continue;
      if (cleanBoundary) break;
      if (lastCleanBoundary !== null) {
        end = lastCleanBoundary - 1;
        break;
      }
      // A continuous transition chain has no safe split point. Extend past the nominal input
      // limit until the first boundary where an acrossfade pair will not be separated.
    }
    const next = Math.min(lastCleanBoundary ?? cuts.length, cuts.length);
    groups.push(cuts.slice(start, next));
    start = next;
  }
  return groups;
}

function buildAudioChunkPaths(cutPath, count) {
  const extension = extname(cutPath);
  const stem = extension ? cutPath.slice(0, -extension.length) : cutPath;
  return {
    chunkPaths: Array.from(
      { length: count },
      (_, index) => `${stem}-chunk-${String(index + 1).padStart(4, "0")}.wav`,
    ),
    listPath: `${stem}-chunks.txt`,
  };
}

function escapeConcatListPath(path) {
  return path.replaceAll("'", "'\\''");
}

// docs/contract-2026-08-18-v1-render-parity.md §2: v1's counterpart to the removed single-source gap-aware path
// below -- dispatched only from buildPlan's top-level v1 branch (NOT from buildTrackStackPlan's
// per-track v1 call in this file, which deliberately keeps calling the plain buildMultiSourceCutCommand
// above unchanged; see the contract for why: resolveCutTrackRanges's v1 branch already gets correct
// at/track placement out of a plain sequential per-track clip via its own offset math, verified by a
// real render in track-compose.test.mjs, and switching that clip to this gap-aware/output-aligned
// shape would silently break that existing, working math). This function instead fixes the actually
// broken path: a v1 project with cuts[].at / cuts[].track and NO custom timeline.tracks declaration
// (the common case -- this is what the UI writes when a user drags a clip to an explicit position or
// a PiP track), which today skips buildTrackStackPlan entirely (the removed flat default-order path) and falls
// straight into the plain concat above, silently ignoring at/track.
//
// Multi-track "compositing" here is v0's own winner-take-all switch (computeVideoRuns picks the
// highest-track cut active at each instant), not a simultaneous alpha overlay -- same semantics v0
// itself uses by default, so this is v0 parity, not a new richer model. Video runs with no active cut
// render as plain black (matches the removed single-source gap-aware path's gap filler). Audio is NOT winner-take-all:
// every cut's own [in,out) audio plays at its own `at` position and mixes together (amix), so a PiP
// cut's audio and the base track's audio both stay audible through the overlap even though only one
// track's picture shows at a time -- again mirroring the removed single-source gap-aware path exactly, just resolving
// each segment's source via cut.src instead of a single implicit v0 source.
export function buildGapAwareMultiSourceAudioCutCommand({
  sourceInputs,
  cutPath,
  cuts,
  duration,
  ffmpegCommand = resolveFfmpeg(),
  ffprobeCommand = resolveFfprobe(),
  audioDurationCache = new Map(),
  maxInputsPerCommand = MAX_AUDIO_INPUTS_PER_COMMAND,
}) {
  if (hasCutFreeze(cuts)) {
    throw new Error(
      "cuts[].freeze is not supported together with a gap-aware cut timeline (explicit at/track placement) in "
        + "v1 (sources[]) either -- same restriction as v0 (docs/contract-2026-07-22-render-basics.md #7). Remove "
        + "freeze from this cut, or drop its at/track placement so the whole cuts[] array renders through the "
        + "default sequential path instead.",
    );
  }
  const segments = resolveCutSegments(cuts);
  const sourcesById = new Map(sourceInputs.map((source) => [source.id, source]));
  const inputLimit = normalizeAudioInputLimit(maxInputsPerCommand);
  if (countAudioInputs(cuts, sourcesById) <= inputLimit) {
    return buildGapAwareAudioCutCommand({
      sourceInputs, cutPath, segments, duration, ffmpegCommand, ffprobeCommand, audioDurationCache,
    });
  }

  const groups = splitAudioCuts(cuts, sourcesById, inputLimit);
  const { chunkPaths } = buildAudioChunkPaths(cutPath, groups.length);
  let segmentOffset = 0;
  const chunkResults = groups.map((group, index) => {
    const groupSegments = segments.slice(segmentOffset, segmentOffset + group.length);
    segmentOffset += group.length;
    return buildGapAwareAudioCutCommand({
      sourceInputs,
      cutPath: chunkPaths[index],
      segments: groupSegments,
      duration,
      ffmpegCommand,
      ffprobeCommand,
      audioDurationCache,
      audioCodecArgs: ["-c:a", "pcm_f32le", "-ar", "48000"],
    });
  });
  const chunkInputArgs = chunkPaths.flatMap((path) => ["-i", path]);
  const mixInputs = chunkPaths.map((_, index) => `[${index}:a]`).join("");
  // Gap-aware cuts overlap on the output timeline, so concatenating chunk WAVs would change the
  // edit. Each chunk is instead padded to full duration and the final command adds those full-size
  // timelines together, preserving the original amix semantics across the split.
  return {
    command: ffmpegCommand,
    warnings: chunkResults.flatMap((result) => result.warnings),
    args: [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      ...chunkInputArgs,
      "-filter_complex",
      `${mixInputs}amix=inputs=${chunkPaths.length}:duration=longest:normalize=0[joineda]`,
      "-map", "[joineda]", "-vn", "-c:a", "aac", "-ar", "48000", cutPath,
    ],
    chunks: chunkResults.map((result, index) => ({
      command: result.command,
      args: result.args,
      output: chunkPaths[index],
    })),
    intermediates: chunkPaths.map((path) => resolve(path)),
  };
}

function buildGapAwareAudioCutCommand({
  sourceInputs,
  cutPath,
  segments,
  duration,
  ffmpegCommand,
  ffprobeCommand,
  audioDurationCache,
  audioCodecArgs = ["-c:a", "aac", "-ar", "48000"],
}) {
  const cuts = segments.map((segment) => segment.cut);
  const { inputArgs, sourcesByCutIndex } = buildSeekedAudioInputs({ sourceInputs, cuts });
  const filters = [];
  const warnings = [];
  appendInputSeekedGapAwareAudioFilters({
    filters,
    warnings,
    segments,
    sourcesByCutIndex,
    duration,
    ffprobeCommand,
    audioDurationCache,
  });
  return buildMultiSourceAudioCommandResult({
    ffmpegCommand, inputArgs, filters, cutPath, warnings, audioCodecArgs,
  });
}

function appendInputSeekedGapAwareAudioFilters({
  filters, warnings, segments, sourcesByCutIndex, duration, ffprobeCommand, audioDurationCache,
}) {
  const audioLabels = [];
  for (const [localIndex, segment] of segments.entries()) {
    const { index, cut } = segment;
    const source = sourcesByCutIndex.get(localIndex);
    const speed = cutSpeed(cut);
    if (source.hasAudio === true) {
      appendAudioEndPaddingWarning({ warnings, cut, source, index, ffprobeCommand, audioDurationCache });
      const atempoSuffix = buildAtempoChain(speed)
        .map((factor) => `,atempo=${formatNumber(factor)}`)
        .join("");
      appendFreezeAwareRelativeAudioTrim({
        filters,
        inputLabel: `[${source.inputIndex}:a]`,
        outputLabel: `[araw1_${index}]`,
        sourceIn: cut.in,
        sourceOut: cut.out,
        preroll: source.preroll ?? 0,
        speed,
        atempoSuffix,
        padToSeconds: segmentDuration(cut),
      });
    } else {
      filters.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${formatNumber(segmentDuration(cut))},asetpts=PTS-STARTPTS[araw1_${index}]`,
      );
    }
    const delayMs = Math.max(0, Math.round(segment.start * 1000));
    filters.push(`[araw1_${index}]adelay=${delayMs}:all=1[adelay1_${index}]`);
    audioLabels.push(`[adelay1_${index}]`);
  }
  if (audioLabels.length === 1) {
    filters.push(`${audioLabels[0]}apad=whole_dur=${formatNumber(duration)}[joineda]`);
  } else {
    filters.push(
      `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,apad=whole_dur=${formatNumber(duration)}[joineda]`,
    );
  }
}

function appendGapAwareAudioFilters({
  filters, warnings, segments, inputsById, duration, ffprobeCommand, audioDurationCache,
}) {
  // Audio is per-cut (not per-run): every cut's own [in,out) plays at its own `at` position and
  // mixes with every other cut's audio, regardless of which track wins the picture at that moment.
  // Mirrors the removed single-source gap-aware path's own audio loop exactly (iterates segments, not runs).
  const audioLabels = [];
  for (const segment of segments) {
    const { index, cut } = segment;
    const source = inputsById.get(cut.src);
    const speed = cutSpeed(cut);
    if (source.hasAudio) {
      appendAudioEndPaddingWarning({ warnings, cut, source, index, ffprobeCommand, audioDurationCache });
      const atempoSuffix = buildAtempoChain(speed)
        .map((factor) => `,atempo=${formatNumber(factor)}`)
        .join("");
      filters.push(
        `[${source.inputIndex}:a]atrim=start=${formatNumber(cut.in)}:end=${formatNumber(cut.out)},asetpts=PTS-STARTPTS${atempoSuffix},apad=whole_dur=${formatNumber(segmentDuration(cut))}[araw1_${index}]`,
      );
    } else {
      filters.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${formatNumber(segmentDuration(cut))},asetpts=PTS-STARTPTS[araw1_${index}]`,
      );
    }
    const delayMs = Math.max(0, Math.round(segment.start * 1000));
    filters.push(`[araw1_${index}]adelay=${delayMs}:all=1[adelay1_${index}]`);
    audioLabels.push(`[adelay1_${index}]`);
  }
  if (audioLabels.length === 1) {
    filters.push(`${audioLabels[0]}apad=whole_dur=${formatNumber(duration)}[joineda]`);
  } else {
    filters.push(
      `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,apad=whole_dur=${formatNumber(duration)}[joineda]`,
    );
  }
}

function appendAudioEndPaddingWarning({ warnings, cut, source, index, ffprobeCommand, audioDurationCache }) {
  if (!ffprobeCommand || !source?.hasAudio) return;
  let actualDuration;
  if (audioDurationCache.has(source.id)) {
    actualDuration = audioDurationCache.get(source.id);
  } else {
    actualDuration = probeAudioStreamDurationSeconds(ffprobeCommand, source.path);
    audioDurationCache.set(source.id, actualDuration);
  }
  if (!isFiniteNumber(actualDuration) || !isFiniteNumber(cut.out) || cut.out <= actualDuration) return;
  const speed = cutSpeed(cut);
  const missingSourceSeconds = Math.max(0, cut.out - Math.max(cut.in, actualDuration));
  const paddedSeconds = missingSourceSeconds / speed;
  warnings.push(
    `cut ${cut.id ?? index + 1}: audio stream ends at ${formatSeconds(actualDuration)}s before out=${formatSeconds(cut.out)}s; padded ${formatSeconds(paddedSeconds)}s of silence`,
  );
}

function probeAudioStreamDurationSeconds(ffprobeCommand, path) {
  if (!existsSync(path)) return null;
  const result = spawnSync(
    ffprobeCommand,
    [
      "-v", "error", "-select_streams", "a:0",
      "-show_entries", "stream=duration,duration_ts,time_base", "-of", "json", path,
    ],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) return null;
  try {
    const stream = JSON.parse(result.stdout).streams?.[0];
    const duration = Number(stream?.duration);
    if (Number.isFinite(duration) && duration > 0) return duration;
    const durationTs = Number(stream?.duration_ts);
    const [numerator, denominator] = String(stream?.time_base ?? "").split("/").map(Number);
    const derived = durationTs * numerator / denominator;
    return Number.isFinite(derived) && derived > 0 ? derived : null;
  } catch {
    return null;
  }
}

export function predictedDuration(cuts, sourceDuration = 0) {
  // docs/contract-2026-08-18-v1-render-parity.md §2: gap-awareness (explicit at/track) is checked
  // before the version branch now, for both v0 and v1 -- an at-gap or a track>=1 cut shifts the
  // real end of the timeline (the removed single-source gap-aware path / buildGapAwareMultiSourceCutCommand both
  // pad/position to this same segment-end-max), so a plain sum-of-segments duration undercounts
  // trailing gaps and overcounts a PiP cut nested entirely inside its base track's span. v1 used to
  // short-circuit to sequentialDurationWithTransitionOverlap before this check ever ran, so an at/
  // track v1 project got the wrong predicted_duration_seconds even after the render itself became
  // gap-aware -- verify.duration would then reject a now-correctly-rendered file.
  if (Array.isArray(cuts) && cuts.length > 0 && needsGapAwareCutTimeline(cuts)) {
    const segments = resolveCutSegments(cuts);
    return Math.max(0, ...segments.map((segment) => segment.end));
  }
  if (Array.isArray(cuts) && cuts.length > 0) {
    return sequentialDurationWithTransitionOverlap(cuts);
  }
  return sourceDuration;
}

function sequentialDurationWithTransitionOverlap(cuts) {
  const segmentsTotal = cuts.reduce((sum, cut) => sum + segmentDuration(cut), 0);
  // A transition_out overlaps its own segment's end with the next segment's start, shortening
  // the combined timeline by the overlap (xfade/acrossfade's own duration math — see
  // the removed single-source path / buildMultiSourceCutCommand). The last cut's transition_out (if any) has no
  // following segment to blend into, so it never actually renders and must not be subtracted here.
  const transitionOverlap = cuts
    .slice(0, -1)
    .reduce((sum, cut) => sum + (isPositiveNumber(cut.transition_out?.duration) ? cut.transition_out.duration : 0), 0);
  return segmentsTotal - transitionOverlap;
}

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function selectDefaultOutput(projectRoot, edit, exists) {
  const configured = typeof edit.name === "string" && edit.name.trim() !== "" ? edit.name : null;
  const namingSource = edit.sources[0]?.path;
  const sourceName = basename(namingSource, extname(namingSource));
  const stem = sanitizeName(configured ?? sourceName ?? "render");
  const directory = join(projectRoot, "exports");
  let index = 1;
  let candidate = join(directory, `${stem}.mp4`);
  while (exists(candidate)) {
    index += 1;
    candidate = join(directory, `${stem}-${index}.mp4`);
  }
  return candidate;
}

function relativeOrAbsolute(root, value) {
  const result = relative(root, value);
  return result.startsWith("..") ? value : result;
}

function sanitizeName(value) {
  const result = String(value).trim().replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return result || "render";
}

function formatNumber(value) {
  return Number(value).toString();
}

function formatSeconds(value) {
  return formatNumber(Number(Number(value).toFixed(6)));
}
