import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  computeCutTimelineOffsets,
  computeVideoRuns,
  cutSpeed,
  effectiveTransitionDurations,
  needsGapAwareCutTimeline,
  resolveCutSegments,
  segmentDuration,
} from "./cut-timeline.mjs";
import {
  appendCutLayerStyleVisual,
  appendCutVisualTransform,
  hasCutLayerStyleVisual,
  hasCutVisualTransform,
} from "./cut-transform.mjs";
import { hasCutFraming } from "./cut-framing.mjs";
import { appendFreezeAwareAudioTrim, appendFreezeAwareVideoTrim, hasCutFreeze } from "./cut-freeze.mjs";
import { buildAudioTailPadCommand, buildTailPadCommand, computeContentDurationSeconds } from "./content-duration.mjs";
import { appendCutFxChain, hasCutFx } from "./fx.mjs";
import { resolveEncodingPolicy } from "./encode-preset.mjs";
import { buildLayersCompositeCommand, hasLayers, isImageLayerSource, resolveDecoderForLayer } from "./layers.mjs";
import { resolveLutPath } from "./render-inputs.mjs";
import {
  buildCutTrackCompositeCommand,
  buildTrackBaseCommand,
  resolveCutTrackRanges,
} from "./track-compose.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { buildAtempoChain } from "../../media-bin/src/speech-atempo.mjs";
import { enableWindowExpr } from "./enable-window.mjs";
import { appliedTruePeakDbtp, hasExplicitTruePeakDbtp } from "./audio-qc.mjs";
import {
  buildTelopRasterCommands,
  internalTrackZ,
  readRenderEdit,
  renderItemDeclaration,
  renderItemKind,
} from "./internal-render.mjs";

// docs/contract-2026-07-14-edit-json-v1-audio.md §4: sidechaincompress threshold ~-24dB (linear 0.063), ratio 8, attack 5ms, release 300ms.
const DUCKING_SIDECHAIN_ARGS = "threshold=0.063:ratio=8:attack=5:release=300";
// docs/contract-2026-07-20-edit-json-v1-narration.md §1: gain_db clamp range, shared with bgm/sfx.
const GAIN_DB_MIN = -60;
const GAIN_DB_MAX = 12;
// Cut intermediates favor independent frames: keyint=1 removes x264's expensive temporal search
// while retaining the resolved preset and CRF verbatim. At a fixed CRF, all-intra frames are not
// visually coarser (short A/B renders measure higher SSIM/PSNR); the trade-off is a larger cut.mp4.
// Apply this only to an explicitly resolved libx264 policy. The null legacy path and hardware
// encoders must keep their exact argument arrays.
const CUT_X264_PERFORMANCE_PARAMS = "keyint=1";
const IMPLIED_CAPTION_TRACK_ID = "t-captions-implied";

