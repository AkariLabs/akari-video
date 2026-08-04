import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  computeCutTimelineOffsets,
  computeVideoRuns,
  cutSpeed,
  needsGapAwareCutTimeline,
  resolveCutSegments,
  segmentDuration,
} from "./cut-timeline.mjs";
import { appendCutVisualTransform, hasCutVisualTransform } from "./cut-transform.mjs";
import { buildTailPadCommand, computeContentDurationSeconds } from "./content-duration.mjs";
import { resolveEncodingPolicy } from "./encode-preset.mjs";
import { buildLayersCompositeCommand, hasLayers } from "./layers.mjs";
import { resolveLutPath } from "./render-inputs.mjs";
import {
  buildCutTrackCompositeCommand,
  buildTrackBaseCommand,
  resolveCutTrackRanges,
} from "./track-compose.mjs";
import { resolveTrackOrder, usesDefaultTrackOrder } from "./track-order.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";

// docs/contract-2026-07-14-edit-json-v1-audio.md §4: sidechaincompress threshold ~-24dB (linear 0.063), ratio 8, attack 5ms, release 300ms.
const DUCKING_SIDECHAIN_ARGS = "threshold=0.063:ratio=8:attack=5:release=300";
// docs/contract-2026-07-20-edit-json-v1-narration.md §1: gain_db clamp range, shared with bgm/sfx.
const GAIN_DB_MIN = -60;
const GAIN_DB_MAX = 12;

