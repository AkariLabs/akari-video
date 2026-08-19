import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants as fsConstants, createReadStream, existsSync } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateCaptionOverlays, generateResolvedCaptionOverlays } from "./captions.mjs";
import { deriveContactSheetTimestamps, renderContactSheet } from "./contact-sheet.mjs";
import {
  ENCODER_CHOICES,
  QUALITY_LEVELS,
  resolveEncodingPolicy,
} from "./encode-preset.mjs";
import { buildPlan, selectDefaultOutput } from "./plan.mjs";
import { isImageLayerSource } from "./layers.mjs";
import {
  captureStaticOverlays,
  captureWithPuppeteer,
  compositeAnimatedOverlay,
  compositeStaticOverlays,
  probeHasAlpha,
  renderOverlaySheet,
  runChecked,
  runCheckedWithProgress,
} from "./rasterize.mjs";
import { renderReport } from "./report.mjs";
import { enumerateDeclaredRenderInputs, hashDeclaredRenderInputs } from "./render-inputs.mjs";
import { createImmutableRenderReceipt, prepareContainedReportDirectory } from "./render-receipt.mjs";
import { buildAudioQc, measurementErrorAudioQc, AUDIO_QC_CAPTURE_LIMIT_BYTES } from "./audio-qc.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { resolveCanonicalCaptionFontAsset } from "./caption-font.mjs";
import {
  projectRendererCompatibilityEdit,
  readRenderEdit,
} from "./internal-render.mjs";

const VERSION = 1;
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRequire = createRequire(import.meta.url);
const { resolveCaptionDisplay } = packageRequire("../../edit-store/lib/index.js");
// A stale run directory belongs to a process that crashed/was killed without cleaning up after
// itself. 24h gives ample time for a same-day retry/inspection before we reclaim the space, while
// never touching a directory an active concurrent run still owns (see createRunTemporaryDirectory).
const STALE_RUN_DIRECTORY_MS = 24 * 60 * 60 * 1000;
const USAGE = `Usage: render-cut <project-root> [--plan-only] [--out <path>] [--force]
  [--quality master|high|standard|light] [--encoder auto|videotoolbox|x264]
  [--fps <number>] [--progress]

Omitting --quality/--encoder/--fps/--progress reproduces the exact ffmpeg command lines from
before this flag set existed. --quality/--encoder default to today's plain libx264 encode only
when explicitly passed as (or defaulted to) "standard"/"x264"; --fps defaults to edit.json's
output.fps; --progress emits "PROGRESS out_time_ms=<n> total_ms=<n>" lines to stdout while
encoding, followed by "PROGRESS done total_ms=<n>".

Exit codes: 0 verified pass (or plan complete), 1 refusal/verify fail, 2 execution error`;

export class RefusalError extends Error {}
export class ExecutionError extends Error {}

export async function runCli(argv, io = console) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    io.error(error.message);
    io.error(USAGE);
    return 2;
  }
  if (options.help) {
    io.log(USAGE);
    return 0;
  }

  try {
    const state = await renderProject(options.projectRoot, options, io);
    for (const warning of state.warnings ?? []) {
      io.error(`render-cut warning: ${warning}`);
    }
    if (options.planOnly) {
      io.log(`PLAN: ${state.plan.output} (${state.plan.predicted_duration_seconds}s)`);
      return 0;
    }
    io.log(`${state.verify.verdict.toUpperCase()}: ${state.plan.output}`);
    return state.verify.verdict === "pass" ? 0 : 1;
  } catch (error) {
    if (error instanceof RefusalError) {
      io.error(`render-cut refused: ${error.message}`);
      return 1;
    }
    io.error(`render-cut execution error: ${messageOf(error)}`);
    return 2;
  }
}