function tuneCutVideoEncodeArgs(videoEncodeArgs) {
  if (!Array.isArray(videoEncodeArgs)) return videoEncodeArgs;
  const codecIndex = videoEncodeArgs.indexOf("-c:v");
  if (codecIndex < 0 || videoEncodeArgs[codecIndex + 1] !== "libx264") return videoEncodeArgs;
  if (videoEncodeArgs.includes("-x264-params")) return videoEncodeArgs;
  return [...videoEncodeArgs, "-x264-params", CUT_X264_PERFORMANCE_PARAMS];
}
export function buildPlan({
  edit,
  internalEdit,
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
  captureWorkers = 1,
  captureWorkersSource = "auto",
}) {
  const normalizedInternalEdit = internalEdit ?? readRenderEdit(edit, temporaryDirectory).internal;
  if (isPositiveNumber(fpsOverride) && fpsOverride !== edit.output.fps) {
    throw new Error(
      "v2 の出力 fps は宣言が正本です。fps を変えるときは retime（全体再スケール）を通してください。",
    );
  }
  const width = edit.output.width;
  const height = edit.output.height;
  const fps = isPositiveNumber(fpsOverride) ? fpsOverride : edit.output.fps;
  const resolvedEncodingPolicy = encodingPolicy === undefined
    ? resolveEncodingPolicy({ cli: { quality, encoder }, edit, capabilities })
    : encodingPolicy;
  const videoEncodeArgs = resolvedEncodingPolicy?.video_encode_args ?? null;
  const cutVideoEncodeArgs = tuneCutVideoEncodeArgs(videoEncodeArgs);
  const sourceAudioDurationCache = new Map();
  const cutsEndSeconds = predictedDuration(edit.cuts);
  const finalDurationSeconds = computeContentDurationSeconds({
    edit,
    cutsEndSeconds,
    internalEdit: normalizedInternalEdit,
    projectRoot,
    captionOverlays,
    probeAudioDurationSeconds,
    ffprobeCommand: capabilities.ffprobeCommand,
  });
  const temporary = temporaryDirectory;
  const cutPath = join(temporary, "cut.mp4");
  const cutAudioPath = join(temporary, "cut-audio.mp4");
  const tailPaddedPath = join(temporary, "cut-tail-padded.mp4");
  const tailPaddedAudioPath = join(temporary, "cut-audio-tail-padded.mp4");
  const layeredPath = join(temporary, "layered.mp4");
  const overlayMovPath = join(temporary, "overlay.mov");
  const compositePath = join(temporary, "composite.mp4");
  const finalPath = join(temporary, "final.mp4");
  const sheetPath = join(temporary, "overlay-sheet.html");
  const rasterizer = selectRasterizer(capabilities, hasThreeDimensionalOverlay);
  const telopRasterCommands = buildTelopRasterCommands(normalizedInternalEdit, temporary);
  const cut = needsGapAwareCutTimeline(edit.cuts)
    // docs/contract-2026-08-18-v1-render-parity.md §2: cuts[].at / cuts[].track only get a
    // compositing effect when the removed flat default-order path is false (a custom timeline.tracks declaration
    // routes through buildTrackStackPlan below). Under the default order -- which is what a plain
    // UI drag onto an explicit position or a PiP track actually writes -- this is the only dispatch
    // that ever sees the declaration, so it must itself be gap-aware or the declaration silently
    // renders as a same-length concat instead (the exact bug this contract fixes).
      ? buildGapAwareMultiSourceCutCommand({
          sourceInputs: capabilities.sourceInputs,
          cutPath,
          cuts: edit.cuts,
          width,
          height,
          fps,
          duration: cutsEndSeconds,
          ffmpegCommand: capabilities.ffmpegCommand,
          ffprobeCommand: capabilities.ffprobeCommand,
          projectRoot,
          look: edit.output.look,
          videoEncodeArgs: cutVideoEncodeArgs,
          audioDurationCache: sourceAudioDurationCache,
        })
      : buildMultiSourceCutCommand({
          sourceInputs: capabilities.sourceInputs,
          cutPath,
          cuts: edit.cuts,
          width,
          height,
          fps,
          ffmpegCommand: capabilities.ffmpegCommand,
          ffprobeCommand: capabilities.ffprobeCommand,
          projectRoot,
          look: edit.output.look,
          videoEncodeArgs: cutVideoEncodeArgs,
          audioDurationCache: sourceAudioDurationCache,
        });
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
  const tailPadAudio = tailPad
    ? buildAudioTailPadCommand({
        ffmpegCommand: capabilities.ffmpegCommand,
        inputPath: cutAudioPath,
        outputPath: tailPaddedAudioPath,
        finalDurationSeconds,
      })
    : null;
  const cutOutputPath = tailPad ? tailPaddedPath : cutPath;
  // layers[] is additive-only (contract-2026-07-22-prerender-rail-and-assets.md §1.2): an edit.json
  // without it produces no `layers` command and render-cut.mjs skips this stage entirely, so
  // existing projects keep their byte-identical cut.mp4 -> composite pipeline (zero regression).
  const defaultTrackOrder = usesDefaultInternalTrackOrder(normalizedInternalEdit);
  const layers = defaultTrackOrder && hasLayers(edit)
    ? buildLayersCompositeCommand({
        layers: edit.layers,
        projectRoot,
        ffmpegCommand: capabilities.ffmpegCommand,
        ffprobeCommand: capabilities.ffprobeCommand,
        inputPath: cutOutputPath,
        outputPath: layeredPath,
        duration: finalDurationSeconds,
        width,
        height,
        fps,
        videoEncodeArgs,
      })
    : null;
  const trackStack = defaultTrackOrder ? null : buildTrackStackPlan({
        edit,
        internalEdit: normalizedInternalEdit,
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
        captionOverlays,
        audioDurationCache: sourceAudioDurationCache,
      });
  const baseVideoPath = trackStack ? trackStack.outputPath : (layers ? layeredPath : cutOutputPath);

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
      cutAudioPath,
      ...(tailPad ? [tailPaddedPath, tailPaddedAudioPath] : []),
      ...(layers ? [layeredPath] : []),
      ...(trackStack ? trackStack.intermediates : []),
      ...telopRasterCommands.map(command => command.output),
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
      cut_audio: cutAudio,
      telops: telopRasterCommands,
      tail_pad: tailPad,
      tail_pad_audio: tailPadAudio,
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
          workers: captureWorkers,
          workers_source: captureWorkersSource,
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
          fps,
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

/**
 * v2 の正規化済みトラック列が、従来のフラット合成順
 * cuts -> layers -> overlays -> captions -> audio（同種は ref 昇順）かを判定する。
 * edit.json の版や生の timeline 宣言には依存しない。
 */
export function usesDefaultInternalTrackOrder(internalEdit) {
  const rank = new Map([
    ["cuts", 0],
    ["layers", 1],
    ["overlays", 2],
    ["captions", 3],
    ["audio", 4],
  ]);
  // 中身の無い declared visual トラック（段を新設してクリップを移した後の空トラック等）は旧種別が
  // 名目上のものでしかなく、実際の描画には何も寄与しない。並び順判定の対象から外すことで、
  // 空トラックの存在・位置が「既定順かどうか」を左右しないようにする
  // （P0 2026-08-20 track-identity-and-duration）。
  const keys = (internalEdit?.tracks ?? [])
    .filter(track => track?.content !== undefined || (track?.items?.length ?? 0) > 0)
    .map((track, index) => ({
      kind: track?.legacy?.kind,
      ref: Number.isInteger(track?.legacy?.ref) ? track.legacy.ref : -1,
      index,
    }));
  if (keys.some(key => !rank.has(key.kind))) return false;
  // P0 2026-08-21 render-path-unification: source.kind:'media' now always maps to 'cuts'
  // (packages/edit-store/src/internal-model.ts no longer branches on track position), so a
  // project with more than one real visual track (e.g. a base track + a PiP track, both plain
  // media) can legitimately have more than one 'cuts'-kind track today. The flat/default dispatch
  // below feeds every 'cuts'-kind track's items into ONE combined array
  // (buildGapAwareMultiSourceCutCommand's computeVideoRuns), which resolves overlapping tracks by
  // winner-take-all, not alpha compositing (verified: no real fieldtest/ project exercises this,
  // but fieldtest/2026-08-06-pip-perspective-crop-check does have a genuine base+PiP pair that
  // needs real compositing). More than one 'cuts'-kind visual track must always route through
  // buildTrackStackPlan below, which composites each track's own canvas in z-order with a real
  // alpha overlay -- so "default order" only ever holds for at most one 'cuts' track.
  if (keys.filter(key => key.kind === "cuts").length > 1) return false;
  const expected = [...keys].sort((left, right) =>
    rank.get(left.kind) - rank.get(right.kind)
      || left.ref - right.ref
      || left.index - right.index);
  return keys.every((key, index) => key.index === expected[index].index);
}

function buildTrackStackPlan({
  edit,
  internalEdit,
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
  captionOverlays,
  audioDurationCache,
}) {
  const cutVideoEncodeArgs = tuneCutVideoEncodeArgs(videoEncodeArgs);
  const ordered = [];
  let hasDeclaredCaptionTrack = false;
  for (const track of internalEdit.tracks) {
    const orderIndex = internalTrackZ(internalEdit, track);
    if (track.content?.from === "captions.json") {
      hasDeclaredCaptionTrack = true;
      if (captionOverlays.length > 0) {
        ordered.push({ kind: "captions", ref: null, orderIndex, items: captionOverlays });
      }
      continue;
    }
    let current = null;
    for (const item of track.items) {
      const route = renderItemKind(item);
      const kind = route === "cut" ? "cuts"
        : route === "layer" ? "layers"
          : route === "html" ? "overlays" : null;
      if (!kind) continue;
      if (!current || current.kind !== kind) {
        current = {
          kind,
          ref: track.legacy.ref ?? null,
          orderIndex,
          items: [],
          sequence: ordered.length,
        };
        ordered.push(current);
      }
      current.items.push(renderItemDeclaration(item, temporary));
    }
  }

  // Keep export stacking identical to the timeline/preview display-only completion rule: when
  // captions.json has renderable cues but tracks[] has no captions declaration, synthesize the
  // same implied lane at the top. An explicit captions track remains authoritative at its declared
  // position, including positions below opaque visual tracks.
  if (!hasDeclaredCaptionTrack && captionOverlays.length > 0) {
    ordered.push({
      kind: "captions",
      ref: null,
      orderIndex: internalEdit.tracks.length,
      items: captionOverlays,
      impliedTrackId: IMPLIED_CAPTION_TRACK_ID,
    });
  }

  // task 2026-08-07-track-transition-lint-guard (edit-lint's cuts.track-transition-unsupported
  // check is the primary guard; this is the defensive backstop for direct render-cut invocations
  // that skip lint). See that check's comment in edit-lint.mjs for the full rationale: gap-aware
  // track compositing (this function) is built on resolveCutSegments/computeVideoRuns, which
  // treat same-track adjacent cuts as separate non-overlapping windows and so cannot represent an
  // xfade's intentional overlap -- verified with a real render to silently show the base track's
  // background leaking through partway into what should still be the dissolved clip.
  for (const track of ordered) {
      if (track.kind !== "cuts") continue;
      for (const cut of track.items.slice(0, -1)) {
        if (!cut.transition_out) continue;
        throw new Error(
          `cuts[].transition_out is declared on track ${track.ref}, which timeline.tracks composites through `
            + "the gap-aware track engine. That engine treats adjacent same-track cuts as separate, "
            + "non-overlapping windows, so it cannot represent an xfade's intentional overlap -- the composited "
            + "window and the actually-shrunk clip diverge, and content disappears early. Remove transition_out "
            + "from this track's cuts, or drop the custom timeline.tracks order for this track so it renders "
            + "through the plain sequential path instead.",
        );
      }
  }

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
    const stageBase = {
      kind: track.kind,
      ref: track.ref,
      orderIndex: track.orderIndex,
      stageIndex,
      inputPath: previousPath,
      outputPath,
      ...(track.impliedTrackId ? { trackId: track.impliedTrackId } : {}),
    };
    if (track.kind === "cuts") {
      const duplicateCutGroup = ordered.filter(candidate => candidate.kind === "cuts"
        && candidate.ref === track.ref && candidate.orderIndex === track.orderIndex).length > 1;
      // .mov, not .mp4: this track's own canvas needs an alpha channel to composite correctly
      // onto whatever is below it (transparentBackground: true below), and qtrle -- the alpha-
      // capable intermediate codec that survives the round trip -- wants a MOV-family container.
      const trackPath = join(
        temporary,
        `cut-track-${track.ref}-${track.orderIndex}${duplicateCutGroup ? `-${stageIndex}` : ""}.mov`,
      );
      const command = buildMultiSourceCutCommand({
            sourceInputs: capabilities.sourceInputs,
            cutPath: trackPath,
            cuts: track.items,
            width,
            height,
            fps,
            ffmpegCommand: capabilities.ffmpegCommand,
            ffprobeCommand: capabilities.ffprobeCommand,
            projectRoot,
            look: edit.output.look,
            videoEncodeArgs: cutVideoEncodeArgs,
            audioDurationCache,
            // This track's own canvas is about to be overlaid onto `previous` below
            // (buildCutTrackCompositeCommand) -- it needs to stay see-through wherever an item
            // does not cover the full frame. `previous` (or basePath for the first stage) is
            // always itself opaque, so a fractional opacity still fades toward whatever is below
            // exactly like the flat/default dispatch fades toward black (verified: this is the
            // same math with "below" generalized from hardcoded black to the real stack).
            // Left unconditionally true (byte-identical to before r4) -- see canvasBasisTransform
            // just below for the stageIndex-0 fix this comment used to describe here. Keeping
            // transparentBackground itself untouched matters for a reason UNRELATED to alpha
            // compositing: buildMultiSourceCommandResult also reads it to choose this stage's own
            // intermediate codec (qtrle, lossless, vs. the requested quality preset) specifically
            // to avoid an AVOIDABLE extra generation of lossy compression before this stage's
            // output gets decoded and recomposited again by whatever stage sits above it in the
            // stack (verified: real-master-render-encoding-boundaries.test.mjs's own "identical
            // encoding policy at every boundary" assertion -- stageIndex 0 still has stages above
            // it whenever the stack has more than one, so it benefits from staying lossless the
            // same as every other stage, independent of whether ITS OWN canvas happens to need
            // alpha for compositing purposes).
            transparentBackground: true,
            // P0 2026-08-21 render-path-unification (r4 fix, Codex re-review): a SEPARATE signal
            // from transparentBackground, scoped to ONLY the canvas-fit-vs-native-basis transform
            // question inside appendCutVisualTransform (cut-transform.mjs) -- see that function's
            // own comment for the full rationale (r3). transparentBackground alone was the wrong
            // proxy for "is this stage genuinely the bottom of the whole composite, with nothing
            // real below it": buildTrackStackPlan passed transparentBackground: true unconditionally
            // to every cuts-kind stage including stageIndex 0, which meant (a) moving an item from
            // an upper stage down to the true bottom didn't switch its transform.scale back to
            // canvas-basis the way the flat/default (no-stack) dispatch does for the identical
            // declaration, and (b) merely adding a second, non-overlapping-in-time 'cuts' track
            // flipped an EXISTING bottom-stage transform/opacity clip's own rendered geometry with
            // zero change to its own declaration (the "adding a PiP track changed my main content's
            // zoom" shape Codex's r3 re-review flagged as still reachable). stageIndex 0's `previous`
            // is always basePath, which buildTrackBaseCommand (track-compose.mjs) renders as a plain
            // `color=c=black` canvas with cutPath's own visual content fully discarded -- so
            // stageIndex 0 is the one stage that is genuinely "the bottom, nothing real below it",
            // exactly like the flat/default dispatch. Every stage above it has a REAL prior stage's
            // content as `previous` and keeps canvasBasisTransform: false (native-basis), unchanged
            // from r3.
            canvasBasisTransform: stageIndex === 0,
          });
      cutTracks.push({ ref: track.ref, path: trackPath, command });
      stages.push({
        ...stageBase,
        command: buildCutTrackCompositeCommand({
          ffmpegCommand: capabilities.ffmpegCommand,
          inputPath: previousPath,
          trackPath,
          outputPath,
          ranges: resolveCutTrackRanges(track.items),
          duration,
          fps,
          videoEncodeArgs,
        }),
      });
    } else if (track.kind === "layers") {
      stages.push({
        ...stageBase,
        command: buildLayersCompositeCommand({
          layers: track.items,
          projectRoot,
          ffmpegCommand: capabilities.ffmpegCommand,
          ffprobeCommand: capabilities.ffprobeCommand,
          inputPath: previousPath,
          outputPath,
          duration,
          width,
          height,
          fps,
          videoEncodeArgs,
        }),
      });
    } else {
      stages.push({
        ...stageBase,
        command: null,
        overlayIds: track.items.map(item => String(item.id)),
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
      ...stages.map(stage => stage.outputPath),
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
        `[${inputIndex}:a]${track.trimFilter}volume=${formatNumber(track.gain_db)}dB,adelay=${delay}:all=1[${rawLabel}]`,
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
    filters.push(
      `[${inputIndex}:a]${trim.trimFilter}volume=${formatNumber(sfx.gain_db ?? 0)}dB${fadeSuffix},adelay=${delay}:all=1[sfx${index}]`,
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
    tracks.push({ id, path: resolvedPath, t, gain_db, trimFilter: trim.trimFilter });
  }
  return { tracks, warnings };
}

function resolveNarrationTrim(item, actualDuration, id) {
  const hasIn = item.in !== undefined;
  const hasOut = item.out !== undefined;
  if (!hasIn && !hasOut) return { skip: false, trimFilter: "", warnings: [] };

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
    return { skip: true, trimFilter: "", warnings };
  }
  return {
    skip: false,
    trimFilter: `atrim=start=${formatNumber(inSeconds)}:end=${formatNumber(outSeconds)},asetpts=PTS-STARTPTS,`,
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

export function buildAnimatedCompositeArgs({
  cutPath,
  overlayPath,
  outputPath,
  hasAudio = true,
  videoEncodeArgs = null,
}) {
  return [
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
    "[0:v][1:v]overlay=0:0:format=auto:shortest=1[composited];[composited]scale=out_range=tv[outv]",
    "-map",
    "[outv]",
    ...(hasAudio ? ["-map", "0:a:0"] : []),
    ...(videoEncodeArgs ?? ["-c:v", "libx264", "-profile:v", "high", "-color_range", "tv"]),
    "-pix_fmt",
    "yuv420p",
    ...(hasAudio ? ["-c:a", "copy"] : ["-an"]),
    outputPath,
  ];
}

function buildAnimatedCompositeCommand(command, cutPath, overlayPath, outputPath, videoEncodeArgs = null) {
  return {
    command,
    args: buildAnimatedCompositeArgs({ cutPath, overlayPath, outputPath, videoEncodeArgs }),
  };
}

function buildStaticCompositeCommand(command, cutPath, outputPath, temporary, overlays, duration, fps, videoEncodeArgs = null) {
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", cutPath];
  const filters = [];
  let previous = "[0:v]";
  for (const [index, overlay] of overlays.entries()) {
    const png = join(temporary, `static-${String(index + 1).padStart(4, "0")}.png`);
    args.push("-loop", "1", "-i", png);
    const next = `[overlay${index}]`;
    filters.push(
      `${previous}[${index + 1}:v]overlay=0:0:format=auto:enable='${enableWindowExpr(overlay.start, overlay.start + overlay.duration, fps)}'${next}`,
    );
    previous = next;
  }
  filters.push(`${previous}scale=out_range=tv[outv]`);
  args.push(
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
// real duration (an extra ffprobe call) when in/out or fade_in/fade_out is actually present on
// this item -- the fully-bare path (the vast majority of existing sfx) returns immediately with
// no trim filter and no known effectiveDuration, keeping its output byte-identical to pre-R6b.
// effectiveDuration (the [in,out) window's own length, once knowable) is what audio-clip-fades'
// resolveSfxFadeSeconds clamps fade_in/fade_out against -- null means "not knowable without a
// probe that didn't happen" and the caller skips fade application rather than guessing.
function resolveSfxTrim(sfx, ffprobeCommand, resolvedPath, index) {
  const hasIn = sfx.in !== undefined;
  const hasOut = sfx.out !== undefined;
  const hasFade = sfx.fade_in !== undefined || sfx.fade_out !== undefined;
  if (!hasIn && !hasOut && !hasFade) {
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
  const effectiveDuration = outSeconds === null ? null : outSeconds - inSeconds;
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

export function buildMultiSourceCutCommand({
  sourceInputs,
  cutPath,
  cuts,
  width,
  height,
  fps,
  ffmpegCommand = resolveFfmpeg(),
  ffprobeCommand = resolveFfprobe(),
  projectRoot,
  look,
  videoEncodeArgs = null,
  // P0 2026-08-21 render-path-unification: true only for a buildTrackStackPlan stage that
  // overlays this track's own canvas onto real content below it. Every pre-existing caller
  // (the flat/default dispatch) omits this, keeping the opaque background byte-identical to
  // before this task -- see cut-transform.mjs's appendCutVisualTransform for why an
  // unconditionally transparent background would silently break fractional opacity there.
  transparentBackground = false,
  // P0 2026-08-21 render-path-unification (r4 fix, Codex re-review): whether transform.scale in
  // appendCutVisualTransform uses canvas-fit basis (true, the r1/main-content convention) or
  // native-source basis (false, the PiP-overlay convention) -- see that function's own comment.
  // Defaults true (every pre-existing caller: the flat/default dispatch, and any direct
  // unit-test caller). buildTrackStackPlan (plan.mjs) is the only caller that ever passes false,
  // and only for stages above stageIndex 0 -- deliberately independent of transparentBackground
  // (see that call site's own comment for why the two questions don't share one flag).
  canvasBasisTransform = true,
  audioDurationCache = new Map(),
}) {
  const inputsById = new Map(sourceInputs.map((source, index) => [source.id, { ...source, inputIndex: index }]));
  const filters = [];
  const extraInputArgs = [];
  const concatInputs = [];
  // P0 2026-08-21 render-path-unification: a cuts[] item can now sit on any track, including one
  // that used to be layers-only, so a VP9/VP8 alpha-side-channel source (previously only reachable
  // through layers.mjs) can now arrive here too. Reuse the same ffprobe-based decoder selection so
  // the cuts pipeline doesn't silently composite such a source as opaque -- see layers.mjs's
  // SIDE_CHANNEL_ALPHA_DECODERS comment for the underlying ffmpeg decoder gap this works around.
  const warnings = [];
  const transformCuts = hasCutVisualTransform(cuts) || hasCutFraming(cuts);
  // docs/contract-2026-08-05-fx-v0.md (cuts[].fx). v1's per-cut branch is already always
  // full-WxH-framed (both the transform and plain branches below produce a complete frame), so
  // fx only needs one extra hop after whichever branch ran — no change to the branch selection.
  const fxCuts = hasCutFx(cuts);
  // docs/contract-2026-07-22-render-basics.md #3 (cuts[].transition_out), extended to the v1
  // (multi-source) path by task 2026-08-07-v1-transition-out. Same residual decision as
  // the removed single-source path: only boundaries that explicitly declare transition_out take the xfade path,
  // so a v1 project with zero transition_out keeps today's exact single
  // concat=n=${cuts.length} call byte-for-byte (verified in verify-fps-tolerance.test.mjs's
  // sibling suite v1-transition-out.test.mjs, "no transition_out keeps the exact legacy call").
  const hasAnyTransition = cuts.slice(0, -1).some((cut) => cut.transition_out);

  for (const [index, cut] of cuts.entries()) {
    const source = inputsById.get(cut.src);
    const speed = cutSpeed(cut);
    // Unlike the removed single-source path (which only ever scales/paces once, after concat), v1 always scales
    // + fps-resamples per cut (sources[] entries can have different native size/rate). That
    // per-cut fps= filter -- and appendCutVisualTransform's own internal fps= filter, in the
    // transformCuts branch -- resets whatever timebase an earlier settb=AVTB had set (verified
    // empirically: baking settb=AVTB into the trim's own postSuffixFilter, ahead of fps=, still
    // left concat's own output on a different timebase than a sibling xfade input and ffmpeg
    // refused to join them). So every branch below writes into `preConcatLabel` first, and
    // settb=AVTB -- when a transition is present -- is applied as one unconditional LAST step
    // onto `[v${index}]` (the label concat/xfade actually consume), after fx/transform/scale/fps
    // have all already run.
    const preRangeLabel = `[vrange${index}]`;
    const preConcatLabel = hasAnyTransition ? `[vpre${index}]` : `[v${index}]`;
    const chromaKey = cut.chroma_key ?? source.chromaKey;
    const chromaInputLabel = chromaKey ? `[vchromain${index}]` : preRangeLabel;
    const shapedLabel = fxCuts ? `[vshaped1_${index}]` : chromaInputLabel;
    if (transformCuts) {
      const trimmedLabel = `[vraw${index}]`;
      appendFreezeAwareVideoTrim({
        filters,
        inputLabel: `[${source.inputIndex}:v]`,
        outputLabel: trimmedLabel,
        sourceIn: cut.in,
        sourceOut: cut.out,
        speed,
        freeze: cut.freeze,
        id: `v1_${index}`,
        fps,
      });
      if (hasCutLayerStyleVisual(cut)) {
        appendCutLayerStyleVisual({
          filters,
          inputLabel: trimmedLabel,
          outputLabel: shapedLabel,
          cut,
          id: `v1_${index}`,
          width,
          height,
          fps,
          duration: segmentDuration(cut),
          sourceWidth: source.width,
          sourceHeight: source.height,
          transparentBackground,
        });
      } else {
        appendCutVisualTransform({
          filters,
          inputLabel: trimmedLabel,
          outputLabel: shapedLabel,
          cut,
          id: `v1_${index}`,
          width,
          height,
          fps,
          duration: segmentDuration(cut),
          transparentBackground,
          canvasBasisTransform,
        });
      }
    } else {
      appendFreezeAwareVideoTrim({
        filters,
        inputLabel: `[${source.inputIndex}:v]`,
        outputLabel: shapedLabel,
        sourceIn: cut.in,
        sourceOut: cut.out,
        speed,
        freeze: cut.freeze,
        id: `v1_${index}`,
        fps,
        postSuffixFilter: `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${formatNumber(fps)},setsar=1`,
      });
    }
    if (fxCuts) {
      appendCutFxChain({
        filters,
        inputLabel: shapedLabel,
        outputLabel: chromaInputLabel,
        fx: cut.fx,
        id: `v1_${index}`,
        width,
        height,
        fps,
        duration: segmentDuration(cut),
      });
    }
    if (chromaKey) {
      appendMultiSourceChromaKey({
        filters,
        extraInputArgs,
        inputLabel: chromaInputLabel,
        outputLabel: preRangeLabel,
        key: chromaKey,
        id: index,
        width,
        height,
        fps,
        duration: segmentDuration(cut),
        projectRoot,
        firstExtraInputIndex: sourceInputs.length,
      });
    }
    filters.push(`${preRangeLabel}scale=out_range=tv${preConcatLabel}`);
    if (hasAnyTransition) {
      filters.push(`${preConcatLabel}settb=AVTB[v${index}]`);
    }
    concatInputs.push(`[v${index}]`);

    appendMultiSourceCutAudioFilter({
      filters, warnings, cut, source, index, ffprobeCommand, audioDurationCache,
    });
    concatInputs.push(`[a${index}]`);
  }

  if (!hasAnyTransition) {
    filters.push(`${concatInputs.join("")}concat=n=${cuts.length}:v=1:a=1[joinedv][joineda]`);
  } else {
    // v1's per-cut audio label always exists (real audio or anullsrc-generated silence above),
    // unlike the removed single-source path's single hasAudio flag for the whole source -- so this join never
    // needs the removed single-source path's "no audio at all" fallback branch.
    const cutOffsets = computeCutTimelineOffsets(cuts);
    // MAJOR-3 fix (Codex review, see cut-timeline.mjs's effectiveTransitionDurations): use the
    // same possibly-clamped-to-actual-overlap duration cutOffsets itself was built from, not the
    // raw declared cuts[index-1].transition_out.duration -- xfade/acrossfade must be told exactly
    // how much overlap really exists, or the filter graph and the timeline math it was placed
    // against (cutOffsets) would silently disagree again the same way the routing decision used to.
    const transitionDurations = effectiveTransitionDurations(cuts);
    let videoAcc = "[v0]";
    let audioAcc = "[a0]";
    for (let index = 1; index < cuts.length; index += 1) {
      const boundary = cuts[index - 1].transition_out;
      const isLastBoundary = index === cuts.length - 1;
      const nextVideoLabel = isLastBoundary ? "[joinedv]" : `[vacc${index}]`;
      const nextAudioLabel = isLastBoundary ? "[joineda]" : `[aacc${index}]`;
      if (boundary) {
        const transitionName = XFADE_TRANSITION_NAMES[boundary.type] ?? "fade";
        const transitionDuration = transitionDurations[index - 1];
        const offset = Math.max(0, cutOffsets[index].start);
        filters.push(
          `${videoAcc}[v${index}]xfade=transition=${transitionName}:duration=${formatNumber(transitionDuration)}:offset=${formatNumber(offset)}${nextVideoLabel}`,
        );
        filters.push(`${audioAcc}[a${index}]acrossfade=d=${formatNumber(transitionDuration)}${nextAudioLabel}`);
      } else {
        filters.push(`${videoAcc}${audioAcc}[v${index}][a${index}]concat=n=2:v=1:a=1${nextVideoLabel}${nextAudioLabel}`);
      }
      videoAcc = nextVideoLabel;
      audioAcc = nextAudioLabel;
    }
  }

  appendMultiSourceLookFilters(filters, "[joinedv]", { look, projectRoot, alreadyNormalized: true });

  return buildMultiSourceCommandResult({
    ffmpegCommand, ffprobeCommand, sourceInputs, extraInputArgs, filters, videoEncodeArgs, cutPath,
    fps, transparentBackground, warnings,
  });
}

export function buildMultiSourceAudioCutCommand({
  sourceInputs,
  cutPath,
  cuts,
  ffmpegCommand = resolveFfmpeg(),
  ffprobeCommand = resolveFfprobe(),
  audioDurationCache = new Map(),
}) {
  const inputsById = new Map(sourceInputs.map((source, index) => [source.id, { ...source, inputIndex: index }]));
  const filters = [];
  const warnings = [];
  const audioLabels = [];
  const hasAnyTransition = cuts.slice(0, -1).some((cut) => cut.transition_out);

  for (const [index, cut] of cuts.entries()) {
    const source = inputsById.get(cut.src);
    appendMultiSourceCutAudioFilter({
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
    ffmpegCommand, sourceInputs, filters, cutPath, warnings,
  });
}

function appendMultiSourceCutAudioFilter({
  filters, warnings, cut, source, index, ffprobeCommand, audioDurationCache,
}) {
  const speed = cutSpeed(cut);
  if (source.hasAudio) {
    appendAudioEndPaddingWarning({ warnings, cut, source, index, ffprobeCommand, audioDurationCache });
    const atempoSuffix = buildAtempoChain(speed)
      .map((factor) => `,atempo=${formatNumber(factor)}`)
      .join("");
    appendFreezeAwareAudioTrim({
      filters,
      inputLabel: `[${source.inputIndex}:a]`,
      outputLabel: `[a${index}]`,
      sourceIn: cut.in,
      sourceOut: cut.out,
      speed,
      atempoSuffix,
      freeze: cut.freeze,
      id: `v1_${index}`,
      normalize: true,
      padToSeconds: segmentDuration(cut),
    });
  } else {
    filters.push(
      `anullsrc=r=48000:cl=stereo,atrim=duration=${formatNumber(segmentDuration(cut))},asetpts=PTS-STARTPTS[a${index}]`,
    );
  }
}

function appendMultiSourceChromaKey({
  filters, extraInputArgs, inputLabel, outputLabel, key, id, width, height, fps, duration,
  projectRoot, firstExtraInputIndex,
}) {
  const color = isNonEmptyString(key.color) ? key.color : "0x00FF00";
  const similarity = isFiniteNumber(key.similarity) ? key.similarity : 0.2;
  const blend = isFiniteNumber(key.blend) ? key.blend : 0.1;
  const keyed = `[vkeyed${id}]`;
  const background = key.background;
  let backgroundLabel;
  if (!isNonEmptyString(background) || isColorLike(background)) {
    const bgColor = isNonEmptyString(background) ? background : "0x000000";
    backgroundLabel = `[vkeybg${id}]`;
    filters.push(
      `color=c=${bgColor}:s=${width}x${height}:r=${formatNumber(fps)}:d=${formatNumber(duration)}${backgroundLabel}`,
    );
  } else {
    const backgroundPath = resolve(projectRoot, background);
    const inputIndex = firstExtraInputIndex + extraInputArgs.filter(value => value === "-i").length;
    extraInputArgs.push(...(isImageLayerSource(backgroundPath) ? ["-loop", "1"] : []), "-i", backgroundPath);
    backgroundLabel = `[${inputIndex}:v]`;
  }
  const scaledBackground = `[vkeybgscaled${id}]`;
  filters.push(
    `${inputLabel}format=yuva420p,chromakey=color=${color}:similarity=${formatNumber(similarity)}:blend=${formatNumber(blend)}${keyed}`,
  );
  filters.push(
    `${backgroundLabel}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${formatNumber(fps)},setsar=1${scaledBackground}`,
  );
  filters.push(`${scaledBackground}${keyed}overlay=shortest=1:format=auto${outputLabel}`);
}

// docs/contract-2026-08-18-v1-render-parity.md §2: shared tail for both v1 cut-command builders
// (the plain concat path above and buildGapAwareMultiSourceCutCommand below) -- identical LUT/look
// blend + tv-range clamp logic, factored out once instead of duplicated a second time.
function appendMultiSourceLookFilters(filters, videoLabel, { look, projectRoot, alreadyNormalized }) {
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
    filters.push("[outv]scale=out_range=tv[outv_tv]");
  } else {
    // Every multi-source cut was normalized to tv before concat. Applying scale=out_range=tv
    // again here compresses full-range input twice, so the no-look path only renames the label.
    filters.push(alreadyNormalized
      ? `${videoLabel}null[outv_tv]`
      : `${videoLabel}scale=out_range=tv[outv_tv]`);
  }
}

function buildMultiSourceCommandResult({
  ffmpegCommand, ffprobeCommand, sourceInputs, extraInputArgs = [], filters, videoEncodeArgs, cutPath,
  fps, transparentBackground = false, warnings = [],
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
      // docs/contract-2026-08-12-still-image-cut-source-v0.md 裁定2: same `-loop 1` recipe as
      // the removed single-source path, applied per-source here since v1 mixes video and still-image sources.
      // image2 loop inputs otherwise default to 25fps, leaving trim boundaries on the wrong frame grid.
      // P0 2026-08-21 render-path-unification: a VP9/VP8 alpha-side-channel source needs an
      // explicit libvpx decoder or its alpha plane silently comes back opaque (layers.mjs's
      // resolveDecoderForLayer / SIDE_CHANNEL_ALPHA_DECODERS) -- reused here now that cuts[] items
      // can carry the same alpha-carrying sources layers[] items always could.
      ...sourceInputs.flatMap((source) => [
        ...(ffprobeCommand ? resolveDecoderForLayer(ffprobeCommand, source.path, warnings) : []),
        ...(isImageLayerSource(source.path)
          ? ["-framerate", formatNumber(fps), "-loop", "1", "-i", source.path]
          : ["-i", source.path]),
      ]),
      ...extraInputArgs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[outv_tv]",
      "-map",
      "[joineda]",
      // P0 2026-08-21 render-path-unification: an alpha channel built up inside filter_complex
      // (transparentBackground) is worthless if the intermediate file itself can't carry it --
      // libx264/yuv420p have no alpha plane, so every bit of it would be silently discarded the
      // instant this file hits disk, and buildCutTrackCompositeCommand's later overlay of that
      // now-fully-opaque file would paint over whatever was supposed to show through (verified:
      // this was exactly why the first version of this change still failed real-pixel tests).
      // qtrle (a lossless, alpha-capable intra codec long supported by ffmpeg) keeps it intact
      // through the round trip -- verified empirically (packages/render-cut/test/*, report.md).
      // videoEncodeArgs is ignored in this branch: this is a decode-again intermediate, never the
      // final delivered artifact, so quality/size tuning is moot and codec choice is what matters.
      ...(transparentBackground ? ["-c:v", "qtrle"] : (videoEncodeArgs ?? ["-c:v", "libx264", "-profile:v", "high", "-color_range", "tv"])),
      ...(transparentBackground ? [] : ["-pix_fmt", "yuv420p"]),
      "-c:a",
      "aac",
      "-ar",
      "48000",
      cutPath,
    ],
  };
}

function buildMultiSourceAudioCommandResult({
  ffmpegCommand, sourceInputs, filters, cutPath, warnings = [],
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
      ...sourceInputs.flatMap((source) => ["-i", source.path]),
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[joineda]",
      "-vn",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      cutPath,
    ],
  };
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
export function buildGapAwareMultiSourceCutCommand({
  sourceInputs,
  cutPath,
  cuts,
  width,
  height,
  fps,
  duration,
  ffmpegCommand = resolveFfmpeg(),
  ffprobeCommand = resolveFfprobe(),
  projectRoot,
  look,
  videoEncodeArgs = null,
  // See buildMultiSourceCutCommand's own comment. Every pre-existing caller omits this.
  transparentBackground = false,
  // See buildMultiSourceCutCommand's own comment. This function is only ever reached from the
  // flat/default (non-stack) dispatch (see plan.mjs's buildPlan) -- never as a buildTrackStackPlan
  // stage -- so canvasBasisTransform is always its true default in practice; threaded through for
  // API symmetry with buildMultiSourceCutCommand and any direct unit-test caller.
  canvasBasisTransform = true,
  audioDurationCache = new Map(),
}) {
  // See buildMultiSourceCutCommand's own comment on the same line.
  const warnings = [];
  // Same restriction as v0's the removed single-source path dispatch (see its own comment): computeVideoRuns maps
  // output time back to source time with a single linear speed factor per run, which cannot represent
  // a freeze hold's non-linear pause. Reject loudly rather than silently render the wrong frames.
  if (hasCutFreeze(cuts)) {
    throw new Error(
      "cuts[].freeze is not supported together with a gap-aware cut timeline (explicit at/track placement) in "
        + "v1 (sources[]) either -- same restriction as v0 (docs/contract-2026-07-22-render-basics.md #7). Remove "
        + "freeze from this cut, or drop its at/track placement so the whole cuts[] array renders through the "
        + "default sequential path instead.",
    );
  }

  const inputsById = new Map(sourceInputs.map((source, index) => [source.id, { ...source, inputIndex: index }]));
  const segments = resolveCutSegments(cuts);
  const runs = computeVideoRuns(segments, duration);
  const filters = [];
  const videoLabels = [];
  const transformCuts = hasCutVisualTransform(cuts) || hasCutFraming(cuts);
  const fxCuts = hasCutFx(cuts);

  for (const [index, run] of runs.entries()) {
    const label = `[gv1_${index}]`;
    if (run.kind === "gap") {
      // P0 2026-08-21 render-path-unification: transparent, not opaque black, only when the
      // caller actually needs alpha (transparentBackground -- this track overlays onto real
      // content below it) AND the other segments in this same concat are already alpha-carrying
      // (transformCuts -- concat requires every input to share one pixel format). Every
      // pre-existing caller passes transparentBackground=false, so this stays byte-identical
      // opaque black exactly as before this task.
      filters.push(
        transformCuts && transparentBackground
          ? `color=c=black@0:s=${width}x${height}:r=${formatNumber(fps)}:d=${formatNumber(run.outEnd - run.outStart)},format=yuva420p${label}`
          : `color=c=black:s=${width}x${height}:r=${formatNumber(fps)}:d=${formatNumber(run.outEnd - run.outStart)}${label}`,
      );
    } else {
      const cut = run.cut;
      const source = inputsById.get(cut.src);
      const speed = cutSpeed(cut);
      const ptsExpr = speed === 1 ? "PTS-STARTPTS" : `(PTS-STARTPTS)/${formatNumber(speed)}`;
      const rawLabel = `[gv1raw${index}]`;
      const shapedLabel = fxCuts ? `[gv1shaped${index}]` : label;
      filters.push(
        `[${source.inputIndex}:v]trim=start=${formatNumber(run.srcIn)}:end=${formatNumber(run.srcOut)},setpts=${ptsExpr}${rawLabel}`,
      );
      if (transformCuts) {
        if (hasCutLayerStyleVisual(cut)) {
          appendCutLayerStyleVisual({
            filters,
            inputLabel: rawLabel,
            outputLabel: shapedLabel,
            cut,
            id: `gap1_${index}`,
            width,
            height,
            fps,
            duration: run.outEnd - run.outStart,
            sourceWidth: source.width,
            sourceHeight: source.height,
            transparentBackground,
          });
        } else {
          appendCutVisualTransform({
            filters,
            inputLabel: rawLabel,
            outputLabel: shapedLabel,
            cut,
            id: `gap1_${index}`,
            width,
            height,
            fps,
            duration: run.outEnd - run.outStart,
            transparentBackground,
            canvasBasisTransform,
          });
        }
      } else {
        filters.push(
          `${rawLabel}scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${formatNumber(fps)},setsar=1${shapedLabel}`,
        );
      }
      if (fxCuts) {
        appendCutFxChain({
          filters,
          inputLabel: shapedLabel,
          outputLabel: label,
          fx: cut.fx,
          id: `gap1_${index}`,
          width,
          height,
          fps,
          duration: run.outEnd - run.outStart,
        });
      }
    }
    videoLabels.push(label);
  }
  filters.push(`${videoLabels.join("")}concat=n=${runs.length}:v=1:a=0[joinedv]`);

  appendGapAwareAudioFilters({
    filters, warnings, segments, inputsById, duration, ffprobeCommand, audioDurationCache,
  });

  appendMultiSourceLookFilters(filters, "[joinedv]", { look, projectRoot, alreadyNormalized: false });

  return buildMultiSourceCommandResult({
    ffmpegCommand, ffprobeCommand, sourceInputs, filters, videoEncodeArgs, cutPath, fps,
    transparentBackground, warnings,
  });
}

export function buildGapAwareMultiSourceAudioCutCommand({
  sourceInputs,
  cutPath,
  cuts,
  duration,
  ffmpegCommand = resolveFfmpeg(),
  ffprobeCommand = resolveFfprobe(),
  audioDurationCache = new Map(),
}) {
  if (hasCutFreeze(cuts)) {
    throw new Error(
      "cuts[].freeze is not supported together with a gap-aware cut timeline (explicit at/track placement) in "
        + "v1 (sources[]) either -- same restriction as v0 (docs/contract-2026-07-22-render-basics.md #7). Remove "
        + "freeze from this cut, or drop its at/track placement so the whole cuts[] array renders through the "
        + "default sequential path instead.",
    );
  }
  const inputsById = new Map(sourceInputs.map((source, index) => [source.id, { ...source, inputIndex: index }]));
  const filters = [];
  const warnings = [];
  appendGapAwareAudioFilters({
    filters,
    warnings,
    segments: resolveCutSegments(cuts),
    inputsById,
    duration,
    ffprobeCommand,
    audioDurationCache,
  });
  return buildMultiSourceAudioCommandResult({
    ffmpegCommand, sourceInputs, filters, cutPath, warnings,
  });
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

export function predictedDuration(cuts) {
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

// docs/contract-2026-07-22-render-basics.md #3: schema enum values map 1:1 onto ffmpeg's xfade
// transition names (dissolve/fadeblack/fadewhite all exist natively — verified via `ffmpeg -filters`).
const XFADE_TRANSITION_NAMES = {
  dissolve: "dissolve",
  fade: "fade",
  "fade-black": "fadeblack",
  "fade-white": "fadewhite",
  "fade-grays": "fadegrays",
  "wipe-left": "wipeleft",
  "wipe-right": "wiperight",
  "wipe-up": "wipeup",
  "wipe-down": "wipedown",
  radial: "radial",
  "slide-left": "slideleft",
  "slide-right": "slideright",
  "slide-up": "slideup",
  "slide-down": "slidedown",
  "cover-left": "coverleft",
  "cover-right": "coverright",
  "cover-up": "coverup",
  "cover-down": "coverdown",
  "reveal-left": "revealleft",
  "reveal-right": "revealright",
  // reveal-down / reveal-up: 前カットが丸ごとその方向へ動いて画面外へ抜け、空いた側から
  // 次カットが現れる（前カットは動きながら画面端でクロップされる）。ディゾルブのように
  // 混ざらないので、同じ構図が続くトークシーンでも「場面が入れ替わった」ことが読める。
  // 2026-08-14 追加（テンプレの基本トランジションとしてオーナー指定）。
  "reveal-down": "revealdown",
  "reveal-up": "revealup",
  "circle-open": "circleopen",
  "circle-close": "circleclose",
  "zoom-in": "zoomin",
  "squeeze-h": "squeezeh",
  "squeeze-v": "squeezev",
  blur: "hblur",
  pixelize: "pixelize",
};

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

function formatSeconds(value) {
  return formatNumber(Number(Number(value).toFixed(6)));
}