export function buildPlan({
  edit,
  projectRoot,
  outputPath,
  capabilities,
  hasSourceAudio,
  renderOverlays = edit.overlays,
  captionOverlays = [],
  hasThreeDimensionalOverlay = false,
  // Execution-unique subdirectory for intermediates (see render-cut.mjs's per-run isolation).
  // Defaults to the flat, deterministic path so direct callers (unit tests, --plan-only preview)
  // keep producing byte-identical command plans across repeated calls.
  temporaryDirectory = join(projectRoot, ".akari", "render-tmp"),
  // --quality/--encoder/--fps (task 2026-07-25-export-options). All three default to undefined,
  // under which buildVideoEncodeArgs/resolveEncoderChoice below resolve to exactly today's
  // literal command args (no -crf/-preset/-b:v added, fps taken from edit.json unchanged) — the
  // backward-compat guarantee this task requires.
  quality,
  encoder,
  encodingPolicy,
  fpsOverride,
}) {
  const width = edit.output.width;
  const height = edit.output.height;
  const fps = isPositiveNumber(fpsOverride) ? fpsOverride : edit.output.fps;
  const resolvedEncodingPolicy = encodingPolicy === undefined
    ? resolveEncodingPolicy({ cli: { quality, encoder }, edit, capabilities })
    : encodingPolicy;
  const videoEncodeArgs = resolvedEncodingPolicy?.video_encode_args ?? null;
  const cutsEndSeconds = predictedDuration(edit.cuts, capabilities.sourceDuration, edit.version);
  const finalDurationSeconds = computeContentDurationSeconds({
    edit,
    cutsEndSeconds,
    projectRoot,
    captionOverlays,
    probeAudioDurationSeconds,
    ffprobeCommand: capabilities.ffprobeCommand,
  });
  const temporary = temporaryDirectory;
  const cutPath = join(temporary, "cut.mp4");
  const tailPaddedPath = join(temporary, "cut-tail-padded.mp4");
  const layeredPath = join(temporary, "layered.mp4");
  const overlayMovPath = join(temporary, "overlay.mov");
  const compositePath = join(temporary, "composite.mp4");
  const finalPath = join(temporary, "final.mp4");
  const sheetPath = join(temporary, "overlay-sheet.html");
  const rasterizer = selectRasterizer(capabilities, hasThreeDimensionalOverlay);
  let cut;
  if (edit.version === 1) {
    cut = buildMultiSourceCutCommand({
      sourceInputs: capabilities.sourceInputs,
      cutPath,
      cuts: edit.cuts,
      width,
      height,
      fps,
      ffmpegCommand: capabilities.ffmpegCommand,
      projectRoot,
      look: edit.output.look,
      videoEncodeArgs,
    });
  } else {
    const sourcePath = resolve(projectRoot, edit.source.path);
    cut = buildCutCommand({
      sourcePath,
      cutPath,
      cuts: edit.cuts,
      width,
      height,
      fps,
      hasAudio: hasSourceAudio,
      duration: cutsEndSeconds,
      ffmpegCommand: capabilities.ffmpegCommand,
      projectRoot,
      look: edit.output.look,
      chromaKey: edit.source?.chroma_key,
      videoEncodeArgs,
    });
  }
  const tailPad = finalDurationSeconds > cutsEndSeconds + 0.001
    ? buildTailPadCommand({
        ffmpegCommand: capabilities.ffmpegCommand,
        inputPath: cutPath,
        outputPath: tailPaddedPath,
        cutsEndSeconds,
      finalDurationSeconds,
      videoEncodeArgs,
      })
    : null;
  const cutOutputPath = tailPad ? tailPaddedPath : cutPath;
  // layers[] is additive-only (contract-2026-07-22-prerender-rail-and-assets.md §1.2): an edit.json
  // without it produces no `layers` command and render-cut.mjs skips this stage entirely, so
  // existing projects keep their byte-identical cut.mp4 -> composite pipeline (zero regression).
  const defaultTrackOrder = usesDefaultTrackOrder(edit);
  const layers = defaultTrackOrder && hasLayers(edit)
    ? buildLayersCompositeCommand({
        layers: edit.layers,
        projectRoot,
        ffmpegCommand: capabilities.ffmpegCommand,
        inputPath: cutOutputPath,
        outputPath: layeredPath,
        duration: finalDurationSeconds,
        width,
        height,
        videoEncodeArgs,
      })
    : null;
  const trackStack = defaultTrackOrder
    ? null
    : buildTrackStackPlan({
        edit,
        projectRoot,
        capabilities,
        cutPath: cutOutputPath,
        layeredPath,
        temporary,
        duration: finalDurationSeconds,
        cutsEndSeconds,
        width,
        height,
        fps,
        hasSourceAudio,
        videoEncodeArgs,
      });
  const baseVideoPath = trackStack ? trackStack.outputPath : (layers ? layeredPath : cutOutputPath);

  // v1（sources[]）の書き出しは cuts[] を連結するだけで track / at を合成しない。
  // 宣言だけ通って絵が消える事故を検証メッセージで名指しするための旗（verifyArtifact が読む）。
  const cutTrackDeclarationUnrendered = edit.version === 1
    && Array.isArray(edit.cuts)
    && needsGapAwareCutTimeline(edit.cuts);

  return {
    cut_track_declaration_unrendered: cutTrackDeclarationUnrendered,
    predicted_duration_seconds: finalDurationSeconds,
    duration_tolerance_seconds: Math.max(0.1, 2 / fps),
    output: relativeOrAbsolute(projectRoot, outputPath),
    preset: {
      video_codec: "h264",
      profile: "high",
      pixel_format: "yuv420p",
      audio_codec: "aac",
      width,
      height,
      fps,
    },
    ...(resolvedEncodingPolicy ? { encoding: resolvedEncodingPolicy } : {}),
    rasterizer: {
      selected: rasterizer,
      // 3D scenes cannot degrade to a still image: execution rejects HyperFrames and requires
      // puppeteer-core, while ordinary overlays follow this same full fallback order.
      order: hasThreeDimensionalOverlay
        ? ["puppeteer-core"]
        : ["hyperframes", "puppeteer-core", "static-screenshot"],
    },
    intermediates: [
      cutPath,
      ...(tailPad ? [tailPaddedPath] : []),
      ...(layers ? [layeredPath] : []),
      ...(trackStack ? trackStack.intermediates : []),
      sheetPath,
      overlayMovPath,
      join(temporary, "frames", "frame-%08d.png"),
      ...renderOverlays.flatMap((_, index) => {
        const stem = `static-${String(index + 1).padStart(4, "0")}`;
        return [join(temporary, `${stem}.html`), join(temporary, `${stem}.png`)];
      }),
      compositePath,
      finalPath,
    ].map((value) => relative(projectRoot, value)),
    commands: {
      cut,
      tail_pad: tailPad,
      rasterize: {
        hyperframes: {
          command: process.execPath,
          cwd: projectRoot,
          env: {
            HYPERFRAMES_BROWSER_PATH: capabilities.chromePath,
            DO_NOT_TRACK: "1",
          },
          args: [
            hyperframesEntry(),
            "render",
            ".",
            "--composition",
            relative(projectRoot, sheetPath),
            "--format",
            "mov",
            "--fps",
            String(fps),
            "--workers",
            "1",
            "--no-browser-gpu",
            "--no-best-effort",
            "-o",
            relative(projectRoot, overlayMovPath),
          ],
        },
        "puppeteer-core": {
          operation: "capture-transparent-png-sequence",
          driver: "puppeteer-core",
          input: relative(projectRoot, sheetPath),
          output_pattern: relative(projectRoot, join(temporary, "frames", "frame-%08d.png")),
        },
        "static-screenshot": {
          operation: "capture-one-transparent-png-per-overlay",
          driver: capabilities.chromePath ?? "chrome",
          outputs: renderOverlays.map((_, index) =>
            relative(projectRoot, join(temporary, `static-${String(index + 1).padStart(4, "0")}.png`)),
          ),
        },
      },
      composite: {
        hyperframes: buildAnimatedCompositeCommand(
          capabilities.ffmpegCommand,
          baseVideoPath,
          overlayMovPath,
          compositePath,
          videoEncodeArgs,
        ),
        "puppeteer-core": buildAnimatedCompositeCommand(
          capabilities.ffmpegCommand,
          baseVideoPath,
          overlayMovPath,
          compositePath,
          videoEncodeArgs,
        ),
        "static-screenshot": buildStaticCompositeCommand(
          capabilities.ffmpegCommand,
          baseVideoPath,
          compositePath,
          temporary,
          renderOverlays,
          finalDurationSeconds,
          videoEncodeArgs,
        ),
      },
      layers,
      track_stack: trackStack,
      audio_mix: buildAudioMixCommand({
        edit,
        projectRoot,
        inputPath: compositePath,
        outputPath: finalPath,
        duration: finalDurationSeconds,
        ffmpegCommand: capabilities.ffmpegCommand,
        ffprobeCommand: capabilities.ffprobeCommand,
      }),
      verify: {
        command: capabilities.ffprobeCommand,
        args: ["-v", "error", "-show_streams", "-show_format", "-of", "json", relativeOrAbsolute(projectRoot, outputPath)],
      },
    },
  };
}