export async function renderProject(input, options = {}, io = console) {
  const projectRoot = resolve(input);
  const editPath = join(projectRoot, "edit.json");
  const editText = await readRequired(editPath, "edit.json");
  const parsedEdit = parseJson(editText, "edit.json");
  const renderTmpRoot = join(projectRoot, ".akari", "render-tmp");
  const renderRead = readRenderEdit(editText, renderTmpRoot);
  let edit = renderRead.edit;
  const internalEdit = renderRead.internal;
  validateEditShape(edit);

  const lint = await validateLint(projectRoot, options.force === true);
  const capabilities = await measureCapabilities(projectRoot, edit);
  const encodingPolicy = resolveEncodingPolicy({
    cli: { quality: options.quality, encoder: options.encoder },
    edit,
    capabilities,
  });
  const plannedCaptions = await loadCaptions(projectRoot, edit);
  // Caption HTML embeds this exact canonical file URL. Resolve the binding once only when an
  // overlay will actually be rasterized, then hand the same binding to the receipt enumerator.
  const captionFontAsset = plannedCaptions.overlays.length > 0
    ? resolveCanonicalCaptionFontAsset()
    : null;
  const declaredInputs = await enumerateDeclaredRenderInputs({
    projectRoot, edit, editText, captionFontAsset, internalEdit,
  });
  const inputSnapshot = await hashDeclaredRenderInputs(declaredInputs, { useConsumedText: true });
  const inputs = Object.fromEntries(
    inputSnapshot.map((input) => [input.path, {
      sha256: input.sha256,
      bytes: input.bytes,
    }]),
  );
  const captionOverlays = plannedCaptions.overlays;
  const captionLayout = plannedCaptions.layout
    ? await persistCaptionLayout(projectRoot, plannedCaptions.layout, capabilities)
    : null;
  const loadedOverlays = await loadOverlays(projectRoot, edit);
  const hasThreeDimensionalOverlay = loadedOverlays.some((overlay) =>
    overlay.html.includes("data-akari-3d-scene"),
  );
  const explicitOutput = options.out ? resolveOutput(projectRoot, options.out) : null;
  const outputPath = explicitOutput ?? selectDefaultOutput(projectRoot, edit, existsSync);
  ensureOutputDoesNotReplaceInput(projectRoot, edit, outputPath);

  // Concurrency isolation (render-tmp-isolation の設計に基づく): a plan-only
  // preview never touches disk, so it keeps using the flat, deterministic render-tmp path (stable
  // across repeated --plan-only calls). An actual render claims its own uniquely-named
  // subdirectory so two processes racing on the same project never clobber each other's
  // intermediates; only the owning process ever writes into it.
  const temporaryDirectory = options.planOnly
    ? renderTmpRoot
    : await createRunTemporaryDirectory(renderTmpRoot);
  edit = projectRendererCompatibilityEdit(parsedEdit, internalEdit, temporaryDirectory);

  const plan = buildPlan({
    edit,
    internalEdit,
    sourceVersion: parsedEdit.version,
    projectRoot,
    outputPath,
    capabilities,
    hasSourceAudio: capabilities.sourceHasAudio,
    renderOverlays: [...edit.overlays, ...captionOverlays],
    captionOverlays,
    hasThreeDimensionalOverlay,
    temporaryDirectory,
    quality: options.quality,
    encoder: options.encoder,
    encodingPolicy,
    fpsOverride: options.fps,
  });
  const state = {
    version: VERSION,
    phase: "planned",
    inputs,
    // State warnings grow throughout execution. Keep them detached from the immutable command
    // plan so a post-verify warning cannot change the plan hash after the receipt is written.
    warnings: [...(plan.commands.audio_mix.warnings ?? [])],
    validation: {
      lint,
      environment: {
        node: capabilities.nodeVersion,
        ffmpeg: capabilities.ffmpegVersion,
        ffprobe: capabilities.ffprobeVersion,
        chrome: capabilities.chromeVersion,
        hyperframes: capabilities.hyperframesVersion,
        puppeteer_core: capabilities.puppeteerVersion,
      },
    },
    plan,
    provenance: {
      ...(edit.version === 0
        ? {
            source: relativeOrAbsolute(projectRoot, resolve(projectRoot, edit.source.path)),
            source_pix_fmt: capabilities.sourcePixFmt,
            source_color_range: capabilities.sourceColorRange,
          }
        : {
            sources: capabilities.sourceInputs.map((source) => ({
              id: source.id,
              path: relativeOrAbsolute(projectRoot, source.path),
              duration_seconds: source.duration,
              has_audio: source.hasAudio,
              width: source.width,
              height: source.height,
              fps: source.fps,
              pix_fmt: source.pixFmt,
              color_range: source.colorRange,
            })),
          }),
      proxy_used: false,
      render_tmp_dir: relativeOrAbsolute(projectRoot, temporaryDirectory),
      rasterizer: { planned: plan.rasterizer.selected, adopted: null, attempts: [] },
      environment: {
        node: capabilities.nodeVersion,
        ffmpeg: capabilities.ffmpegVersion,
        ffprobe: capabilities.ffprobeVersion,
        chrome: capabilities.chromeVersion,
        hyperframes: capabilities.hyperframesVersion,
        puppeteer_core: capabilities.puppeteerVersion,
      },
    },
    artifacts: [],
    verify: null,
    ...(captionLayout ? { caption_layout: captionLayout } : {}),
  };
  for (const warning of plannedCaptions.warnings) addWarning(state, warning);

  const statePath = join(projectRoot, ".akari", "render.json");
  const reportPath = join(projectRoot, ".akari", "reports", "render-report.html");
  await writeState(state, statePath, reportPath, projectRoot);
  if (options.planOnly) return state;

  // --progress (task 2026-07-25-export-options): "cut" always runs; "composite" only exists when
  // there is overlay/caption HTML to rasterize onto the base video (mirrors the allOverlays.length
  // check below, decided before entering the try block since both loadedOverlays and
  // captionOverlays are already resolved here). Each phase is weighted equally by the timeline's
  // own predicted duration (both phases fully re-encode ~the same duration), so progress is
  // monotonic even though neither phase's real wall-clock cost is known ahead of time.
  const progressEnabled = options.progress === true;
  const progressPhases = loadedOverlays.length + captionOverlays.length > 0 ? ["cut", "composite"] : ["cut"];
  const progressPhaseDurationMs = Math.max(0, Math.round(plan.predicted_duration_seconds * 1000));
  const progressTotalMs = progressPhases.length * progressPhaseDurationMs;
  const emitProgress = (phaseName, elapsedSeconds) => {
    if (!progressEnabled) return;
    const phaseIndex = progressPhases.indexOf(phaseName);
    if (phaseIndex === -1) return;
    const clampedMs = Math.min(progressPhaseDurationMs, Math.max(0, Math.round(elapsedSeconds * 1000)));
    io.log(`PROGRESS out_time_ms=${phaseIndex * progressPhaseDurationMs + clampedMs} total_ms=${progressTotalMs}`);
  };

  try {
    for (const command of plan.commands.telops ?? []) {
      runChecked(command.command, command.args, { cwd: projectRoot });
    }
    const cutPath = join(temporaryDirectory, "cut.mp4");
    const cutCommand = plan.commands.cut;
    if (progressEnabled) {
      await runCheckedWithProgress(capabilities.ffmpegCommand, cutCommand.args, {
        cwd: projectRoot,
        onProgress: (seconds) => emitProgress("cut", seconds),
      });
    } else {
      runChecked(capabilities.ffmpegCommand, cutCommand.args, { cwd: projectRoot });
    }

    const tailPadCommand = plan.commands.tail_pad;
    const tailPaddedPath = join(temporaryDirectory, "cut-tail-padded.mp4");
    if (tailPadCommand) {
      runChecked(tailPadCommand.command, tailPadCommand.args, { cwd: projectRoot });
    }

    const trackStack = plan.commands.track_stack;
    const overlays = loadedOverlays;
    const captions = captionOverlays;
    const allOverlays = [...overlays, ...captions];
    if (trackStack) {
      runChecked(trackStack.base.command, trackStack.base.args, { cwd: projectRoot });
      for (const track of trackStack.cutTracks) {
        runChecked(track.command.command, track.command.args, { cwd: projectRoot });
      }
      for (const stage of trackStack.stages) {
        if (stage.command) {
          for (const warning of stage.command.warnings ?? []) addWarning(state, warning);
          runChecked(stage.command.command, stage.command.args, { cwd: projectRoot });
          continue;
        }
        const ids = new Set(stage.overlayIds);
        const stageOverlays = (stage.kind === "captions" ? captions : overlays)
          .filter(overlay => ids.has(String(overlay.id)));
        if (stageOverlays.length === 0) {
          await copyFile(stage.inputPath, stage.outputPath);
          continue;
        }
        const stageTemporaryDirectory = join(
          temporaryDirectory,
          `track-overlay-${stage.orderIndex}-${stage.stageIndex}`,
        );
        await mkdir(stageTemporaryDirectory, { recursive: true });
        await rasterizeAndComposite({
          state,
          allOverlays: stageOverlays,
          edit,
          projectRoot,
          temporaryDirectory: stageTemporaryDirectory,
          cutPath: stage.inputPath,
          compositePath: stage.outputPath,
          capabilities,
          duration: plan.predicted_duration_seconds,
          // Keep one rasterizer contract for the whole render. If any declared overlay is 3D,
          // every split track stage stays on puppeteer-core just like the legacy single sheet.
          hasThreeDimensionalOverlay,
          fps: plan.preset.fps,
          videoEncodeArgs: encodingPolicy?.video_encode_args ?? null,
        });
      }
    }

    // layers[] (contract-2026-07-22-prerender-rail-and-assets.md §1.2) composites onto the
    // cuts-joined base before overlays/captions are rasterized on top. plan.commands.layers is
    // null whenever edit.layers is absent/empty, so a layers-less edit.json never runs this
    // command and always feeds the original cut.mp4 onward unchanged (byte-identical output).
    const layersCommand = plan.commands.layers;
    const layeredPath = join(temporaryDirectory, "layered.mp4");
    if (layersCommand) {
      // A layer whose declared alpha cannot be decoded composites as an opaque rectangle over the
      // base video. That used to happen silently; surface it as a warning next to the render.
      for (const warning of layersCommand.warnings ?? []) addWarning(state, warning);
      runChecked(layersCommand.command, layersCommand.args, { cwd: projectRoot });
    }
    const cutOutputPath = tailPadCommand ? tailPaddedPath : cutPath;
    const baseVideoPath = trackStack?.outputPath ?? (layersCommand ? layeredPath : cutOutputPath);

    const compositePath = join(temporaryDirectory, "composite.mp4");
    if (trackStack) {
      await copyFile(trackStack.outputPath, compositePath);
      if (allOverlays.length === 0) {
        state.provenance.rasterizer.adopted = "skip";
        state.provenance.rasterizer.attempts.push({
          method: "skip",
          status: "adopted",
          reason: "no overlay HTML or captions.json",
        });
      }
      emitProgress("composite", plan.predicted_duration_seconds);
    } else if (allOverlays.length === 0) {
      await copyFile(baseVideoPath, compositePath);
      state.provenance.rasterizer.adopted = "skip";
      state.provenance.rasterizer.attempts.push({
        method: "skip",
        status: "adopted",
        reason: "no overlay HTML or captions.json",
      });
    } else {
      await rasterizeAndComposite({
        state,
        allOverlays,
        edit,
        projectRoot,
        temporaryDirectory,
        cutPath: baseVideoPath,
        compositePath,
        capabilities,
        duration: plan.predicted_duration_seconds,
        hasThreeDimensionalOverlay,
        fps: plan.preset.fps,
        videoEncodeArgs: encodingPolicy?.video_encode_args ?? null,
        onProgress: progressEnabled ? (seconds) => emitProgress("composite", seconds) : undefined,
      });
    }

    const finalPath = join(temporaryDirectory, "final.mp4");
    const audioExecution = await executeAudioPlan(plan.commands.audio_mix);
    const audioMaster = edit.audio?.master && typeof edit.audio.master === "object" ? edit.audio.master : null;
    if (audioMaster && audioExecution.error) {
      state.audio_qc = measurementErrorAudioQc({
        master: audioMaster,
        phase: "filter_report",
        code: audioExecution.error.code,
        message: audioExecution.error.message,
        toolVersion: capabilities.ffmpegVersion,
      });
      const failedArtifactPath = await persistFailedRenderArtifact(projectRoot, compositePath);
      const failedVerification = verifyArtifact({
        outputPath: failedArtifactPath,
        plan,
        ffprobeCommand: capabilities.ffprobeCommand,
        ffmpegCommand: capabilities.ffmpegCommand,
      });
      state.artifacts = [{
        path: relativeOrAbsolute(projectRoot, failedArtifactPath),
        sha256: await sha256File(failedArtifactPath),
        ffprobe: failedVerification.measured,
      }];
      if (failedVerification.verdict === "pass") {
        const receipt = await createImmutableRenderReceipt({
          projectRoot,
          declaredInputs,
          inputSnapshot,
          outputPath: failedArtifactPath,
          ffprobe: failedVerification.measured,
          plan,
          verify: failedVerification,
          tools: {
            node: capabilities.nodeVersion,
            ffmpeg: capabilities.ffmpegVersion,
            ffprobe: capabilities.ffprobeVersion,
          },
          captionLayout,
          audioQc: state.audio_qc,
          createdAt: options.receiptCreatedAt,
        });
        state.render_receipt = { path: receipt.path, sha256: receipt.sha256 };
      }
      throw new RefusalError("audio QC filter report measurement failed");
    }

    await mkdir(dirname(outputPath), { recursive: true });
    if (explicitOutput) {
      await rm(outputPath, { force: true });
      await rename(finalPath, outputPath);
    } else {
      await copyFile(finalPath, outputPath, fsConstants.COPYFILE_EXCL);
      await rm(finalPath, { force: true });
    }
    state.phase = "rendered";
    if (audioMaster) {
      state.audio_qc = buildAudioQc({
        master: audioMaster,
        filterStderr: audioExecution.stderr,
        outputPath,
        ffmpegCommand: capabilities.ffmpegCommand,
        toolVersion: capabilities.ffmpegVersion,
      });
      if (state.audio_qc.verdict === "INCONCLUSIVE") {
        addWarning(state, "audio_qc is INCONCLUSIVE and requires human acceptance review");
      }
    }
    const verification = verifyArtifact({
      outputPath,
      plan,
      ffprobeCommand: capabilities.ffprobeCommand,
      ffmpegCommand: capabilities.ffmpegCommand,
    });
    state.verify = verification;
    state.artifacts = [
      {
        path: relativeOrAbsolute(projectRoot, outputPath),
        sha256: await sha256File(outputPath),
        ffprobe: verification.measured,
      },
    ];
    state.phase = "verified";
    if (verification.verdict === "pass") {
      const contactSheetTimestamps = deriveContactSheetTimestamps({
        cuts: edit.cuts,
        overlays: allOverlays,
        durationSeconds: plan.predicted_duration_seconds,
        fps: plan.preset.fps,
      });
      const contactSheetPath = join(projectRoot, ".akari", "reports", "contact-sheet.png");
      await mkdir(dirname(contactSheetPath), { recursive: true });
      const generatedContactSheet = await renderContactSheet({
        ffmpegCommand: capabilities.ffmpegCommand,
        videoPath: outputPath,
        timestamps: contactSheetTimestamps,
        temporaryDirectory,
        outputPath: contactSheetPath,
      });
      if (generatedContactSheet) {
        state.contact_sheet = {
          path: relativeOrAbsolute(projectRoot, contactSheetPath),
          timestamps_seconds: contactSheetTimestamps,
        };
      }
    }
    if (verification.verdict === "pass") {
      const receipt = await createImmutableRenderReceipt({
        projectRoot,
        declaredInputs,
        inputSnapshot,
        outputPath,
        ffprobe: verification.measured,
        plan,
        verify: verification,
        tools: {
          node: capabilities.nodeVersion,
          ffmpeg: capabilities.ffmpegVersion,
          ffprobe: capabilities.ffprobeVersion,
        },
        captionLayout,
        audioQc: state.audio_qc ?? null,
        createdAt: options.receiptCreatedAt,
      });
      state.render_receipt = {
        path: receipt.path,
        sha256: receipt.sha256,
      };
    }
    if (verification.verdict === "pass") {
      await appendRenderedSourceToEdit({ editPath, outputPath, projectRoot, state });
    }
    if (state.audio_qc?.verdict === "MEASUREMENT_ERROR") {
      throw new RefusalError("audio QC decoded artifact measurement failed");
    }
    await writeState(state, statePath, reportPath, projectRoot);
    if (verification.verdict === "pass") {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
    if (progressEnabled) io.log(`PROGRESS done total_ms=${progressTotalMs}`);
    return state;
  } catch (error) {
    state.phase = "error";
    state.verify = {
      verdict: "fail",
      findings: [{ severity: "error", check: "render.execution", message: messageOf(error) }],
      measured: null,
    };
    await writeState(state, statePath, reportPath, projectRoot);
    throw error;
  }
}

export function parseArguments(argv) {
  const options = {
    projectRoot: null,
    planOnly: false,
    out: null,
    force: false,
    help: false,
    // Left undefined (not null) unless the corresponding flag is actually present in argv: buildPlan
    // treats "flag absent" and "flag present with its default value" differently (see
    // src/encode-preset.mjs) so that omitting every new flag reproduces today's exact ffmpeg
    // command lines (task 2026-07-25-export-options's backward-compat requirement).
    quality: undefined,
    encoder: undefined,
    fps: undefined,
    progress: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--plan-only") options.planOnly = true;
    else if (argument === "--force") options.force = true;
    else if (argument === "--progress") options.progress = true;
    else if (argument === "--out") {
      if (index + 1 >= argv.length) throw new Error("--out requires a path");
      options.out = argv[++index];
    } else if (argument.startsWith("--out=")) options.out = argument.slice(6);
    else if (argument === "--quality") {
      if (index + 1 >= argv.length) throw new Error("--quality requires a value");
      options.quality = parseQualityValue(argv[++index]);
    } else if (argument.startsWith("--quality=")) options.quality = parseQualityValue(argument.slice(10));
    else if (argument === "--encoder") {
      if (index + 1 >= argv.length) throw new Error("--encoder requires a value");
      options.encoder = parseEncoderValue(argv[++index]);
    } else if (argument.startsWith("--encoder=")) options.encoder = parseEncoderValue(argument.slice(10));
    else if (argument === "--fps") {
      if (index + 1 >= argv.length) throw new Error("--fps requires a number");
      options.fps = parseFpsValue(argv[++index]);
    } else if (argument.startsWith("--fps=")) options.fps = parseFpsValue(argument.slice(6));
    else if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    else if (options.projectRoot === null) options.projectRoot = argument;
    else throw new Error("Only one project root may be provided");
  }
  if (!options.help && options.projectRoot === null) throw new Error("A project root is required");
  return options;
}

function parseQualityValue(value) {
  if (!QUALITY_LEVELS.includes(value)) {
    throw new Error(`--quality must be one of ${QUALITY_LEVELS.join("|")}, got: ${value}`);
  }
  return value;
}

function parseEncoderValue(value) {
  if (!ENCODER_CHOICES.includes(value)) {
    throw new Error(`--encoder must be one of ${ENCODER_CHOICES.join("|")}, got: ${value}`);
  }
  return value;
}

function parseFpsValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--fps must be a positive number, got: ${value}`);
  }
  return parsed;
}

async function validateLint(projectRoot, force) {
  const lintPath = join(projectRoot, ".akari", "lint.json");
  let lint = null;
  try {
    lint = parseJson(await readFile(lintPath, "utf8"), ".akari/lint.json");
  } catch (error) {
    if (error?.code !== "ENOENT") throw new ExecutionError(messageOf(error));
  }
  const verdict = lint?.verdict ?? "missing";
  if (verdict !== "pass" && !force) {
    throw new RefusalError(".akari/lint.json is missing or not PASS; run edit-lint first (or use --force with explicit approval)");
  }
  return {
    verdict,
    sha256: lint ? sha256(JSON.stringify(lint)) : null,
    override: verdict === "pass" ? null : { used: true, option: "--force", original_verdict: verdict },
  };
}

async function measureCapabilities(projectRoot, edit) {
  const ffmpegCommand = process.env.FFMPEG ?? resolveFfmpeg();
  const ffprobeCommand = process.env.FFPROBE ?? resolveFfprobe();
  const ffmpegVersion = commandVersion(ffmpegCommand, ["-version"]);
  const ffprobeVersion = commandVersion(ffprobeCommand, ["-version"]);
  const chromePath = await findChromePath();
  const chromeVersion = chromePath ? commandVersion(chromePath, ["--version"]) : null;
  if (!chromePath) throw new ExecutionError("system Chrome was not found");
  if (edit.version === 0) {
    const sourcePath = resolve(projectRoot, edit.source.path);
    const sourceProbe = probeMedia(ffprobeCommand, sourcePath);
    const sourceVideo = sourceProbe.streams.find((stream) => stream.codec_type === "video");
    // docs/contract-2026-08-12-still-image-cut-source-v0.md: ffprobe never reports format.duration
    // for a bare still image (verified empirically, with or without -loop), so the positive-
    // duration requirement below is meaningless for one and must not throw. sourceDuration stays
    // null; plan.mjs's own guard rejects the one case that would actually need it (v0 + still
    // image + empty cuts[], the "whole source" shortcut a duration-less image cannot satisfy).
    const sourceIsStillImage = isImageLayerSource(edit.source.path);
    const sourceDuration = sourceIsStillImage ? null : Number(sourceProbe.format?.duration);
    if (!sourceIsStillImage && (!Number.isFinite(sourceDuration) || sourceDuration <= 0)) {
      throw new ExecutionError("ffprobe did not report a positive source duration");
    }
    const hyperframesPath = join(PACKAGE_ROOT, "node_modules", "hyperframes", "bin", "hyperframes.mjs");
    const hyperframesPackagePath = join(PACKAGE_ROOT, "node_modules", "hyperframes", "package.json");
    const puppeteerPath = resolvePuppeteerPackagePath();
    return {
      ffmpegCommand,
      ffprobeCommand,
      ffmpegVersion,
      ffprobeVersion,
      nodeVersion: process.version,
      chromePath,
      chromeVersion,
      hyperframesPath,
      hyperframesAvailable: await isReadable(hyperframesPath),
      hyperframesVersion: await readPackageVersion(hyperframesPackagePath),
      puppeteerAvailable: puppeteerPath !== null,
      puppeteerVersion: puppeteerPath ? await readPackageVersion(puppeteerPath) : null,
      sourceDuration,
      sourceHasAudio: sourceProbe.streams.some((stream) => stream.codec_type === "audio"),
      sourcePixFmt: sourceVideo?.pix_fmt ?? null,
      sourceColorRange: sourceVideo?.color_range ?? null,
    };
  }

  const hyperframesPath = join(PACKAGE_ROOT, "node_modules", "hyperframes", "bin", "hyperframes.mjs");
  const hyperframesPackagePath = join(PACKAGE_ROOT, "node_modules", "hyperframes", "package.json");
  const puppeteerPath = resolvePuppeteerPackagePath();
  const shared = {
    ffmpegCommand,
    ffprobeCommand,
    ffmpegVersion,
    ffprobeVersion,
    nodeVersion: process.version,
    chromePath,
    chromeVersion,
    hyperframesPath,
    hyperframesAvailable: await isReadable(hyperframesPath),
    hyperframesVersion: await readPackageVersion(hyperframesPackagePath),
    puppeteerAvailable: puppeteerPath !== null,
    puppeteerVersion: puppeteerPath ? await readPackageVersion(puppeteerPath) : null,
  };
  const sourceInputs = usedSources(edit).map((source) => {
    const path = resolve(projectRoot, source.path);
    const probe = probeMedia(ffprobeCommand, path);
    const video = probe.streams.find((stream) => stream.codec_type === "video");
    // docs/contract-2026-08-12-still-image-cut-source-v0.md: same still-image duration exemption
    // as the v0 branch above, per source.
    const isStillImage = isImageLayerSource(source.path);
    const duration = isStillImage ? null : Number(probe.format?.duration ?? video?.duration);
    if (!isStillImage && (!Number.isFinite(duration) || duration <= 0)) {
      throw new ExecutionError(`ffprobe did not report a positive source duration for ${source.id}`);
    }
    return {
      id: source.id,
      path,
      duration,
      hasAudio: probe.streams.some((stream) => stream.codec_type === "audio"),
      width: video?.width ?? null,
      height: video?.height ?? null,
      fps: parseRate(video?.avg_frame_rate ?? video?.r_frame_rate),
      pixFmt: video?.pix_fmt ?? null,
      colorRange: video?.color_range ?? null,
    };
  });
  return { ...shared, sourceInputs };
}

async function collectInputReceipts(projectRoot, edit, editText) {
  const files = new Map([["edit.json", { path: join(projectRoot, "edit.json"), text: editText }]]);
  if (edit.version === 0) {
    addReference(files, projectRoot, "source", edit.source.path);
  } else {
    for (const source of usedSources(edit)) {
      addReference(files, projectRoot, `source:${source.id}`, source.path);
    }
  }
  for (const [index, overlay] of edit.overlays.entries()) {
    addReference(files, projectRoot, `overlay:${index}`, overlay.html);
  }
  const captionsPath = join(projectRoot, "captions.json");
  if (await isRegularFile(captionsPath)) files.set("captions.json", { path: captionsPath });
  const bgm = audioPath(edit.audio?.bgm);
  if (bgm) addReference(files, projectRoot, "audio:bgm", bgm);
  for (const [index, sfx] of (edit.audio?.sfx ?? []).entries()) {
    const path = audioPath(sfx);
    if (path) addReference(files, projectRoot, `audio:sfx:${index}`, path);
  }
  for (const [index, layer] of (edit.layers ?? []).entries()) {
    addReference(files, projectRoot, `layer:${index}`, layer.src);
  }
  if (edit.thumbnail?.path) addReference(files, projectRoot, "thumbnail", edit.thumbnail.path);

  const receipts = {};
  for (const [label, file] of files) {
    if (!(await isRegularFile(file.path))) throw new ExecutionError(`${label} does not resolve to a regular file`);
    receipts[relative(projectRoot, file.path)] = {
      sha256: file.text === undefined ? await sha256File(file.path) : sha256(file.text),
      bytes: (await stat(file.path)).size,
    };
  }
  return receipts;
}

async function loadOverlays(projectRoot, edit) {
  return Promise.all(
    edit.overlays.map(async (overlay) => ({
      ...overlay,
      html: await readRequired(resolve(projectRoot, overlay.html), overlay.html),
    })),
  );
}

async function loadCaptions(projectRoot, edit) {
  const captionsPath = join(projectRoot, "captions.json");
  if (!(await isRegularFile(captionsPath))) {
    return { overlays: [], warnings: [], layout: null };
  }
  const captionsRoot = parseJson(await readFile(captionsPath, "utf8"), "captions.json");
  const captions = Array.isArray(captionsRoot)
    ? captionsRoot
    : captionsRoot && typeof captionsRoot === "object" && Array.isArray(captionsRoot.captions)
      ? captionsRoot.captions
      : null;
  if (!captions) {
    throw new ExecutionError("captions.json root must be an array or an object with captions[]");
  }
  const resolved = resolveCaptionDisplay(captionsRoot, edit, { output: edit.output });
  if (resolved) {
    return { overlays: generateResolvedCaptionOverlays(resolved), warnings: [], layout: resolved };
  }
  const defaultTextStyle = Array.isArray(captionsRoot)
    ? undefined
    : captionsRoot.default_text_style;
  if (edit.version === 0) {
    return {
      overlays: generateCaptionOverlays(captions, edit.cuts, {
        emphasisWords: edit.emphasis_words,
        defaultTextStyle,
        output: edit.output,
      }),
      warnings: [],
      layout: null,
    };
  }
  const warnings = [];
  const overlays = generateCaptionOverlays(captions, edit.cuts, {
    emphasisWords: edit.emphasis_words,
    defaultTextStyle,
    output: edit.output,
    sourceCount: edit.version === 1 ? edit.sources.length : 1,
    onWarning: (warning) => warnings.push(warning),
  });
  return { overlays, warnings, layout: null };
}

async function persistCaptionLayout(projectRoot, result, capabilities) {
  const root = await realpath(resolve(projectRoot));
  const boundaryProjectionSha256 = sha256(JSON.stringify(result.boundary_projection));
  const payload = {
    ...result,
    runtime: { node: capabilities.nodeVersion, icu: process.versions.icu ?? null },
    boundary_projection_sha256: boundaryProjectionSha256,
  };
  const bytes = `${JSON.stringify(payload, null, 2)}\n`;
  const digest = sha256(bytes);
  const directory = await prepareContainedReportDirectory(root, "caption-layout");
  const path = join(directory, `${digest}.json`);
  try {
    await writeFile(path, bytes, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    if (await readFile(path, "utf8") !== bytes) throw new ExecutionError("caption layout content-address collision");
  }
  return {
    path: relative(root, path),
    sha256: digest,
    schema: result.schema,
    summary: {
      source_cue_count: result.source_cue_count,
      occurrence_count: result.occurrence_count,
      display_cue_count: result.display_cue_count,
      split_source_cue_count: result.split_source_cue_count,
      boundary_projection_sha256: boundaryProjectionSha256,
    },
  };
}

export async function rasterizeAndComposite(context) {
  const {
    state,
    allOverlays,
    edit,
    projectRoot,
    temporaryDirectory,
    cutPath,
    compositePath,
    capabilities,
    duration,
    hasThreeDimensionalOverlay,
    captureTimeoutMs,
    // Falls back to edit.json's own fps for callers that predate --fps (task
    // 2026-07-25-export-options); the overlay rasterizer must always match the base video's actual
    // output fps, which may differ from edit.output.fps when --fps overrides it.
    fps = edit.output.fps,
    videoEncodeArgs = null,
    onProgress,
  } = context;
  const sheetPath = join(temporaryDirectory, "overlay-sheet.html");
  await writeFile(
    sheetPath,
    renderOverlaySheet({ overlays: allOverlays, edit, projectRoot, duration }),
    "utf8",
  );

  if (hasThreeDimensionalOverlay) {
    rejectRasterizer(
      state,
      "hyperframes",
      "3D overlay requires the puppeteer-core path",
    );
  } else if (capabilities.hyperframesAvailable) {
    // mov (ProRes 4444), not webm: on Windows HyperFrames emits webm as vp9/yuv420p with no
    // alpha channel, which the alpha probe below would reject on every run (issue #2).
    const overlayPath = join(temporaryDirectory, "overlay.mov");
    try {
      // The npm .bin shim is not spawnable on Windows (extensionless sh script; Node 22 also
      // refuses .cmd without a shell), so launch the package entry through the node executable.
      runChecked(
        process.execPath,
        [
          capabilities.hyperframesPath,
          "render",
          projectRoot,
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
          overlayPath,
        ],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            CHROME_PATH: capabilities.chromePath,
            PUPPETEER_EXECUTABLE_PATH: capabilities.chromePath,
            HYPERFRAMES_BROWSER_PATH: capabilities.chromePath,
            DO_NOT_TRACK: "1",
          },
        },
      );
      if (!probeHasAlpha(capabilities.ffprobeCommand, overlayPath)) {
        throw new Error("rendered video has no detectable alpha channel");
      }
      await compositeAnimatedOverlay({
        ffmpegCommand: capabilities.ffmpegCommand,
        cutPath,
        overlayPath,
        outputPath: compositePath,
        hasAudio: true,
        videoEncodeArgs,
        onProgress,
      });
      adoptRasterizer(state, "hyperframes");
      return;
    } catch (error) {
      rejectRasterizer(state, "hyperframes", messageOf(error));
    }
  } else {
    rejectRasterizer(state, "hyperframes", "package-local HyperFrames executable is not installed");
  }

  if (capabilities.puppeteerAvailable) {
    try {
      const overlayPath = join(temporaryDirectory, "overlay.mov");
      await captureWithPuppeteer({
        sheetPath,
        chromePath: capabilities.chromePath,
        framesDirectory: join(temporaryDirectory, "frames"),
        overlayMovPath: overlayPath,
        width: edit.output.width,
        height: edit.output.height,
        fps,
        duration,
        ffmpegCommand: capabilities.ffmpegCommand,
        timeoutMs: captureTimeoutMs,
        onWarning: (warning) => addWarning(state, `puppeteer-core: ${warning}`),
      });
      if (!probeHasAlpha(capabilities.ffprobeCommand, overlayPath)) {
        throw new Error("captured video has no detectable alpha channel");
      }
      await compositeAnimatedOverlay({
        ffmpegCommand: capabilities.ffmpegCommand,
        cutPath,
        overlayPath,
        outputPath: compositePath,
        hasAudio: true,
        videoEncodeArgs,
        onProgress,
      });
      adoptRasterizer(state, "puppeteer-core");
      return;
    } catch (error) {
      rejectRasterizer(state, "puppeteer-core", messageOf(error));
    }
  } else {
    rejectRasterizer(state, "puppeteer-core", "puppeteer-core is not installed or resolvable");
  }

  if (hasThreeDimensionalOverlay) {
    throw new ExecutionError("3D overlay requires puppeteer-core; static screenshot fallback is not permitted");
  }

  try {
    const captures = await captureStaticOverlays({
      overlays: allOverlays,
      edit,
      projectRoot,
      temporaryDirectory,
      chromePath: capabilities.chromePath,
      timeoutMs: captureTimeoutMs,
    });
    await compositeStaticOverlays({
      ffmpegCommand: capabilities.ffmpegCommand,
      cutPath,
      captures,
      outputPath: compositePath,
      hasAudio: true,
      duration,
      videoEncodeArgs,
      onProgress,
    });
    adoptRasterizer(state, "static-screenshot");
  } catch (error) {
    rejectRasterizer(state, "static-screenshot", messageOf(error));
    throw new ExecutionError("all overlay rasterizers failed");
  }
}

async function executeAudioPlan(audioPlan) {
  if (audioPlan.operation === "copy") {
    await copyFile(audioPlan.input, audioPlan.output);
    return { stderr: "" };
  }
  const result = spawnSync(audioPlan.command, audioPlan.args, {
    encoding: "utf8",
    maxBuffer: AUDIO_QC_CAPTURE_LIMIT_BYTES,
  });
  if (result.error) {
    return {
      stderr: result.stderr ?? "",
      error: {
        code: result.error.code === "ENOBUFS" ? "CAPTURE_LIMIT" : "PROCESS_FAILED",
        message: result.error.code === "ENOBUFS" ? "filter report exceeded bounded capture" : "audio filter process failed",
      },
    };
  }
  if (result.status !== 0) {
    return { stderr: result.stderr ?? "", error: { code: "PROCESS_FAILED", message: "audio filter process exited unsuccessfully" } };
  }
  return { stderr: result.stderr ?? "" };
}

async function persistFailedRenderArtifact(projectRoot, sourcePath) {
  const root = await realpath(resolve(projectRoot));
  const digest = await sha256File(sourcePath);
  const directory = await prepareContainedReportDirectory(root, "failed-render-artifacts");
  const target = join(directory, `${digest}.mp4`);
  try {
    await copyFile(sourcePath, target, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if (error?.code !== "EEXIST" || await sha256File(target) !== digest) {
      throw new ExecutionError("failed render artifact content-address collision");
    }
  }
  return join(resolve(projectRoot), relative(root, target));
}

// Allocates this run's own render-tmp subdirectory (fs.mkdtemp-equivalent uniqueness: an
// ISO8601-ish timestamp + pid prefix, plus mkdtemp's own random suffix, so even two processes
// starting in the same millisecond never collide). Runs a best-effort sweep for stale directories
// first so crashed runs don't leak disk space forever, without ever touching a directory an active
// concurrent run still owns (see cleanupStaleRunDirectories).
async function createRunTemporaryDirectory(renderTmpRoot) {
  await mkdir(renderTmpRoot, { recursive: true });
  await cleanupStaleRunDirectories(renderTmpRoot);
  const isoStamp = new Date().toISOString().replace(/[:.]/gu, "-");
  return mkdtemp(join(renderTmpRoot, `${isoStamp}-${process.pid}-`));
}

async function cleanupStaleRunDirectories(renderTmpRoot) {
  let entries;
  try {
    entries = await readdir(renderTmpRoot, { withFileTypes: true });
  } catch {
    return;
  }
  const now = Date.now();
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const entryPath = join(renderTmpRoot, entry.name);
        try {
          const info = await stat(entryPath);
          if (now - info.mtimeMs > STALE_RUN_DIRECTORY_MS) {
            await rm(entryPath, { recursive: true, force: true });
          }
        } catch {
          // Best-effort: another process may be concurrently using or removing this directory.
        }
      }),
  );
}

export function verifyArtifact({ outputPath, plan, ffprobeCommand = resolveFfprobe(), ffmpegCommand = resolveFfmpeg() }) {
  const measured = probeMedia(ffprobeCommand, outputPath);
  const video = measured.streams.find((stream) => stream.codec_type === "video");
  const audio = measured.streams.find((stream) => stream.codec_type === "audio");
  const actualDuration = Number(measured.format?.duration ?? video?.duration);
  const actualFps = parseRate(video?.avg_frame_rate ?? video?.r_frame_rate);
  const expected = plan.preset;
  const findings = [];
  // docs/contract-2026-08-18-v1-render-parity.md §2: v1's cuts[].track / at declarations now
  // reach a real gap-aware or track-stack render path under both the default and custom
  // timeline.tracks orders (see buildPlan's v1 dispatch and buildTrackStackPlan in plan.mjs), so the
  // 2026-08-04 "declared but never rendered" hint this comparison used to append on a mismatch no
  // longer has a live cause to point at -- removed rather than left stale/misleading.
  const durationOk = Number.isFinite(actualDuration)
    && Math.abs(actualDuration - plan.predicted_duration_seconds) <= plan.duration_tolerance_seconds;
  compare(findings, "verify.duration", durationOk, `duration ${actualDuration}s; expected ${plan.predicted_duration_seconds}s ±${plan.duration_tolerance_seconds}s`);

  // 検査 1 + 2（task 2026-08-04-render-verify-media-checks）: 1 パスの全デコードで
  // (a) 実フレーム数と (b) デコードエラーの有無を同時に測る。ffprobe -count_frames も同じだけ
  // デコードが要るので、長尺で二重にコストを払わないよう ffmpeg 側 1 回に統合する。
  const decodePass = decodeAllFramesAndCount(ffmpegCommand, outputPath);
  const expectedFrameCount = Math.round(plan.predicted_duration_seconds * expected.fps);
  const frameTolerance = Math.round(plan.duration_tolerance_seconds * expected.fps);
  compare(
    findings,
    "verify.frame-count",
    decodePass.frameCount !== null && Math.abs(decodePass.frameCount - expectedFrameCount) <= frameTolerance,
    `frame count ${decodePass.frameCount ?? "unknown"}; expected ${expectedFrameCount} ±${frameTolerance}`,
  );

  compare(findings, "verify.resolution", video?.width === expected.width && video?.height === expected.height, `resolution ${video?.width ?? "missing"}x${video?.height ?? "missing"}; expected ${expected.width}x${expected.height}`);
  // task 2026-08-07-render-frame-accounting: avg_frame_rate is the container's own
  // nb_frames/duration bookkeeping, not an independent measurement -- it inherits whatever
  // sub-frame rounding the mux step accumulates. Real (non-lavfi) footage run through a
  // multi-segment trim/setpts/atempo/concat graph into a real encoder (verified empirically with
  // the actual reel: 13 cuts, 5 speed changes, 1 dissolve, h264_videotoolbox) legitimately lands
  // exactly 1 frame off nominal fps in either direction -- once as nb_frames landing 1 short of
  // what the declared duration implies (the original v4/v5 render: 1470 frames for a
  // 1471-frame-shaped duration), once as the declared duration landing 1 frame long of nb_frames
  // even though a full decode confirmed every one of the 1471 expected frames was actually
  // present (this task's own repro against the reel's real source footage + cuts + encoder args --
  // see report.md for both runs' raw ffprobe numbers). Both are within verify.duration's and
  // verify.frame-count's own tolerances already; only fps's exact-equality check was flagging
  // them. fpsWithinOneFrameTolerance is intentionally narrower than frame-count's own
  // ±duration_tolerance_seconds*fps (which already accepts up to ~3 frames here) so a genuine
  // multi-frame drop -- like the original v1 3-frame loss this same reel had before its cut
  // boundaries were snapped to the fps grid -- still fails (regression: verify-fps-tolerance.test.mjs).
  compare(
    findings,
    "verify.fps",
    fpsWithinOneFrameTolerance(actualFps, expected.fps, expectedFrameCount),
    `fps ${actualFps}; expected ${expected.fps} ±${oneFrameFpsTolerance(expected.fps, expectedFrameCount)} (1 frame of ${expectedFrameCount})`,
  );
  compare(findings, "verify.video-codec", video?.codec_name === "h264", `video codec ${video?.codec_name ?? "missing"}; expected h264`);
  compare(findings, "verify.video-profile", String(video?.profile ?? "").toLowerCase() === "high", `video profile ${video?.profile ?? "missing"}; expected High`);
  compare(findings, "verify.pixel-format", video?.pix_fmt === "yuv420p", `pixel format ${video?.pix_fmt ?? "missing"}; expected yuv420p`);
  compare(
    findings,
    "verify.color-range",
    video?.color_range !== "pc",
    `color range ${video?.color_range ?? "missing (defaults to tv)"}; expected ${expected.color_range ?? "tv"}`,
  );
  compare(findings, "verify.audio", audio?.codec_name === "aac", `audio codec ${audio?.codec_name ?? "missing"}; expected aac`);
  if (plan.commands.audio_mix?.hasNarration) {
    compare(findings, "verify.narration-audio", Boolean(audio), `narration audio stream present: ${Boolean(audio)}; expected an audio stream because edit.json has audio.narration`);
  }
  compare(
    findings,
    "verify.decode",
    decodePass.ok,
    decodePass.ok ? "all frames decoded without error" : `decode error: ${decodePass.errorExcerpt}`,
  );
  return {
    verdict: findings.some((finding) => finding.severity === "error") ? "fail" : "pass",
    findings,
    measured: {
      duration_seconds: actualDuration,
      width: video?.width ?? null,
      height: video?.height ?? null,
      fps: actualFps,
      video_codec: video?.codec_name ?? null,
      video_profile: video?.profile ?? null,
      pixel_format: video?.pix_fmt ?? null,
      color_range: video?.color_range ?? null,
      audio_codec: audio?.codec_name ?? null,
      frame_count: decodePass.frameCount,
    },
  };
}

// render-cut ハードルール 10: ffmpeg 本体を直叩き（ラッパー禁止）。task が挙げる
// `ffmpeg -v error -i <out> -f null -` 相当（map 指定なし = 全ストリームをデコード）に
// `-progress pipe:1` を足し、stdout に構造化された frame=N の進捗行（常に映像フレーム数）を
// 吐かせつつ stderr は `-v error` のみ（デコードエラーだけが載る）にすることで、1 回の全デコード
// から実フレーム数とデコード成否の両方を取り出す（検査 1 + 2 の統合。task 契約が許容する範囲）。
function decodeAllFramesAndCount(ffmpegCommand, outputPath) {
  const result = spawnSync(
    ffmpegCommand,
    [
      "-hide_banner",
      "-v",
      "error",
      "-nostdin",
      "-i",
      outputPath,
      "-progress",
      "pipe:1",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const frameMatches = [...stdout.matchAll(/^frame=(\d+)$/gmu)];
  const frameCount = frameMatches.length > 0 ? Number(frameMatches.at(-1)[1]) : null;
  const spawnFailed = Boolean(result.error);
  const ok = !spawnFailed && result.status === 0 && stderr.trim() === "";
  const errorExcerpt = spawnFailed
    ? messageOf(result.error)
    : (stderr.trim() || `ffmpeg exited ${result.status ?? "unknown"} with no stderr output`)
        .split(/\r?\n/u)
        .slice(0, 5)
        .join(" / ");
  return { ok, frameCount, errorExcerpt };
}

async function writeState(state, statePath, reportPath, projectRoot) {
  const root = await realpath(projectRoot);
  const akariDirectory = dirname(statePath);
  try {
    await mkdir(akariDirectory);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  await assertContainedDirectory(root, akariDirectory, ".akari");
  const reportsDirectory = dirname(reportPath);
  try {
    await mkdir(reportsDirectory);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  await assertContainedDirectory(root, reportsDirectory, ".akari/reports");
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await writeFile(reportPath, renderReport(state, reportPath, projectRoot), "utf8");
}

async function assertContainedDirectory(root, directory, label) {
  let info;
  let actual;
  try {
    info = await lstat(directory);
    actual = await realpath(directory);
  } catch (error) {
    throw new ExecutionError(`${label} is not a regular project directory: ${messageOf(error)}`);
  }
  const value = relative(root, actual);
  if (!info.isDirectory() || info.isSymbolicLink()
    || !(value === "" || (!value.startsWith("..") && !isAbsolute(value)))) {
    throw new ExecutionError(`${label} is not a regular contained project directory`);
  }
}

function validateEditShape(edit) {
  if (!edit || typeof edit !== "object" || Array.isArray(edit)) throw new ExecutionError("edit.json must be an object");
  if (edit.version !== 0 && edit.version !== 1) throw new ExecutionError("edit.json version must be 0 or 1");
  if (!edit.output || !positive(edit.output.width) || !positive(edit.output.height) || !positive(edit.output.fps)) throw new ExecutionError("edit.json output width, height, and fps must be positive numbers");
  if (edit.version === 0) {
    if (Object.hasOwn(edit, "sources")) throw new ExecutionError("edit.json source and sources are mutually exclusive");
    if (!edit.source || typeof edit.source.path !== "string" || edit.source.path === "") throw new ExecutionError("edit.json source.path is required");
    if (!Array.isArray(edit.cuts)) throw new ExecutionError("edit.json cuts and overlays must be arrays");
  } else {
    if (Object.hasOwn(edit, "source")) throw new ExecutionError("edit.json source and sources are mutually exclusive");
    if (!Array.isArray(edit.sources) || edit.sources.length === 0) {
      throw new ExecutionError("edit.json sources must be an array with at least one item");
    }
    const sourceIds = new Set();
    for (const [index, source] of edit.sources.entries()) {
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        throw new ExecutionError(`edit.json sources[${index}] must be an object`);
      }
      if (!isNonEmptyString(source.id)) {
        throw new ExecutionError(`edit.json sources[${index}].id is required`);
      }
      if (sourceIds.has(source.id)) {
        throw new ExecutionError(`edit.json sources[].id is duplicated: ${source.id}`);
      }
      sourceIds.add(source.id);
      if (!isNonEmptyString(source.path)) {
        throw new ExecutionError(`edit.json sources[${index}].path is required`);
      }
    }
    // v1 の cuts 空/欠落は v0 の「素材全体」ではなく空タイムラインを意味する。
    if (edit.cuts === undefined || (Array.isArray(edit.cuts) && edit.cuts.length === 0)) {
      throw new RefusalError("edit.json version 1 has no output duration because cuts is empty");
    }
    if (!Array.isArray(edit.cuts)) throw new ExecutionError("edit.json cuts must be an array");
    for (const [index, cut] of edit.cuts.entries()) {
      if (!cut || typeof cut !== "object" || Array.isArray(cut)) {
        throw new ExecutionError(`edit.json cuts[${index}] must be an object`);
      }
      if (!Number.isFinite(cut.in) || !Number.isFinite(cut.out) || cut.in < 0 || cut.out <= cut.in) {
        throw new ExecutionError(`edit.json cuts[${index}] must satisfy 0 <= in < out`);
      }
      if (!isNonEmptyString(cut.src) || !sourceIds.has(cut.src)) {
        throw new ExecutionError(`edit.json cuts[${index}].src does not reference sources[].id: ${cut.src ?? ""}`);
      }
    }
  }
  if (!Array.isArray(edit.overlays)) throw new ExecutionError("edit.json cuts and overlays must be arrays");
}

function probeMedia(command, path) {
  const result = spawnSync(command, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], { encoding: "utf8" });
  if (result.error) throw new ExecutionError(messageOf(result.error));
  if (result.status !== 0) throw new ExecutionError(`ffprobe failed for ${basename(path)}: ${result.stderr.trim()}`);
  return parseJson(result.stdout, `ffprobe ${basename(path)}`);
}

export function commandVersion(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 5000, windowsHide: true });
  if (result.error || result.status !== 0) return null;
  const firstLine = (result.stdout || result.stderr || "").split(/\r?\n/u)[0].trim();
  return /\d+\.\d+\.\d+/u.test(firstLine) ? firstLine : null;
}

// Only used for the ffmpeg not-found message (task scope: detection logic itself stays unchanged).
export function ffmpegInstallHint(platform = process.platform) {
  const install = platform === "win32"
    ? "winget install ffmpeg"
    : platform === "darwin"
      ? "brew install ffmpeg"
      : "install ffmpeg via your package manager";
  return `set the FFMPEG environment variable to its path, or install it (${install})`;
}

// darwin/linux candidates are unchanged from before win32 support was added, so behavior on those
// platforms stays byte-identical (win32 gets its own list instead of being merged into this one).
function defaultChromeSystemCandidates({ env, platform }) {
  if (platform === "win32") {
    const programFiles = env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const localAppData = env.LOCALAPPDATA;
    const candidates = [
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    ];
    if (localAppData) candidates.push(join(localAppData, "Google", "Chrome", "Application", "chrome.exe"));
    return candidates;
  }
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
}

export async function findChromePath({
  env = process.env,
  homeDirectory = homedir(),
  platform = process.platform,
  systemCandidates = defaultChromeSystemCandidates({ env, platform }),
  executable = isExecutable,
} = {}) {
  const candidates = await chromePathCandidates({
    env,
    homeDirectory,
    platform,
    systemCandidates,
  });
  for (const candidate of candidates) {
    if (await executable(candidate)) return candidate;
  }
  return null;
}

export async function chromePathCandidates({
  env = process.env,
  homeDirectory = homedir(),
  platform = process.platform,
  systemCandidates = defaultChromeSystemCandidates({ env, platform }),
} = {}) {
  const playwrightRoot = platform === "win32"
    ? join(env.LOCALAPPDATA || join(homeDirectory, "AppData", "Local"), "ms-playwright")
    : platform === "darwin"
      ? join(homeDirectory, "Library", "Caches", "ms-playwright")
      : join(homeDirectory, ".cache", "ms-playwright");
  const playwright = await versionedNestedCandidates({
    roots: [playwrightRoot],
    versionPrefix: "chromium_headless_shell-",
    binaryPaths: platform === "win32"
      ? [[/^chrome-headless-shell-win/u, "chrome-headless-shell.exe"]]
      : platform === "darwin"
        ? [[/^chrome-headless-shell-mac-/u, "chrome-headless-shell"]]
        : [[/^chrome-headless-shell-linux/u, "chrome-headless-shell"]],
  });
  const puppeteerRoots = [join(homeDirectory, ".cache", "puppeteer", "chrome")];
  if (platform === "darwin") {
    puppeteerRoots.push(join(homeDirectory, "Library", "Caches", "puppeteer", "chrome"));
  }
  const puppeteer = await versionedNestedCandidates({
    roots: puppeteerRoots,
    binaryPaths: platform === "darwin"
      ? [[/^chrome-mac-/u, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"]]
      : [[/^chrome-linux/u, "chrome"]],
  });
  return [
    env.CHROME_PATH,
    env.PUPPETEER_EXECUTABLE_PATH,
    ...playwright,
    ...puppeteer,
    ...systemCandidates,
  ].filter(Boolean);
}

async function versionedNestedCandidates({ roots, versionPrefix = "", binaryPaths }) {
  const versions = [];
  for (const root of roots) {
    for (const name of await directoryNames(root, (entry) => entry.startsWith(versionPrefix))) {
      versions.push({ root, name });
    }
  }
  const candidates = [];
  for (const version of versions.sort((left, right) => right.name.localeCompare(left.name))) {
    const versionPath = join(version.root, version.name);
    for (const [directoryPattern, ...binaryPath] of binaryPaths) {
      const directories = await directoryNames(versionPath, (entry) => directoryPattern.test(entry));
      for (const directory of directories.sort((left, right) => right.localeCompare(left))) {
        candidates.push(join(versionPath, directory, ...binaryPath));
      }
    }
  }
  return candidates;
}

async function directoryNames(path, matches) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && matches(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function resolvePuppeteerPackagePath(
  resolvePackage = (specifier) => packageRequire.resolve(specifier),
) {
  try {
    return resolvePackage("puppeteer-core/package.json");
  } catch {
    return null;
  }
}

function adoptRasterizer(state, method) {
  state.provenance.rasterizer.adopted = method;
  state.provenance.rasterizer.attempts.push({ method, status: "adopted", reason: null });
  addRasterizerDowngradeWarning(state);
}

export function addRasterizerDowngradeWarning(state) {
  const rasterizer = state.provenance?.rasterizer;
  const planned = rasterizer?.planned;
  const adopted = rasterizer?.adopted;
  const order = state.plan?.rasterizer?.order ?? [];
  if (!planned || !adopted || order.indexOf(adopted) <= order.indexOf(planned)) return;
  const reason = rasterizer.attempts.find(
    (attempt) => attempt.method === planned && attempt.status === "rejected",
  )?.reason ?? "higher-priority rasterizer failed";
  const warning = `rasterizer downgraded: ${planned} -> ${adopted} (${reason})`;
  addWarning(state, warning);
}

function rejectRasterizer(state, method, reason) {
  state.provenance.rasterizer.attempts.push({ method, status: "rejected", reason });
}

function addWarning(state, warning) {
  state.warnings ??= [];
  if (!state.warnings.includes(warning)) state.warnings.push(warning);
}

async function appendRenderedSourceToEdit({ editPath, outputPath, projectRoot, state }) {
  let source;
  let edit;
  try {
    source = await readFile(editPath, "utf8");
    edit = JSON.parse(source);
  } catch (error) {
    addWarning(state, `rendered source was not added to edit.json: ${messageOf(error)}`);
    return;
  }

  if (edit?.version !== 1 || !Array.isArray(edit.sources)) {
    return;
  }

  const outputSourcePath = relativeOrAbsolute(projectRoot, outputPath).replaceAll("\\", "/");
  if (edit.sources.some(entry => typeof entry?.path === "string"
    && entry.path.replaceAll("\\", "/") === outputSourcePath)) return;

  const existingIds = new Set(edit.sources.map(entry => entry?.id).filter(isNonEmptyString));
  const sourceId = uniqueRenderedSourceId(outputPath, existingIds);
  let updated;
  try {
    updated = appendJsonArrayEntry(source, "sources", {
      id: sourceId,
      path: outputSourcePath,
      proxy: null,
    });
  } catch (error) {
    addWarning(state, `rendered source was not added to edit.json: ${messageOf(error)}`);
    return;
  }

  try {
    await writeFile(editPath, updated, "utf8");
  } catch (error) {
    addWarning(state, `rendered source was not added to edit.json: ${messageOf(error)}`);
  }
}

function uniqueRenderedSourceId(outputPath, existingIds) {
  const stem = basename(outputPath, extname(outputPath));
  const base = stem
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "rendered-output";
  if (!existingIds.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
}

function appendJsonArrayEntry(source, propertyName, entry) {
  const propertyPattern = new RegExp(`"${propertyName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}"\\s*:\\s*\\[`, "gu");
  const propertyMatch = propertyPattern.exec(source);
  if (!propertyMatch) throw new Error(`${propertyName} array was not found`);
  const opening = propertyMatch.index + propertyMatch[0].lastIndexOf("[");
  const closing = findMatchingJsonBracket(source, opening);
  const closingLineStart = source.lastIndexOf("\n", closing - 1) + 1;
  const closingIndent = source.slice(closingLineStart, closing);
  if (!/^[ \t]*$/u.test(closingIndent)) {
    const compact = JSON.stringify(entry);
    const empty = source.slice(opening + 1, closing).trim() === "";
    return `${source.slice(0, closing)}${empty ? "" : ", "}${compact}${source.slice(closing)}`;
  }
  let contentEnd = closing;
  while (contentEnd > opening + 1 && /\s/u.test(source[contentEnd - 1])) contentEnd -= 1;
  const itemIndent = `${closingIndent}  `;
  const serialized = JSON.stringify(entry, null, 2)
    .split("\n")
    .map(line => `${itemIndent}${line}`)
    .join("\n");
  const separator = contentEnd === opening + 1 ? "" : ",";
  return `${source.slice(0, contentEnd)}${separator}\n${serialized}${source.slice(contentEnd)}`;
}

function findMatchingJsonBracket(source, opening) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = opening; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("JSON array brackets are unbalanced");
}

function addReference(map, root, label, path) {
  if (typeof path !== "string" || path === "") throw new ExecutionError(`${label} path is required`);
  map.set(label, { path: resolve(root, path) });
}

function audioPath(value) {
  return typeof value === "string" ? value : value?.path;
}

function resolveOutput(projectRoot, value) {
  return isAbsolute(value) ? value : resolve(projectRoot, value);
}

function ensureOutputDoesNotReplaceInput(projectRoot, edit, outputPath) {
  const inputs = [
    resolve(projectRoot, "edit.json"),
    ...(edit.version === 0
      ? [resolve(projectRoot, edit.source.path)]
      : usedSources(edit).map((source) => resolve(projectRoot, source.path))),
    ...edit.overlays.map((overlay) => resolve(projectRoot, overlay.html)),
  ];
  const captions = resolve(projectRoot, "captions.json");
  if (existsSync(captions)) inputs.push(captions);
  const bgm = audioPath(edit.audio?.bgm);
  if (bgm) inputs.push(resolve(projectRoot, bgm));
  for (const value of edit.audio?.sfx ?? []) {
    const path = audioPath(value);
    if (path) inputs.push(resolve(projectRoot, path));
  }
  for (const value of edit.audio?.narration ?? []) {
    const path = audioPath(value);
    if (path) inputs.push(resolve(projectRoot, path));
  }
  for (const layer of edit.layers ?? []) {
    if (typeof layer?.src === "string" && layer.src !== "") inputs.push(resolve(projectRoot, layer.src));
  }
  if (inputs.includes(outputPath)) {
    throw new RefusalError("--out must not replace an input file");
  }
}

function usedSources(edit) {
  const referencedIds = new Set(edit.cuts.map((cut) => cut.src));
  return edit.sources.filter((source) => referencedIds.has(source.id));
}

function compare(findings, check, passed, message) {
  findings.push({ severity: passed ? "info" : "error", check, message });
}

// task 2026-08-07-render-frame-accounting: how much avg_frame_rate is allowed to drift from the
// nominal fps before verify.fps fails, expressed as "1 frame's worth of container-duration
// rounding" -- see the call site in verifyArtifact for the empirical justification. Exported (and
// kept pure/number-only) so the exact boundary -- 1 frame passes, a genuine multi-frame drop like
// v1's still fails -- can be pinned in tests without needing to reproduce the encoder/mux quirk
// that motivated it in an actual media file.
export function oneFrameFpsTolerance(expectedFps, expectedFrameCount) {
  return expectedFrameCount > 0 ? expectedFps / expectedFrameCount : 0;
}

export function fpsWithinOneFrameTolerance(actualFps, expectedFps, expectedFrameCount) {
  if (!Number.isFinite(actualFps)) return false;
  // +1e-9 absorbs float noise at the exact boundary (a real 1-frame-off case, like the reel's
  // v4/v5 render, lands diff === tolerance to within float precision, not strictly under it).
  return Math.abs(actualFps - expectedFps) <= oneFrameFpsTolerance(expectedFps, expectedFrameCount) + 1e-9;
}

function parseRate(value) {
  if (typeof value !== "string") return Number.NaN;
  const [top, bottom = "1"] = value.split("/");
  return Number(top) / Number(bottom);
}

async function readRequired(path, label) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new ExecutionError(`${label} could not be read: ${messageOf(error)}`);
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ExecutionError(`${label} is not valid JSON: ${messageOf(error)}`);
  }
}

async function isRegularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isExecutable(path) {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// For files launched via process.execPath: X_OK is meaningless on Windows (any existing file
// passes), and the script only needs to be readable by node.
async function isReadable(path) {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readPackageVersion(path) {
  if (!(await isRegularFile(path))) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function relativeOrAbsolute(root, value) {
  const result = relative(root, value);
  return result.startsWith("..") ? value : result;
}

function positive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