function buildTrackStackPlan({
  edit,
  projectRoot,
  capabilities,
  cutPath,
  layeredPath,
  temporary,
  duration,
  cutsEndSeconds,
  width,
  height,
  fps,
  hasSourceAudio,
  videoEncodeArgs,
}) {
  const ordered = resolveTrackOrder(edit)
    .map((track, orderIndex) => {
      const ref = Number.isInteger(track?.ref) ? track.ref : null;
      const items = track?.kind === "cuts"
        ? edit.cuts.filter(cut => (cut.track ?? 0) === ref)
        : track?.kind === "layers"
          ? (edit.layers ?? []).filter(layer => (layer.track ?? 0) === ref)
          : [];
      return { kind: track?.kind, ref, orderIndex, items };
    })
    .filter(track => (track.kind === "cuts" || track.kind === "layers") && track.items.length > 0);

  const basePath = join(temporary, "track-base.mp4");
  const base = buildTrackBaseCommand({
    ffmpegCommand: capabilities.ffmpegCommand,
    inputPath: cutPath,
    outputPath: basePath,
    duration,
    width,
    height,
    fps,
    videoEncodeArgs,
  });
  const cutTracks = [];
  const stages = [];
  let previousPath = basePath;

  ordered.forEach((track, stageIndex) => {
    const isLast = stageIndex === ordered.length - 1;
    const outputPath = isLast ? layeredPath : join(temporary, `track-stage-${stageIndex}.mp4`);
    if (track.kind === "cuts") {
      const trackPath = join(temporary, `cut-track-${track.ref}-${track.orderIndex}.mp4`);
      const command = edit.version === 1
        ? buildMultiSourceCutCommand({
            sourceInputs: capabilities.sourceInputs,
            cutPath: trackPath,
            cuts: track.items,
            width,
            height,
            fps,
            ffmpegCommand: capabilities.ffmpegCommand,
            projectRoot,
            look: edit.output.look,
            videoEncodeArgs,
          })
        : buildCutCommand({
            sourcePath: resolve(projectRoot, edit.source.path),
            cutPath: trackPath,
            cuts: track.items,
            width,
            height,
            fps,
            hasAudio: hasSourceAudio,
            duration: cutsEndSeconds,
            ffmpegCommand: capabilities.ffmpegCommand,
            projectRoot,
            look: edit.output.look,
            chromaKey: edit.source?.chroma_key,
            videoEncodeArgs,
          });
      cutTracks.push({ ref: track.ref, path: trackPath, command });
      stages.push({
        kind: "cuts",
        ref: track.ref,
        command: buildCutTrackCompositeCommand({
          ffmpegCommand: capabilities.ffmpegCommand,
          inputPath: previousPath,
          trackPath,
          outputPath,
          ranges: resolveCutTrackRanges(track.items, {
            version: edit.version,
            sourceDuration: capabilities.sourceDuration,
            outputDuration: duration,
          }),
          duration,
          videoEncodeArgs,
        }),
      });
    } else {
      stages.push({
        kind: "layers",
        ref: track.ref,
        command: buildLayersCompositeCommand({
          layers: track.items,
          projectRoot,
          ffmpegCommand: capabilities.ffmpegCommand,
          inputPath: previousPath,
          outputPath,
          duration,
          width,
          height,
          videoEncodeArgs,
        }),
      });
    }
    previousPath = outputPath;
  });

  return {
    base,
    cutTracks,
    stages,
    outputPath: ordered.length > 0 ? layeredPath : basePath,
    intermediates: [
      basePath,
      ...cutTracks.map(track => track.path),
      ...stages
        .slice(0, -1)
        .map((_, index) => join(temporary, `track-stage-${index}.mp4`)),
      ...(ordered.length > 0 ? [layeredPath] : []),
    ],
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

  if (!audio.bgm && audio.sfx.length === 0 && !hasNarration && !master) {
    return { operation: "copy", input: inputPath, output: outputPath, warnings, hasNarration };
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
      const delay = Math.max(0, Math.round(track.t * 1000));
      const rawLabel = `nar_raw${index}`;
      filters.push(
        `[${inputIndex}:a]volume=${formatNumber(track.gain_db)}dB,adelay=${delay}:all=1[${rawLabel}]`,
      );
      rawLabels.push(`[${rawLabel}]`);
      inputIndex += 1;
    }
    // Pad to the full timeline duration so a short narration track never truncates a downstream
    // sidechaincompress (which otherwise ends at the shorter of its two inputs).
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
    // afade is chained directly onto volume/atrim -- i.e. baked into the [bgm] label itself --
    // rather than appended after ducking's sidechaincompress step below. Empirically verified
    // (audio-bgm-fade.test.mjs "order" case): sidechaincompress's gain reduction is driven only by
    // the narration (key/sidechain) input's level, never by bgm's own amplitude, so multiplying in
    // the fade envelope before or after ducking is mathematically commutative and measures
    // identically either way. Applying it here keeps the fade envelope visible on every downstream
    // consumer of [bgm]/[bgm_ducked] without a second branch, and matches the reserved-seat design
    // note ("afade を volume の後").
    filters.push(
      `[${inputIndex}:a]volume=${formatNumber(audio.bgm.gain_db ?? 0)}dB,atrim=duration=${formatNumber(duration)}${buildBgmFadeSuffix(bgmFade, duration)}[bgm]`,
    );
    bgmLabel = "[bgm]";
    inputIndex += 1;

    if (audio.bgm.ducking === true && narrationLabel) {
      // [narration] would otherwise be referenced twice (once as sidechaincompress's key input,
      // once as the final amix's input). ffmpeg's filtergraph requires each labeled pad to be
      // consumed exactly once; a second reference is accepted without error but left unconnected
      // (ffmpeg 8.1.1), silently dropping narration from the output. asplit fans it out into two
      // independent copies, one per consumer.
      filters.push(`${narrationLabel}asplit=2[nar_sc][nar_mix]`);
      filters.push(`[bgm][nar_sc]sidechaincompress=${DUCKING_SIDECHAIN_ARGS}[bgm_ducked]`);
      bgmLabel = "[bgm_ducked]";
      narrationLabel = "[nar_mix]";
    }
    labels.push(bgmLabel);
  }
  for (const [index, sfx] of audio.sfx.entries()) {
    const sfxSourcePath = resolve(projectRoot, sfx.path);
    const trim = resolveSfxTrim(sfx, ffprobeCommand, sfxSourcePath, index);
    warnings.push(...trim.warnings);
    if (trim.skip) continue;
    args.push("-i", sfxSourcePath);
    const delay = Math.max(0, Math.round((sfx.t ?? 0) * 1000));
    filters.push(
      `[${inputIndex}:a]${trim.trimFilter}volume=${formatNumber(sfx.gain_db ?? 0)}dB,adelay=${delay}:all=1[sfx${index}]`,
    );
    labels.push(`[sfx${index}]`);
    inputIndex += 1;
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
  return { operation: "ffmpeg", command: ffmpegCommand, args, warnings, hasNarration };
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
  const rawTruePeak = master.true_peak_dbtp;
  const truePeakTarget = typeof rawTruePeak === "number" && Number.isFinite(rawTruePeak) ? rawTruePeak : -1.5;
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
    if (!isReadableAudioFile(ffprobeCommand, resolvedPath)) {
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
    tracks.push({ id, path: resolvedPath, t, gain_db });
  }
  return { tracks, warnings };
}

function isReadableAudioFile(ffprobeCommand, path) {
  const result = spawnSync(
    ffprobeCommand,
    ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", path],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) return false;
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed.streams) && parsed.streams.some((stream) => stream.codec_type === "audio");
  } catch {
    return false;
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

function buildAnimatedCompositeCommand(command, cutPath, overlayPath, outputPath, videoEncodeArgs = null) {
  return {
    command,
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      cutPath,
      "-i",
      overlayPath,
      "-filter_complex",
      "[0:v][1:v]overlay=0:0:format=auto:shortest=1[outv]",
      "-map",
      "[outv]",
      "-map",
      "0:a:0",
      ...(videoEncodeArgs ?? ["-c:v", "libx264", "-profile:v", "high"]),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      outputPath,
    ],
  };
}

function buildStaticCompositeCommand(command, cutPath, outputPath, temporary, overlays, duration, videoEncodeArgs = null) {
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", cutPath];
  const filters = [];
  let previous = "[0:v]";
  for (const [index, overlay] of overlays.entries()) {
    const png = join(temporary, `static-${String(index + 1).padStart(4, "0")}.png`);
    args.push("-loop", "1", "-i", png);
    const next = `[overlay${index}]`;
    filters.push(
      `${previous}[${index + 1}:v]overlay=0:0:format=auto:enable='between(t,${formatNumber(overlay.start)},${formatNumber(overlay.start + overlay.duration)})'${next}`,
    );
    previous = next;
  }
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    previous,
    "-map",
    "0:a:0",
    "-t",
    formatNumber(duration),
    ...(videoEncodeArgs ?? ["-c:v", "libx264", "-profile:v", "high"]),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    outputPath,
  );
  return { command, args };
}

// docs/contract-2026-07-22-render-basics.md #4: "lut(プリセット参照 or パス)" — a bare name (no
// path separator) resolves against presets/luts/<name>/<name>.cube; anything else is treated as a
// path relative to the project root (same regel as source.path / audio.bgm.path elsewhere).
// ffmpeg filter option values split on ':' and quote-related characters; escape both before
// wrapping the value in single quotes (lut3d's file= option; same convention as chromakey's color=).
function escapeFilterPath(path) {
  return path.replace(/\\/gu, "\\\\").replace(/:/gu, "\\:").replace(/'/gu, "\\'");
}

const CSS_COLOR_KEYWORDS = new Set([
  "black",
  "white",
  "red",
  "green",
  "blue",
  "yellow",
  "cyan",
  "magenta",
  "gray",
  "grey",
  "orange",
  "purple",
  "pink",
  "brown",
]);

function isColorLike(value) {
  return value.startsWith("#") || /^0x/iu.test(value) || CSS_COLOR_KEYWORDS.has(value.toLowerCase());
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
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
// real duration (an extra ffprobe call) when in/out is actually present on this item -- the
// in/out-free path (the vast majority of existing sfx) returns immediately with no trim filter,
// keeping its output byte-identical to pre-R6b.
function resolveSfxTrim(sfx, ffprobeCommand, resolvedPath, index) {
  const hasIn = sfx.in !== undefined;
  const hasOut = sfx.out !== undefined;
  if (!hasIn && !hasOut) return { skip: false, trimFilter: "", warnings: [] };

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
      return { skip: true, warnings };
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
    return { skip: true, warnings };
  }

  const end = outSeconds === null ? "" : `:end=${formatNumber(outSeconds)}`;
  const trimFilter =
    inSeconds > 0 || end !== "" ? `atrim=start=${formatNumber(inSeconds)}${end},asetpts=PTS-STARTPTS,` : "";
  return { skip: false, trimFilter, warnings };
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

export function buildCutCommand({
  sourcePath,
  cutPath,
  cuts,
  width,
  height,
  fps,
  hasAudio,
  duration,
  ffmpegCommand = resolveFfmpeg(),
  projectRoot,
  look,
  chromaKey,
  videoEncodeArgs = null,
}) {
  if (needsGapAwareCutTimeline(cuts)) {
    return buildGapAwareCutCommand({ sourcePath, cutPath, cuts, width, height, fps, hasAudio, duration, ffmpegCommand, projectRoot, look, chromaKey, videoEncodeArgs });
  }
  const effectiveCuts = cuts.length > 0 ? cuts : [{ in: 0, out: null }];
  const transformCuts = hasCutVisualTransform(effectiveCuts);
  const filters = [];
  const concatInputs = [];
  // docs/contract-2026-07-22-render-basics.md #3 (cuts[].transition_out). Residual decision 3
  // (command-center ruling): v0 only takes the xfade path at cut boundaries that explicitly
  // specify transition_out; every other boundary keeps today's exact N-input concat call
  // untouched, so a project with zero transition_out is byte-for-byte unaffected.
  const hasAnyTransition = effectiveCuts
    .slice(0, -1)
    .some((cut) => cut.transition_out);
  // xfade/acrossfade require both of their inputs to share one timebase; concat's own output
  // timebase does not always match a fresh trim+setpts segment's (verified empirically: mixing
  // concat'd and freshly-trimmed segments into a later xfade failed with "do not match ...
  // timebase"). settb=AVTB standardizes every segment onto ffmpeg's default timebase before they
  // are ever joined, so it is only added on the transition-aware path (never touches the
  // non-regression concat-only path's exact filter string).
  const timebaseNormalizer = hasAnyTransition ? ",settb=AVTB" : "";
  for (const [index, cut] of effectiveCuts.entries()) {
    const end = cut.out === null ? "" : `:end=${formatNumber(cut.out)}`;
    // docs/contract-2026-07-22-render-basics.md #1 (cuts[].speed): v0 is constant speed only
    // (residual decision 1, command-center ruling: pitch preservation is fixed, not optional).
    // setpts divides by speed so the resulting segment plays at speed x its original duration
    // shrinks accordingly; atempo (audio) achieves the same duration change while resampling
    // pitch back to the original, chained in <=2x/>=0.5x steps per ffmpeg's atempo range limit.
    const speed = cutSpeed(cut);
    const ptsExpr = speed === 1 ? "PTS-STARTPTS" : `(PTS-STARTPTS)/${formatNumber(speed)}`;
    const trimmedLabel = transformCuts ? `[vraw${index}]` : `[v${index}]`;
    filters.push(
      `[0:v]trim=start=${formatNumber(cut.in)}${end},setpts=${ptsExpr}${timebaseNormalizer}${trimmedLabel}`,
    );
    if (transformCuts) {
      appendCutVisualTransform({
        filters,
        inputLabel: trimmedLabel,
        outputLabel: `[v${index}]`,
        cut,
        id: `v${index}`,
        width,
        height,
        fps,
        duration: segmentDuration(cut),
      });
    }
    concatInputs.push(`[v${index}]`);
    if (hasAudio) {
      const atempoSuffix = buildAtempoChain(speed)
        .map((factor) => `,atempo=${formatNumber(factor)}`)
        .join("");
      filters.push(
        `[0:a]atrim=start=${formatNumber(cut.in)}${end},asetpts=PTS-STARTPTS${atempoSuffix}[a${index}]`,
      );
      concatInputs.push(`[a${index}]`);
    }
  }

  if (!hasAnyTransition) {
    filters.push(
      `${concatInputs.join("")}concat=n=${effectiveCuts.length}:v=1:a=${hasAudio ? 1 : 0}[joinedv]${hasAudio ? "[joineda]" : ""}`,
    );
  } else {
    const cutOffsets = computeCutTimelineOffsets(effectiveCuts);
    let videoAcc = "[v0]";
    let audioAcc = hasAudio ? "[a0]" : null;
    for (let index = 1; index < effectiveCuts.length; index += 1) {
      const boundary = effectiveCuts[index - 1].transition_out;
      const isLastBoundary = index === effectiveCuts.length - 1;
      const nextVideoLabel = isLastBoundary ? "[joinedv]" : `[vacc${index}]`;
      const nextAudioLabel = hasAudio ? (isLastBoundary ? "[joineda]" : `[aacc${index}]`) : null;
      if (boundary) {
        const transitionName = XFADE_TRANSITION_NAMES[boundary.type] ?? "fade";
        const transitionDuration = boundary.duration;
        const offset = Math.max(0, cutOffsets[index].start);
        filters.push(
          `${videoAcc}[v${index}]xfade=transition=${transitionName}:duration=${formatNumber(transitionDuration)}:offset=${formatNumber(offset)}${nextVideoLabel}`,
        );
        if (hasAudio) {
          filters.push(`${audioAcc}[a${index}]acrossfade=d=${formatNumber(transitionDuration)}${nextAudioLabel}`);
        }
      } else {
        if (hasAudio) {
          filters.push(`${videoAcc}${audioAcc}[v${index}][a${index}]concat=n=2:v=1:a=1${nextVideoLabel}${nextAudioLabel}`);
        } else {
          filters.push(`${videoAcc}[v${index}]concat=n=2:v=1:a=0${nextVideoLabel}`);
        }
      }
      videoAcc = nextVideoLabel;
      if (hasAudio) audioAcc = nextAudioLabel;
    }
  }
  if (!hasAudio) {
    filters.push(`[1:a]atrim=duration=${formatNumber(duration)},asetpts=PTS-STARTPTS[joineda]`);
  }

  const scaledLabel = chromaKey || look ? "[scaled]" : "[outv]";
  filters.push(transformCuts
    ? `[joinedv]null${scaledLabel}`
    : `[joinedv]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${formatNumber(fps)},setsar=1${scaledLabel}`);

  // docs/contract-2026-07-22-render-basics.md #2 (source.chroma_key). Applied post-scale/pad so a
  // single insertion point covers both chroma key and LUT; the background is either a solid color
  // (built inline via ffmpeg's `color` source filter — no extra -i needed) or an image/video file
  // (an extra input, looped if a still image).
  const extraInputArgs = [];
  let nextInputIndex = hasAudio ? 1 : 2;
  let videoLabel = scaledLabel;
  if (chromaKey) {
    const color = isNonEmptyString(chromaKey.color) ? chromaKey.color : "0x00FF00";
    const similarity = isFiniteNumber(chromaKey.similarity) ? chromaKey.similarity : 0.2;
    const blend = isFiniteNumber(chromaKey.blend) ? chromaKey.blend : 0.1;
    const background = chromaKey.background;
    let backgroundLabel;
    if (!isNonEmptyString(background) || isColorLike(background)) {
      // ffmpeg's `color` source filter defaults to 25fps regardless of the project's output.fps;
      // without an explicit r=, overlay silently adopted that mismatched rate for the whole
      // output (verified empirically: omitting r= here produced a 25fps file when output.fps
      // was 10). Force it to match so background and keyed foreground share one frame rate.
      const bgColor = isNonEmptyString(background) ? background : "0x000000";
      filters.push(`color=c=${bgColor}:s=${width}x${height}:r=${formatNumber(fps)}:d=${formatNumber(duration)}[bgsrc]`);
      backgroundLabel = "[bgsrc]";
    } else {
      const backgroundPath = resolve(projectRoot, background);
      const isImage = /\.(png|jpe?g|webp|bmp|gif)$/iu.test(backgroundPath);
      extraInputArgs.push(...(isImage ? ["-loop", "1", "-i", backgroundPath] : ["-i", backgroundPath]));
      backgroundLabel = `[${nextInputIndex}:v]`;
      nextInputIndex += 1;
    }
    filters.push(`${videoLabel}format=yuva420p,chromakey=color=${color}:similarity=${formatNumber(similarity)}:blend=${formatNumber(blend)}[keyed]`);
    // fps= here too: an image/video-file background (the `else` branch above) may carry its own
    // differing frame rate, which the same mismatch would otherwise leak through as well.
    filters.push(`${backgroundLabel}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${formatNumber(fps)},setsar=1[bgscaled]`);
    const chromaOutLabel = look ? "[chromakeyed]" : "[outv]";
    filters.push(`[bgscaled][keyed]overlay=shortest=1:format=auto${chromaOutLabel}`);
    videoLabel = chromaOutLabel;
  }

  // docs/contract-2026-07-22-render-basics.md #4 (output.look). intensity blends between the
  // untouched frame and the fully graded one via ffmpeg's blend filter (0 = no-op, 1 = full LUT).
  if (look) {
    const lutPath = resolveLutPath(projectRoot, look.lut);
    const intensity = isFiniteNumber(look.intensity) ? Math.max(0, Math.min(1, look.intensity)) : 1;
    if (intensity <= 0) {
      filters.push(`${videoLabel}null[outv]`);
    } else if (intensity >= 1) {
      filters.push(`${videoLabel}lut3d=file='${escapeFilterPath(lutPath)}':interp=trilinear[outv]`);
    } else {
      filters.push(`${videoLabel}split=2[lutbase][luttop]`);
      filters.push(`[luttop]lut3d=file='${escapeFilterPath(lutPath)}':interp=trilinear[lutapplied]`);
      // blend's inputs are [0]=top [1]=bottom, and all_opacity weights the TOP input (verified
      // empirically: opacity=0.25 with [red][blue] produced ~75% blue, i.e. output =
      // top*opacity + bottom*(1-opacity)). We want intensity=1 -> fully graded, intensity=0 ->
      // untouched, so the graded frame ([lutapplied]) must be the top (first) input.
      filters.push(`[lutapplied][lutbase]blend=all_mode=normal:all_opacity=${formatNumber(intensity)}[outv]`);
    }
  } else if (videoLabel !== "[outv]") {
    filters.push(`${videoLabel}null[outv]`);
  }

  return {
    command: ffmpegCommand,
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      sourcePath,
      ...(!hasAudio ? ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"] : []),
      ...extraInputArgs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[outv]",
      "-map",
      "[joineda]",
      ...(videoEncodeArgs ?? ["-c:v", "libx264", "-profile:v", "high"]),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-shortest",
      cutPath,
    ],
  };
}

export function buildMultiSourceCutCommand({
  sourceInputs,
  cutPath,
  cuts,
  width,
  height,
  fps,
  ffmpegCommand = resolveFfmpeg(),
  projectRoot,
  look,
  videoEncodeArgs = null,
}) {
  const inputsById = new Map(sourceInputs.map((source, index) => [source.id, { ...source, inputIndex: index }]));
  const filters = [];
  const concatInputs = [];
  const transformCuts = hasCutVisualTransform(cuts);

  for (const [index, cut] of cuts.entries()) {
    const source = inputsById.get(cut.src);
    const speed = cutSpeed(cut);
    const ptsExpr = speed === 1 ? "PTS-STARTPTS" : `(PTS-STARTPTS)/${formatNumber(speed)}`;
    if (transformCuts) {
      const trimmedLabel = `[vraw${index}]`;
      filters.push(
        `[${source.inputIndex}:v]trim=start=${formatNumber(cut.in)}:end=${formatNumber(cut.out)},setpts=${ptsExpr}${trimmedLabel}`,
      );
      appendCutVisualTransform({
        filters,
        inputLabel: trimmedLabel,
        outputLabel: `[v${index}]`,
        cut,
        id: `v1_${index}`,
        width,
        height,
        fps,
        duration: segmentDuration(cut),
      });
    } else {
      filters.push(
        `[${source.inputIndex}:v]trim=start=${formatNumber(cut.in)}:end=${formatNumber(cut.out)},setpts=${ptsExpr},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${formatNumber(fps)},setsar=1[v${index}]`,
      );
    }
    concatInputs.push(`[v${index}]`);

    if (source.hasAudio) {
      const atempoSuffix = buildAtempoChain(speed)
        .map((factor) => `,atempo=${formatNumber(factor)}`)
        .join("");
      filters.push(
        `[${source.inputIndex}:a]atrim=start=${formatNumber(cut.in)}:end=${formatNumber(cut.out)},asetpts=PTS-STARTPTS${atempoSuffix},aresample=48000,aformat=channel_layouts=stereo[a${index}]`,
      );
    } else {
      filters.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${formatNumber(segmentDuration(cut))},asetpts=PTS-STARTPTS[a${index}]`,
      );
    }
    concatInputs.push(`[a${index}]`);
  }

  filters.push(`${concatInputs.join("")}concat=n=${cuts.length}:v=1:a=1[joinedv][joineda]`);

  let videoLabel = "[joinedv]";
  if (look) {
    const lutPath = resolveLutPath(projectRoot, look.lut);
    const intensity = isFiniteNumber(look.intensity) ? Math.max(0, Math.min(1, look.intensity)) : 1;
    if (intensity <= 0) {
      filters.push(`${videoLabel}null[outv]`);
    } else if (intensity >= 1) {
      filters.push(`${videoLabel}lut3d=file='${escapeFilterPath(lutPath)}':interp=trilinear[outv]`);
    } else {
      filters.push(`${videoLabel}split=2[lutbase][luttop]`);
      filters.push(`[luttop]lut3d=file='${escapeFilterPath(lutPath)}':interp=trilinear[lutapplied]`);
      filters.push(`[lutapplied][lutbase]blend=all_mode=normal:all_opacity=${formatNumber(intensity)}[outv]`);
    }
  } else {
    filters.push(`${videoLabel}null[outv]`);
  }

  return {
    command: ffmpegCommand,
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      ...sourceInputs.flatMap((source) => ["-i", source.path]),
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[outv]",
      "-map",
      "[joineda]",
      ...(videoEncodeArgs ?? ["-c:v", "libx264", "-profile:v", "high"]),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-shortest",
      cutPath,
    ],
  };
}

function buildGapAwareCutCommand({
  sourcePath,
  cutPath,
  cuts,
  width,
  height,
  fps,
  hasAudio,
  duration,
  ffmpegCommand = resolveFfmpeg(),
  projectRoot,
  look,
  chromaKey,
  videoEncodeArgs = null,
}) {
  const segments = resolveCutSegments(cuts);
  const runs = computeVideoRuns(segments, duration);
  const filters = [];
  const videoLabels = [];
  const transformCuts = hasCutVisualTransform(cuts);
  for (const [index, run] of runs.entries()) {
    const label = `[gv${index}]`;
    if (run.kind === "gap") {
      filters.push(
        `color=c=black:s=${width}x${height}:r=${formatNumber(fps)}:d=${formatNumber(run.outEnd - run.outStart)}${label}`,
      );
    } else {
      const speed = cutSpeed(run.cut);
      const ptsExpr = speed === 1 ? "PTS-STARTPTS" : `(PTS-STARTPTS)/${formatNumber(speed)}`;
      if (transformCuts) {
        const trimmedLabel = `[gvraw${index}]`;
        filters.push(
          `[0:v]trim=start=${formatNumber(run.srcIn)}:end=${formatNumber(run.srcOut)},setpts=${ptsExpr}${trimmedLabel}`,
        );
        appendCutVisualTransform({
          filters,
          inputLabel: trimmedLabel,
          outputLabel: label,
          cut: run.cut,
          id: `gap_${index}`,
          width,
          height,
          fps,
          duration: run.outEnd - run.outStart,
        });
      } else {
        filters.push(
          `[0:v]trim=start=${formatNumber(run.srcIn)}:end=${formatNumber(run.srcOut)},setpts=${ptsExpr}${label}`,
        );
      }
    }
    videoLabels.push(label);
  }
  filters.push(`${videoLabels.join("")}concat=n=${runs.length}:v=1:a=0[joinedv]`);

  if (hasAudio) {
    const audioLabels = [];
    for (const segment of segments) {
      const { index, cut } = segment;
      const speed = cutSpeed(cut);
      const atempoSuffix = buildAtempoChain(speed)
        .map((factor) => `,atempo=${formatNumber(factor)}`)
        .join("");
      filters.push(
        `[0:a]atrim=start=${formatNumber(cut.in)}:end=${formatNumber(cut.out)},asetpts=PTS-STARTPTS${atempoSuffix}[araw${index}]`,
      );
      const delayMs = Math.max(0, Math.round(segment.start * 1000));
      filters.push(`[araw${index}]adelay=${delayMs}:all=1[adelay${index}]`);
      audioLabels.push(`[adelay${index}]`);
    }
    if (audioLabels.length === 1) {
      filters.push(`${audioLabels[0]}apad=whole_dur=${formatNumber(duration)}[joineda]`);
    } else {
      filters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,apad=whole_dur=${formatNumber(duration)}[joineda]`);
    }
  }
  if (!hasAudio) {
    filters.push(`[1:a]atrim=duration=${formatNumber(duration)},asetpts=PTS-STARTPTS[joineda]`);
  }

  const scaledLabel = chromaKey || look ? "[scaled]" : "[outv]";
  filters.push(transformCuts
    ? `[joinedv]null${scaledLabel}`
    : `[joinedv]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${formatNumber(fps)},setsar=1${scaledLabel}`);

  // docs/contract-2026-07-22-render-basics.md #2 (source.chroma_key). Applied post-scale/pad so a
  // single insertion point covers both chroma key and LUT; the background is either a solid color
  // (built inline via ffmpeg's `color` source filter — no extra -i needed) or an image/video file
  // (an extra input, looped if a still image).
  const extraInputArgs = [];
  let nextInputIndex = hasAudio ? 1 : 2;
  let videoLabel = scaledLabel;
  if (chromaKey) {
    const color = isNonEmptyString(chromaKey.color) ? chromaKey.color : "0x00FF00";
    const similarity = isFiniteNumber(chromaKey.similarity) ? chromaKey.similarity : 0.2;
    const blend = isFiniteNumber(chromaKey.blend) ? chromaKey.blend : 0.1;
    const background = chromaKey.background;
    let backgroundLabel;
    if (!isNonEmptyString(background) || isColorLike(background)) {
      // ffmpeg's `color` source filter defaults to 25fps regardless of the project's output.fps;
      // without an explicit r=, overlay silently adopted that mismatched rate for the whole
      // output (verified empirically: omitting r= here produced a 25fps file when output.fps
      // was 10). Force it to match so background and keyed foreground share one frame rate.
      const bgColor = isNonEmptyString(background) ? background : "0x000000";
      filters.push(`color=c=${bgColor}:s=${width}x${height}:r=${formatNumber(fps)}:d=${formatNumber(duration)}[bgsrc]`);
      backgroundLabel = "[bgsrc]";
    } else {
      const backgroundPath = resolve(projectRoot, background);
      const isImage = /\.(png|jpe?g|webp|bmp|gif)$/iu.test(backgroundPath);
      extraInputArgs.push(...(isImage ? ["-loop", "1", "-i", backgroundPath] : ["-i", backgroundPath]));
      backgroundLabel = `[${nextInputIndex}:v]`;
      nextInputIndex += 1;
    }
    filters.push(`${videoLabel}format=yuva420p,chromakey=color=${color}:similarity=${formatNumber(similarity)}:blend=${formatNumber(blend)}[keyed]`);
    // fps= here too: an image/video-file background (the `else` branch above) may carry its own
    // differing frame rate, which the same mismatch would otherwise leak through as well.
    filters.push(`${backgroundLabel}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${formatNumber(fps)},setsar=1[bgscaled]`);
    const chromaOutLabel = look ? "[chromakeyed]" : "[outv]";
    filters.push(`[bgscaled][keyed]overlay=shortest=1:format=auto${chromaOutLabel}`);
    videoLabel = chromaOutLabel;
  }

  // docs/contract-2026-07-22-render-basics.md #4 (output.look). intensity blends between the
  // untouched frame and the fully graded one via ffmpeg's blend filter (0 = no-op, 1 = full LUT).
  if (look) {
    const lutPath = resolveLutPath(projectRoot, look.lut);
    const intensity = isFiniteNumber(look.intensity) ? Math.max(0, Math.min(1, look.intensity)) : 1;
    if (intensity <= 0) {
      filters.push(`${videoLabel}null[outv]`);
    } else if (intensity >= 1) {
      filters.push(`${videoLabel}lut3d=file='${escapeFilterPath(lutPath)}':interp=trilinear[outv]`);
    } else {
      filters.push(`${videoLabel}split=2[lutbase][luttop]`);
      filters.push(`[luttop]lut3d=file='${escapeFilterPath(lutPath)}':interp=trilinear[lutapplied]`);
      // blend's inputs are [0]=top [1]=bottom, and all_opacity weights the TOP input (verified
      // empirically: opacity=0.25 with [red][blue] produced ~75% blue, i.e. output =
      // top*opacity + bottom*(1-opacity)). We want intensity=1 -> fully graded, intensity=0 ->
      // untouched, so the graded frame ([lutapplied]) must be the top (first) input.
      filters.push(`[lutapplied][lutbase]blend=all_mode=normal:all_opacity=${formatNumber(intensity)}[outv]`);
    }
  } else if (videoLabel !== "[outv]") {
    filters.push(`${videoLabel}null[outv]`);
  }

  return {
    command: ffmpegCommand,
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      sourcePath,
      ...(!hasAudio ? ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"] : []),
      ...extraInputArgs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[outv]",
      "-map",
      "[joineda]",
      ...(videoEncodeArgs ?? ["-c:v", "libx264", "-profile:v", "high"]),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-shortest",
      cutPath,
    ],
  };
}

export function predictedDuration(cuts, sourceDuration, version = 0) {
  if (version === 1) {
    return cuts.reduce((sum, cut) => sum + segmentDuration(cut), 0);
  }
  if (Array.isArray(cuts) && cuts.length > 0 && needsGapAwareCutTimeline(cuts)) {
    const segments = resolveCutSegments(cuts);
    return Math.max(0, ...segments.map((segment) => segment.end));
  }
  if (Array.isArray(cuts) && cuts.length > 0) {
    const segmentsTotal = cuts.reduce((sum, cut) => sum + segmentDuration(cut), 0);
    // A transition_out overlaps its own segment's end with the next segment's start, shortening
    // the combined timeline by the overlap (xfade/acrossfade's own duration math — see
    // buildCutCommand). The last cut's transition_out (if any) has no following segment to
    // blend into, so it never actually renders and must not be subtracted here.
    const transitionOverlap = cuts
      .slice(0, -1)
      .reduce((sum, cut) => sum + (isPositiveNumber(cut.transition_out?.duration) ? cut.transition_out.duration : 0), 0);
    return segmentsTotal - transitionOverlap;
  }
  return sourceDuration;
}

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

// docs/contract-2026-07-22-render-basics.md #3: schema enum values map 1:1 onto ffmpeg's xfade
// transition names (dissolve/fadeblack/fadewhite all exist natively — verified via `ffmpeg -filters`).
const XFADE_TRANSITION_NAMES = {
  dissolve: "dissolve",
  "fade-black": "fadeblack",
  "fade-white": "fadewhite",
};

// atempo only accepts factors in [0.5, 2.0]; speeds outside that range are decomposed into a
// chain of filters that multiply out to the requested speed (docs/contract-2026-07-22-render-basics.md
// #1's ffmpeg column: "atempo（>2x/<0.5x の段組み）").
function buildAtempoChain(speed) {
  if (speed === 1) return [];
  const factors = [];
  let remaining = speed;
  while (remaining > 2 + 1e-9) {
    factors.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5 - 1e-9) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(remaining);
  return factors;
}

export function selectDefaultOutput(projectRoot, edit, exists) {
  const configured = typeof edit.name === "string" && edit.name.trim() !== "" ? edit.name : null;
  const namingSource = edit.version === 1 ? edit.sources[0]?.path : edit.source.path;
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

function selectRasterizer(capabilities, hasThreeDimensionalOverlay) {
  if (hasThreeDimensionalOverlay) return "puppeteer-core";
  if (capabilities.hyperframesAvailable) return "hyperframes";
  if (capabilities.puppeteerAvailable && capabilities.chromePath) return "puppeteer-core";
  return "static-screenshot";
}

// The npm .bin shim is not spawnable on Windows, so the plan advertises the same
// node + package-entry invocation that execution uses (see rasterizeAndComposite).
function hyperframesEntry() {
  return fileURLToPath(new URL("../node_modules/hyperframes/bin/hyperframes.mjs", import.meta.url));
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
