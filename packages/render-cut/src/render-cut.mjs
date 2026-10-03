import { settleDecisionLog } from "../../akari-tools/src/decision-log/settle.mjs";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants as fsConstants, createReadStream, existsSync } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import { resolveCaptionPlan } from "./caption-resolve.mjs";
import { deriveContactSheetTimestamps, renderContactSheet } from "./contact-sheet.mjs";
import {
  containerForCodec,
  resolveEncodingPolicy,
} from "./encode-preset.mjs";
import { buildPlan, selectDefaultOutput } from "./plan.mjs";
import { isImageLayerSource } from "./layers.mjs";
import { runChecked, runCheckedWithProgress } from "./rasterize.mjs";
import { renderReport } from "./report.mjs";
import { createProgressReporter } from "./progress.mjs";
import {
  buildRenderMediaReferences,
  enumerateDeclaredRenderInputs,
  hashDeclaredRenderInputs,
  projectResolvedMediaPaths,
  RenderInputError,
  resolveDeclaredProjectInput,
} from "./render-inputs.mjs";
import { createImmutableRenderReceipt, prepareContainedReportDirectory } from "./render-receipt.mjs";
import { buildAudioQc, measurementErrorAudioQc, probeToolVersion, AUDIO_QC_CAPTURE_LIMIT_BYTES } from "./audio-qc.mjs";
import { countAudioItems, prepareAudioMixExecution } from "./audio-command.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { prepareAlphaLayers } from "../../media-bin/src/alpha-intake.mjs";
import { resolveCanonicalCaptionFontAsset } from "./caption-font.mjs";
import { exportWithOsr, resolveOsrLauncher } from "../../osr-export/src/index.mjs";
import { launchElectronExport } from "../../osr-export/src/runner.mjs";
import { renderMediaReferencesPath } from "../../osr-export/src/static-server.mjs";
import { FALLBACK_REASONS, exportWithGpu, gpuRuntimeFallbackReason } from "../../gpu-export/src/index.mjs";
import { evaluateGpuEligibility } from "../../gpu-export/src/eligibility.mjs";
import { resolveGpuLauncher, isVgpuFailure } from "../../gpu-export/src/runner.mjs";
import { buildGpuElectronArguments, launchGpuExport } from "../../gpu-export/src/runner.mjs";
import {
  projectRendererCompatibilityEdit,
  readRenderEdit,
} from "./internal-render.mjs";

import { ExecutionError, RefusalError, messageOf, parseJson } from "./errors.mjs";
import { RETIRED_ENGINE, applyOutputScaleToPlan, assertCodecEngine, assertGpuEligibility, assertHevcPresetSupported, assertOsrLauncherAvailable, buildEngineProvenance, formatGpuEligibilityFailures, parseArguments, readForceGpu, resolveEngineChoice } from "./cli-arguments.mjs";
import { cleanupFailedRunTemporaryDirectory, createRunTemporaryDirectory } from "./run-directory.mjs";
import { parseRate, prescanBlankFramesWithProgress, probeMedia, resolveVideoEvidenceReuse, verifyArtifact } from "./verify-artifact.mjs";
export { ExecutionError, RefusalError } from "./errors.mjs";
export { applyOutputScaleToPlan, assertCodecEngine, assertGpuEligibility, assertHevcPresetSupported, assertOsrLauncherAvailable, buildEngineProvenance, parseArguments, parseScaleToValue, readForceGpu, resolveEngineChoice } from "./cli-arguments.mjs";
export { cleanupFailedRunTemporaryDirectory, cleanupStaleRunDirectories, createRunTemporaryDirectory, isProcessAlive, parseRunDirectoryOwner } from "./run-directory.mjs";
export { VIDEO_STREAM_IDENTITY_FIELDS, fpsWithinOneFrameTolerance, hashVideoBitstream, oneFrameFpsTolerance, proveVideoStreamIdentity, resolveVideoEvidenceReuse, reusableGpuVerificationResult, verifyArtifact } from "./verify-artifact.mjs";

const VERSION = 1;
const packageRequire = createRequire(import.meta.url);
const {
  timelineDurationSeconds,
  projectLegacyAudioView,
  toAnchorCaptions,
} = packageRequire("../../edit-store/lib/index.js");
const activeMediaReferencePaths = new Set();
const USAGE = `Usage: render-cut <project-root> [--plan-only] [--out <path>] [--force]
  [--quality master|high|standard|light] [--encoder auto|videotoolbox|nvenc|qsv|amf|mf|x264]
  [--codec h264|hevc|prores422|png] [--fps <number>] [--scale-to <width>x<height>] [--engine auto|gpu|osr]
  [--gpu-preference auto|off|force] [--preview auto|off] [--progress]
  [--no-verify-blank] [--no-audio]
  [--no-settle]

Omitting --quality/--encoder/--fps/--progress reproduces the exact ffmpeg command lines from
before this flag set existed. --quality/--encoder default to today's plain libx264 encode only
when explicitly passed as (or defaulted to) "standard"/"x264"; --fps defaults to edit.json's
output.fps; --progress emits stage lines, engine-originated "PROGRESS frame=<n> total=<n>" lines,
audio-cut "PROGRESS out_time_ms=<n> total_ms=<n>" lines, then "PROGRESS done total_ms=<n>".
--engine defaults to auto; eligible projects use gpu and ineligible projects use osr on every platform.
--gpu-preference (Windows hybrid GPU only) controls the temporary per-app GPU setting written for the
export child process: auto (gpu engine only, skipped when the user pinned a preference), off,
or force (gpu and osr engines). Omitting it defers to AKARI_EXPORT_GPU_PREFERENCE, then saved consent, then off. Other
platforms ignore it.

Exit codes: 0 verified pass (or plan complete), 1 refusal/verify fail, 2 execution error`;

export async function runGpuWithRuntimeFallback({ engineRequested, runGpu, runOsr }) {
  try {
    return { engine: "gpu", result: await runGpu() };
  } catch (error) {
    if (isVgpuFailure(error)) throw error;
    const reason = gpuRuntimeFallbackReason(error, FALLBACK_REASONS);
    if (engineRequested === "gpu" && reason === "hevc-unsupported") {
      throw new RefusalError("この GPU の WebCodecs は HEVC 圧縮に対応していません。--engine osr を使用してください");
    }
    if (engineRequested !== "auto" || reason === null) throw error;
    return {
      engine: "osr",
      result: await runOsr(),
      fallback: { from: "gpu", reason },
      gpuFailureRunPath: error?.gpuFailureRunPath ?? null,
    };
  }
}

export async function runCli(argv, io = console, deps = {}) {
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
    const state = await (deps.renderProject ?? renderProject)(options.projectRoot, options, io);
    if (!options.planOnly && options.settle && state.verify?.verdict === "pass") {
      try {
        await (deps.settleDecisionLog ?? settleDecisionLog)({ projectRoot: resolve(options.projectRoot), actor: "machine:render-cut" });
      } catch (error) {
        io.error(`render-cut settle warning: ${messageOf(error).replace(/[\r\n]+/gu, " ")}`);
      }
    }
    for (const line of formatWarningLines(state.warnings ?? [])) {
      io.error(line);
    }
    if (options.planOnly) {
      io.log(`PLAN: ${state.plan.output} (${state.plan.predicted_duration_seconds}s)`);
      return 0;
    }
    return logVerificationResult(state, io);
  } catch (error) {
    if (error instanceof RefusalError) {
      io.error(`render-cut refused: ${error.message}`);
      return error.exitCode;
    }
    io.error(`render-cut execution error: ${messageOf(error)}`);
    return 2;
  }
}

export function formatWarningLines(warnings, limit = 5) {
  const groups = new Map();
  for (const warning of warnings) {
    const key = warningType(warning);
    const group = groups.get(key) ?? [];
    group.push(warning);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((group) => [
    ...group.slice(0, limit).map((warning) => `render-cut warning: ${warning}`),
    ...(group.length > limit
      ? [`render-cut warning: 他 ${group.length - limit} 件（同種）`]
      : []),
  ]);
}

function warningType(warning) {
  return String(warning)
    .replace(/audio\.sfx\[\d+\]/gu, "audio.sfx[]")
    .replace(/^narration [^:]+:/u, "narration <id>:")
    .replace(/(?<![\p{L}\p{N}_])[-+]?\d+(?:\.\d+)?(?:e[+-]?\d+)?/giu, "<value>");
}

function buildInitialRenderState({ lint, inputs, plan, capabilities, projectRoot, temporaryDirectory, engineRequested, gpuEligibility, codec, gpuForceBypassed, captionLayout }) {
  return {
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
      },
    },
    plan,
    provenance: {
      audio: {
        envelope: plan.commands.audio_mix.envelope,
        clip_fx: plan.commands.audio_mix.clip_fx,
      },
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
      proxy_used: false,
      render_tmp_dir: relativeOrAbsolute(projectRoot, temporaryDirectory),
      rasterizer: { planned: plan.rasterizer.selected, adopted: null, attempts: [] },
      environment: {
        node: capabilities.nodeVersion,
        ffmpeg: capabilities.ffmpegVersion,
        ffprobe: capabilities.ffprobeVersion,
      },
      ...buildEngineProvenance(engineRequested, process.platform, undefined, gpuEligibility, codec),
      codec,
    },
    artifacts: [],
    verify: null,
    ...(gpuForceBypassed ? { gpu_forced: true } : {}),
    ...(captionLayout ? { caption_layout: captionLayout } : {}),
  };
}

async function runCutAudioStage({ state, plan, capabilities, projectRoot, temporaryDirectory, progressEnabled, reporter }) {
  reporter.stageStart("audio-cut");
  const cutAudioPath = join(temporaryDirectory, "cut-audio.mp4");
  const cutCommand = plan.commands.cut_audio;
  for (const warning of cutCommand.warnings ?? []) addWarning(state, warning);
  if (cutCommand.concat_list) {
    await writeFile(cutCommand.concat_list.path, cutCommand.concat_list.content, "utf8");
  }
  for (const chunk of cutCommand.chunks ?? []) {
    runChecked(capabilities.ffmpegCommand, chunk.args, { cwd: projectRoot });
  }
  if (progressEnabled) {
    await runCheckedWithProgress(capabilities.ffmpegCommand, cutCommand.args, {
      cwd: projectRoot,
      onProgress: (seconds) => reporter.cutTime(seconds, plan.predicted_duration_seconds),
    });
  } else {
    runChecked(capabilities.ffmpegCommand, cutCommand.args, { cwd: projectRoot });
  }

  const tailPaddedAudioPath = join(temporaryDirectory, "cut-audio-tail-padded.mp4");
  if (plan.commands.tail_pad_audio) {
    runChecked(plan.commands.tail_pad_audio.command, plan.commands.tail_pad_audio.args, { cwd: projectRoot });
  }
  const audioSourcePath = plan.commands.tail_pad_audio ? tailPaddedAudioPath : cutAudioPath;
  reporter.stageEnd("audio-cut");
  return audioSourcePath;
}

async function runVerifyStage({ reusableGpuVerification, plan, outputPath, capabilities, recordParentTiming, emitTiming, reporter, state, options, codec, edit, projectRoot }) {
  reporter.stageStart("verify");
  const verifyStarted = performance.now();
  // 不具合メモ第22項: 再利用判定をここで 1 回だけ解決する。判定結果は verifyArtifact へ渡すほか、
  // 黒画面検査を先行実行するかどうかの判断にも使う（先行実行は進捗を出せる非同期版）。
  // GPU 段の検査値は copy 経路に限らず渡す。音声が作り直されていても、映像ストリームの
  // 同一性を実証できたときだけ映像の証拠を引き継ぐ判定は resolveVideoEvidenceReuse が行う。
  const videoEvidence = codec === "png"
    ? null
    : resolveVideoEvidenceReuse({
        plan,
        gpuVerification: reusableGpuVerification,
        outputPath,
        ffprobeCommand: capabilities.ffprobeCommand,
        ffmpegCommand: capabilities.ffmpegCommand,
        onTiming: recordParentTiming,
        onCheck: (check, status) => reporter.verifyCheck(check, status),
      });
  if (videoEvidence?.scope === "video") {
    state.provenance.verify_evidence_reuse = videoEvidence.record;
  }
  const blankFrameScan = await prescanBlankFramesWithProgress({
    // verifyArtifact の既定（省略時 true）と揃える。--no-verify-blank のときだけ走らせない。
    enabled: options.verifyBlank !== false && codec !== "png",
    evidence: videoEvidence,
    outputPath,
    fps: plan.preset.fps,
    edit,
    ffmpegCommand: capabilities.ffmpegCommand,
    expectedFrames: Math.round(plan.predicted_duration_seconds * plan.preset.fps),
    reporter,
    onTiming: recordParentTiming,
  });
  const verification = verifyArtifact({
    outputPath,
    plan,
    inputs: state.provenance.sources,
    edit,
    ffprobeCommand: capabilities.ffprobeCommand,
    ffmpegCommand: capabilities.ffmpegCommand,
    verifyBlank: options.verifyBlank,
    gpuVerification: reusableGpuVerification,
    videoEvidence,
    blankFrameScan,
    onTiming: recordParentTiming,
    onCheck: (check, status) => reporter.verifyCheck(check, status),
  });
  state.verify = verification;
  reporter.stageEnd("verify");
  emitTiming("verify_total", verifyStarted);
  state.artifacts = codec === "png"
    ? [
        {
          path: relativeOrAbsolute(projectRoot, outputPath),
          kind: "directory",
          frames: verification.measured.frame_count,
          sha256: await sha256PngDirectory(outputPath),
        },
        {
          path: relativeOrAbsolute(projectRoot, join(outputPath, "audio.wav")),
          sha256: await sha256File(join(outputPath, "audio.wav")),
          ffprobe: verification.measured.audio,
        },
      ]
    : [
        {
          path: relativeOrAbsolute(projectRoot, outputPath),
          sha256: await sha256File(outputPath),
          ffprobe: verification.measured,
        },
      ];
  state.phase = "verified";
  return verification;
}

export async function renderProject(input, options = {}, io = console) {
  const engineRequested = options.engine ?? "auto";
  const codec = options.codec ?? "h264";
  if (options.noAudio && codec === "png") throw new RefusalError("--no-audio is only supported for video containers");
  const env = options.env ?? process.env;
  const forceGpu = engineRequested === "gpu" && readForceGpu(env);
  assertCodecEngine(codec, engineRequested);
  const container = containerForCodec(codec);
  let resolvedEngine = container.kind === "directory" || container.ext === "mov"
    ? "osr"
    : engineRequested === RETIRED_ENGINE ? RETIRED_ENGINE : resolveEngineChoice(engineRequested, process.platform);
  const projectRoot = resolve(input);
  const editPath = options.editPath ? resolve(projectRoot, options.editPath) : join(projectRoot, "edit.json");
  const editText = await readRequired(editPath, options.editPath ?? "edit.json");
  const parsedEdit = parseJson(editText, options.editPath ?? "edit.json");
  const renderTmpRoot = join(projectRoot, ".akari", "render-tmp");
  const captionsRoot = await readJsonIfPresent(join(projectRoot, "captions.json"));
  const captions = captionsRoot === undefined ? undefined : toAnchorCaptions(captionsRoot);
  const normalizedEdit = parsedEdit?.version === 2 && parsedEdit.sources === undefined
    ? { ...parsedEdit, sources: [] } : parsedEdit;
  const renderRead = readRenderEdit(normalizedEdit, renderTmpRoot, { captions });
  let edit = renderRead.edit;
  const internalEdit = renderRead.internal;
  validateEditShape(edit, internalEdit);
  // CLI legacy is retired. API callers still receive the vgpu-specific refusal before
  // capability probing or any render setup; other retired-engine calls keep their refusal.
  if (!["gpu", "osr"].includes(resolvedEngine)) {
    const overlays = await loadOverlays(projectRoot, edit, env);
    if (overlays.some(overlay => /data-akari-vgpu-scene/u.test(overlay.html))) {
      throw new RefusalError("vgpu overlays require --engine gpu");
    }
    resolveEngineChoice(engineRequested, process.platform);
  }

  const lint = await validateLint(projectRoot, options.force === true);
  const capabilities = await measureCapabilities(
    projectRoot,
    edit,
    env,
    options.probeMediaImpl,
  );
  const encodingPolicy = options.encodingPolicy ?? resolveEncodingPolicy({
    cli: { quality: options.quality, encoder: options.encoder, ...(codec === "h264" ? {} : { codec }) },
    edit,
    capabilities,
  });
  const plannedCaptions = await loadCaptions(projectRoot, edit);
  // Caption HTML embeds this exact canonical file URL. Resolve the binding once only when an
  // overlay will actually be rasterized, then hand the same binding to the receipt enumerator.
  const captionFontAsset = plannedCaptions.overlays.length > 0
    ? resolveCanonicalCaptionFontAsset()
    : null;
  const declaredInputs = await collectDeclaredRenderInputs({
    projectRoot, edit, editText, captionFontAsset, internalEdit, env,
  });
  const inputSnapshot = await hashDeclaredRenderInputs(declaredInputs, { useConsumedText: true });
  const inputs = Object.fromEntries(
    inputSnapshot.map((input) => [input.path, {
      sha256: input.sha256,
      bytes: input.bytes,
      ...(input.scope === "library" ? { scope: "library" } : {}),
    }]),
  );
  const captionOverlays = plannedCaptions.overlays;
  const captionLayout = plannedCaptions.layout
    ? await persistCaptionLayout(projectRoot, plannedCaptions.layout, capabilities)
    : null;
  const loadedOverlays = await loadOverlays(projectRoot, edit, env);
  const shouldEvaluateGpu = container.ext === "mp4" && (engineRequested === "gpu" || engineRequested === "auto");
  const gpuEligibility = shouldEvaluateGpu
    ? evaluateGpuEligibility({
        edit: { ...edit, overlays: loadedOverlays },
        captions: plannedCaptions.captions,
        defaultTextStyle: plannedCaptions.defaultTextStyle,
        emphasisWords: plannedCaptions.emphasisWords,
        forceDegraded: forceGpu,
      })
    : null;
  assertGpuEligibility(engineRequested, gpuEligibility, { force: forceGpu });
  const gpuForceBypassed = forceGpu
    && gpuEligibility?.eligible === false
    && gpuEligibility?.summary?.unsupported === 0;
  if (gpuForceBypassed) {
    io.error(`[force-gpu] 適格性を迂回しました（検証用・納品不可）: ${formatGpuEligibilityFailures(gpuEligibility)}`);
  }
  resolvedEngine = container.ext === "mp4"
    ? resolveEngineChoice(engineRequested, process.platform, gpuEligibility)
    : "osr";
  const explicitOutput = options.out ? resolveOutput(projectRoot, options.out) : null;
  const outputPath = explicitOutput ?? selectDefaultOutput(projectRoot, edit, existsSync, codec);
  ensureOutputDoesNotReplaceInput(projectRoot, edit, outputPath);

  // Concurrency isolation (render-tmp-isolation の設計に基づく): a plan-only
  // preview never touches disk, so it keeps using the flat, deterministic render-tmp path (stable
  // across repeated --plan-only calls). An actual render claims its own uniquely-named
  // subdirectory so two processes racing on the same project never clobber each other's
  // intermediates; only the owning process ever writes into it.
  const temporaryDirectory = options.temporaryDirectory
    ? resolve(options.temporaryDirectory)
    : options.planOnly
      ? renderTmpRoot
      : await createRunTemporaryDirectory(renderTmpRoot);
  edit = projectRendererCompatibilityEdit(parsedEdit, internalEdit, temporaryDirectory);
  const planningEdit = projectResolvedMediaPaths({ projectRoot, edit, inputs: declaredInputs });
  const bgms = projectLegacyAudioView(internalEdit).bgms ?? [];
  if (bgms.length > 1) {
    const bgmBindings = new Map(declaredInputs.filter(input => input.scope === "library")
      .map(input => [resolve(projectRoot, input.path), input.absolute_path]));
    planningEdit.audio.bgms = bgms.map(item => ({
      ...item, path: bgmBindings.get(resolve(projectRoot, item.path)) ?? item.path,
    }));
  }
  ensureOutputDoesNotReplaceInput(projectRoot, planningEdit, outputPath);

  const plan = buildPlan({
    edit: planningEdit,
    // buildPlan が internalEdit から読むのは総尺とトラックの mute。宣言パスは保持する。
    internalEdit,
    projectRoot,
    outputPath,
    capabilities,
    hasSourceAudio: capabilities.sourceHasAudio,
    renderOverlays: [...edit.overlays, ...captionOverlays],
    captionOverlays,
    temporaryDirectory,
    encodingPolicy,
    codec,
    fpsOverride: options.fps,
    resolvedEngine,
    noAudio: options.noAudio === true,
  });
  applyOutputScaleToPlan(plan, edit.output, options.scaleTo);
  assertHevcPresetSupported(plan.preset);
  const state = buildInitialRenderState({ lint, inputs, plan, capabilities, projectRoot, temporaryDirectory, engineRequested, gpuEligibility, codec, gpuForceBypassed, captionLayout });
  if (engineRequested === "auto" && gpuEligibility?.eligible === false) {
    addWarning(state, `GPU export is ineligible; using OSR: ${formatGpuEligibilityFailures(gpuEligibility)}`);
  }
  for (const warning of plannedCaptions.warnings) addWarning(state, warning);

  const statePath = join(projectRoot, ".akari", "render.json");
  const reportPath = join(projectRoot, ".akari", "reports", "render-report.html");
  if (options.writeState !== false) await writeState(state, statePath, reportPath, projectRoot);
  if (options.planOnly) return state;

  const runtimeEditPath = await prepareOverlayOnlyRuntimeEdit({
    parsedEdit, normalizedEdit, projectRoot, temporaryDirectory,
    frames: Math.round(plan.predicted_duration_seconds * plan.preset.fps),
  });
  const runtimeLauncher = runtimeEditPath ? {
    osr: (launcher, args) => launchElectronExport(launcher, {
      ...args, extraArgs: [...(args.extraArgs ?? []), "--edit", runtimeEditPath],
    }),
    gpu: (launcher, args) => launchGpuExport(launcher, { ...args, editPath: runtimeEditPath }, {
      argumentBuilder: buildOverlayOnlyGpuArguments,
    }),
  } : null;

  const progressEnabled = options.progress === true;
  const reporter = createProgressReporter({
    enabled: progressEnabled,
    io,
    totalMs: plan.predicted_duration_seconds * 2 * 1000,
  });
  const parentTiming = {};
  const recordParentTiming = (name, ms) => {
    parentTiming[name] = ms;
    if (state.provenance.gpu) {
      state.provenance.gpu.timing = { ...(state.provenance.gpu.timing ?? {}), ...parentTiming };
    }
    if (progressEnabled) io.log(`PROGRESS timing name=${name} ms=${ms}`);
  };
  const emitTiming = (name, started) => {
    const ms = Math.max(0, Math.round(performance.now() - started));
    recordParentTiming(name, ms);
    return ms;
  };
  let reusableGpuVerification = null;

  try {
    let osrLauncher = resolvedEngine === "osr" ? await resolveOsrLauncher() : null;
    let gpuLauncher = resolvedEngine === "gpu" ? await resolveGpuLauncher() : null;
    if (resolvedEngine === "gpu" && gpuLauncher?.tier === 3) {
      if (engineRequested === "gpu") throw new RefusalError(`GPU export is unavailable: ${gpuLauncher.reason}`);
      addWarning(state, `GPU export is unavailable; using OSR: ${gpuLauncher.reason}`);
      resolvedEngine = "osr";
      osrLauncher = await resolveOsrLauncher();
      gpuLauncher = null;
      state.provenance.engine = "osr";
      state.provenance.engine_fallback = { from: "gpu", reason: "GPU Electron launcher unavailable" };
    }
    assertOsrLauncherAvailable(osrLauncher);

    reporter.stageStart("prepare");
    reporter.stageEnd("prepare");
    const audioSourcePath = await runCutAudioStage({ state, plan, capabilities, projectRoot, temporaryDirectory, progressEnabled, reporter });
    const compositePath = join(temporaryDirectory, container.kind === "directory" ? "composite" : `composite.${container.ext}`);
    const alphaLayers = await prepareAlphaLayers(planningEdit, { projectRoot });
    for (const warning of alphaLayers.warnings) addWarning(state, warning);
    const commonV2Options = {
      projectRoot,
      out: compositePath,
      audioSourcePath,
      fps: plan.preset.fps,
      width: edit.output.width,
      height: edit.output.height,
      outputWidth: plan.preset.width,
      outputHeight: plan.preset.height,
      duration: plan.predicted_duration_seconds,
      frames: Math.round(plan.predicted_duration_seconds * plan.preset.fps),
      quality: options.quality ?? encodingPolicy?.effective.quality.value ?? "standard",
      codec,
      // --gpu-preference auto|off|force（省略時 undefined → env AKARI_EXPORT_GPU_PREFERENCE → saved consent → off）。Windows 以外は no-op。
      gpuPreference: options.gpuPreference,
      ffmpegCommand: capabilities.ffmpegCommand,
      ffprobeCommand: capabilities.ffprobeCommand,
      io,
    };

    reporter.stageStart("render", { engine: resolvedEngine });
    await withRenderMediaReferences(projectRoot, declaredInputs, async () => {
      if (resolvedEngine === "gpu") {
        const execution = await runGpuWithRuntimeFallback({
          engineRequested,
          runGpu: () => exportWithGpu({
            ...commonV2Options,
            eligibility: gpuEligibility,
            force: forceGpu,
            launcher: gpuLauncher,
            ...(runtimeLauncher ? { launcherRunner: runtimeLauncher.gpu } : {}),
            preview: options.preview ?? "auto",
            previewOutputDirectory: join(projectRoot, ".akari", "cache", "export-preview"),
            collectLuma: options.verifyBlank,
            progress: progressEnabled,
          }),
          runOsr: async () => {
            osrLauncher = await resolveOsrLauncher();
            assertOsrLauncherAvailable(osrLauncher);
            reporter.stageStart("render", { engine: "osr" });
            return exportWithOsr({
              ...commonV2Options,
              encoder: options.encoder ?? encodingPolicy?.effective.encoder.value ?? "x264",
              launcher: osrLauncher,
              ...(runtimeLauncher ? { launcherRunner: runtimeLauncher.osr } : {}),
            });
          },
        });
        if (execution.engine === "gpu") {
          state.provenance.gpu = {
            ...execution.result.receipt,
            timing: execution.result.run?.timing ?? null,
          };
          reusableGpuVerification = {
            finalVerify: execution.result.run?.finalVerify ?? null,
            luma: execution.result.run?.luma ?? null,
          };
          state.provenance.rasterizer.adopted = "gpu";
          state.provenance.rasterizer.attempts.push({ method: "gpu", status: "adopted", reason: null });
        } else {
          resolvedEngine = "osr";
          state.provenance.engine = "osr";
          state.provenance.engine_fallback = execution.fallback;
          if (execution.gpuFailureRunPath) state.provenance.gpu_failure_run = execution.gpuFailureRunPath;
          state.provenance.osr = execution.result.receipt;
          state.provenance.rasterizer.adopted = "osr";
          state.provenance.rasterizer.attempts.push({ method: "gpu", status: "failed", reason: execution.fallback.reason });
          state.provenance.rasterizer.attempts.push({ method: "osr", status: "adopted", reason: null });
          addWarning(state, `GPU export failed closed; using OSR: ${execution.fallback.reason}`);
        }
      } else {
        const osr = await exportWithOsr({
          ...commonV2Options,
          encoder: options.encoder ?? encodingPolicy?.effective.encoder.value ?? "x264",
          launcher: osrLauncher,
          ...(runtimeLauncher ? { launcherRunner: runtimeLauncher.osr } : {}),
        });
        state.provenance.osr = osr.receipt;
        state.provenance.rasterizer.adopted = "osr";
        state.provenance.rasterizer.attempts.push({ method: "osr", status: "adopted", reason: null });
      }
    });
    reporter.stageEnd("render");

    reporter.stageStart("audio-mix");
    const audioMixStarted = performance.now();
    const finalPath = container.kind === "directory"
      ? compositePath
      : join(temporaryDirectory, `final.${container.ext}`);
    const audioExecution = await executeAudioPlan(plan.commands.audio_mix, capabilities.ffmpegVersion, {
      projectRoot, temporaryDirectory, audioItemCount: countAudioItems(edit.audio),
    });
    const audioMaster = !options.noAudio && edit.audio?.master && typeof edit.audio.master === "object" ? edit.audio.master : null;
    if (audioMaster && audioExecution.error) {
      state.audio_qc = measurementErrorAudioQc({
        master: audioMaster,
        phase: "filter_report",
        code: audioExecution.error.code,
        message: audioExecution.error.message,
        toolVersion: capabilities.ffmpegVersion,
        toolVersionError: capabilities.ffmpegVersionError,
      });
      if (codec === "png") throw new RefusalError(`audio QC filter report measurement failed: ${audioExecution.error.message}`);
      const failedArtifactPath = await persistFailedRenderArtifact(projectRoot, compositePath);
      const failedVerification = verifyArtifact({
        outputPath: failedArtifactPath,
        plan,
        inputs: state.provenance.sources,
        edit,
        ffprobeCommand: capabilities.ffprobeCommand,
        ffmpegCommand: capabilities.ffmpegCommand,
        verifyBlank: options.verifyBlank,
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
          provenance: state.provenance,
          createdAt: options.receiptCreatedAt,
        });
        state.render_receipt = { path: receipt.path, sha256: receipt.sha256 };
      }
      throw new RefusalError(`audio QC filter report measurement failed: ${audioExecution.error.message}`);
    }

    if (codec === "png") {
      const mixedAudioPath = plan.commands.audio_mix.output;
      await rm(join(finalPath, "audio.wav"), { force: true });
      await rename(mixedAudioPath, join(finalPath, "audio.wav"));
    }
    await mkdir(dirname(outputPath), { recursive: true });
    if (explicitOutput) {
      await rm(outputPath, { recursive: codec === "png", force: true });
      await rename(finalPath, outputPath);
    } else if (codec === "png") {
      await rename(finalPath, outputPath);
    } else {
      await copyFile(finalPath, outputPath, fsConstants.COPYFILE_EXCL);
      await rm(finalPath, { force: true });
    }
    state.phase = "rendered";
    if (audioMaster) {
      state.audio_qc = buildAudioQc({
        master: audioMaster,
        audioCodec: plan.preset.audio_codec,
        filterStderr: audioExecution.stderr,
        outputPath: codec === "png" ? join(outputPath, "audio.wav") : outputPath,
        ffmpegCommand: capabilities.ffmpegCommand,
        toolVersion: capabilities.ffmpegVersion,
        toolVersionError: capabilities.ffmpegVersionError,
      });
      if (state.audio_qc.verdict === "INCONCLUSIVE") {
        addWarning(state, "audio_qc is INCONCLUSIVE and requires human acceptance review");
      }
    }
    reporter.stageEnd("audio-mix");
    emitTiming("audio_mix", audioMixStarted);
    const verification = await runVerifyStage({ reusableGpuVerification, plan, outputPath, capabilities, recordParentTiming, emitTiming, reporter, state, options, codec, edit, projectRoot });
    if (verification.verdict === "pass" && codec !== "png") {
      const contactSheetStarted = performance.now();
      const contactSheetTimestamps = deriveContactSheetTimestamps({
        cuts: edit.cuts,
        overlays: [...loadedOverlays, ...captionOverlays],
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
      emitTiming("contact_sheet", contactSheetStarted);
    }
    let receiptDeclaredInputs = declaredInputs;
    let receiptInputSnapshot = inputSnapshot;
    if (verification.verdict === "pass" && codec !== "png") {
      await appendRenderedSourceToEdit({ editPath, outputPath, projectRoot, state });
      const receiptEditText = await readFile(editPath, "utf8");
      receiptDeclaredInputs = await enumerateDeclaredRenderInputs({
        projectRoot, edit, editText: receiptEditText, captionFontAsset, internalEdit, env,
      });
      receiptDeclaredInputs.push(...await additionalBgmInputs({
        projectRoot, edit, editText: receiptEditText, internalEdit, env,
      }));
      receiptDeclaredInputs.sort((a, b) => a.role.localeCompare(b.role, "en") || a.path.localeCompare(b.path, "en"));
      receiptInputSnapshot = await hashDeclaredRenderInputs(receiptDeclaredInputs, { useConsumedText: true });
      const receiptStarted = performance.now();
      const receipt = await createImmutableRenderReceipt({
        projectRoot,
        declaredInputs: receiptDeclaredInputs,
        inputSnapshot: receiptInputSnapshot,
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
        provenance: state.provenance,
        createdAt: options.receiptCreatedAt,
      });
      state.render_receipt = {
        path: receipt.path,
        sha256: receipt.sha256,
      };
      emitTiming("receipt", receiptStarted);
    }
    if (state.audio_qc?.verdict === "MEASUREMENT_ERROR") {
      throw new RefusalError("audio QC decoded artifact measurement failed");
    }
    await writeState(state, statePath, reportPath, projectRoot);
    if (verification.verdict === "pass") {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
    reporter.done();
    return state;
  } catch (error) {
    state.phase = "error";
    state.verify = {
      verdict: "fail",
      findings: [{ severity: "error", check: "render.execution", message: messageOf(error) }],
      measured: null,
    };
    try {
      await writeState(state, statePath, reportPath, projectRoot);
    } finally {
      await cleanupFailedRunTemporaryDirectory(temporaryDirectory);
    }
    throw error;
  }
}

// gpu-export's default launcher is private. Keep its output-size and diagnostics options
// together here so the overlay-only path changes only the edit path.
export function buildOverlayOnlyGpuArguments(launcher, options) {
  return [
    ...buildGpuElectronArguments(launcher, options),
    "--output-width", String(options.outputWidth ?? options.width),
    "--output-height", String(options.outputHeight ?? options.height),
    ...((options.codec ?? "h264") === "hevc" ? ["--codec", "hevc"] : []),
    ...(options.preview === "off" ? ["--preview", "off"] : []),
    ...(options.previewOutputDirectory ? ["--preview-dir", options.previewOutputDirectory] : []),
    ...(options.collectLuma === false ? ["--no-luma"] : []),
    ...(options.progress ? ["--progress-timing"] : []),
    "--spawn-start-ms", String(Date.now()),
  ];
}

export async function prepareOverlayOnlyRuntimeEdit({ parsedEdit, normalizedEdit, projectRoot, temporaryDirectory, frames }) {
  if (parsedEdit?.version !== 2 || normalizedEdit.sources.length > 0) return null;
  const background = parsedEdit.output?.background;
  if (background !== undefined && !/^#[0-9a-fA-F]{6}$/u.test(background)) {
    throw new ExecutionError("edit.json output.background must be a #rrggbb color");
  }
  const needsBackground = background !== undefined && background.toLowerCase() !== "#000000";
  if (!needsBackground && parsedEdit.sources !== undefined) return null;
  let runtimeEdit = normalizedEdit;
  if (needsBackground) {
    const htmlPath = join(temporaryDirectory, "overlay-only-background.html");
    await writeFile(htmlPath,
      `<div style="position:absolute;inset:0;background:${background}"></div>\n`, "utf8");
    const relativeHtml = relative(projectRoot, htmlPath).replaceAll("\\", "/");
    const ids = new Set(normalizedEdit.tracks.flatMap(track => [track.id, ...(track.items ?? []).map(item => item.id)]));
    let id = "akari-render-background";
    for (let suffix = 2; ids.has(id); suffix += 1) id = `akari-render-background-${suffix}`;
    runtimeEdit = { ...normalizedEdit, tracks: [{
      id, lane: "visual", items: [{ id: `${id}-item`, at: 0, duration: frames,
        source: { kind: "html", path: relativeHtml } }],
    }, ...normalizedEdit.tracks] };
  }
  const path = join(temporaryDirectory, "overlay-only-edit.json");
  await writeFile(path, `${JSON.stringify(runtimeEdit)}\n`, "utf8");
  return path;
}

// 表は子の起動前に閉じ、両出口と GPU→OSR 再試行が終了したら必ず消す。
// 使用中の表だけを保護し、PID 再利用で残った自分の表は回収する。
export async function withRenderMediaReferences(projectRoot, inputs, run) {
  const path = renderMediaReferencesPath(await realpath(projectRoot), process.pid);
  if (activeMediaReferencePaths.has(path)) {
    throw Object.assign(new Error(`render media references already in use: ${path}`), { code: "EEXIST" });
  }
  // await より前に確保する。同時呼び出しが作成途中の表を残存表と誤認しないため。
  activeMediaReferencePaths.add(path);
  let created = false;
  try {
    const token = randomBytes(32).toString("hex");
    await mkdir(dirname(path), { recursive: true });
    // この PID の別プロセスは同時に存在しない。他 PID の表には触れない。
    await rm(path, { force: true });
    const file = await open(path, "wx", 0o600);
    created = true;
    try {
      await file.writeFile(JSON.stringify({ token, references: buildRenderMediaReferences(inputs) }), "utf8");
    } finally {
      await file.close();
    }
    const previousToken = process.env.AKARI_RENDER_MEDIA_REFERENCES_TOKEN;
    process.env.AKARI_RENDER_MEDIA_REFERENCES_TOKEN = token;
    try {
      return await run();
    } finally {
      if (previousToken === undefined) delete process.env.AKARI_RENDER_MEDIA_REFERENCES_TOKEN;
      else process.env.AKARI_RENDER_MEDIA_REFERENCES_TOKEN = previousToken;
    }
  } finally {
    try {
      if (created) await rm(path, { force: true });
    } finally {
      activeMediaReferencePaths.delete(path);
    }
  }
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

async function measureCapabilities(
  projectRoot,
  edit,
  env = process.env,
  probeMediaImpl = probeMedia,
) {
  const ffmpegCommand = env.FFMPEG ?? resolveFfmpeg();
  const ffprobeCommand = env.FFPROBE ?? resolveFfprobe();
  const ffmpegVersionProbe = probeToolVersion(ffmpegCommand, ["-version"]);
  const ffmpegVersion = ffmpegVersionProbe.version;
  const ffprobeVersion = commandVersion(ffprobeCommand, ["-version"]);
  const shared = {
    ffmpegCommand,
    ffprobeCommand,
    ffmpegVersion,
    ffmpegVersionError: ffmpegVersionProbe.error,
    ffprobeVersion,
    nodeVersion: process.version,
  };
  const sourceInputs = usedSources(edit).map((source) => {
    const declaredPath = resolve(projectRoot, source.path);
    let path;
    try {
      path = resolveDeclaredProjectInput(
        projectRoot,
        source.path,
        `source:${source.id}`,
        env,
      );
    } catch (error) {
      // Keep the established CLI error for an absent declared source. The resolver still owns
      // containment and library fallback; after both permitted bindings fail, reproduce the old
      // ffprobe diagnostic without opening the unresolved path.
      if (!(error instanceof RenderInputError)
          || !error.message.startsWith(`source:${source.id} could not be resolved:`)) {
        throw error;
      }
      throw new ExecutionError(
        `ffprobe failed for ${basename(declaredPath)}: ${declaredPath}: No such file or directory`,
      );
    }
    const probe = probeMediaImpl(ffprobeCommand, path);
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
      ...(source.chroma_key !== undefined ? { chromaKey: source.chroma_key } : {}),
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

// renderProject が書き出しに渡す宣言済み入力（素材ライブラリへ解決した library scope を含む）の全列挙。
async function collectDeclaredRenderInputs({ projectRoot, edit, editText, captionFontAsset = null, internalEdit, env }) {
  const declaredInputs = await enumerateDeclaredRenderInputs({
    projectRoot, edit, editText, captionFontAsset, internalEdit, env,
  });
  declaredInputs.push(...await additionalBgmInputs({ projectRoot, edit, editText, internalEdit, env }));
  declaredInputs.sort((a, b) => a.role.localeCompare(b.role, "en") || a.path.localeCompare(b.path, "en"));
  return declaredInputs;
}

/**
 * render-cut を経ない書き出し入口（akari-gpu-export の直接実行・capture）が、renderProject と
 * 同じ規則で宣言済み入力を得るための入口。withRenderMediaReferences に渡すと、プロジェクト内に
 * 実体が無い素材ライブラリ参照（.akari/asset-references.json 経由の assets/<category>/<id>/…）も
 * 静的サーバーの /media/ から配信される。これを通さない入口ではライブラリ素材が 404 になる。
 * 字幕フォントは akari scope（媒体表の対象外）なので列挙しない。
 */
export async function enumerateProjectRenderInputs({
  projectRoot,
  editPath = join(projectRoot, "edit.json"),
  env = process.env,
}) {
  const editText = await readRequired(editPath, "edit.json");
  const captionsRoot = await readJsonIfPresent(join(projectRoot, "captions.json"));
  const renderRead = readRenderEdit(editText, join(projectRoot, ".akari", "render-tmp"), {
    captions: captionsRoot === undefined ? undefined : toAnchorCaptions(captionsRoot),
  });
  return collectDeclaredRenderInputs({
    projectRoot,
    edit: renderRead.edit,
    editText,
    internalEdit: renderRead.internal,
    env,
  });
}

async function additionalBgmInputs({ projectRoot, edit, editText, internalEdit, env }) {
  const bgms = projectLegacyAudioView(internalEdit).bgms ?? [];
  const extra = [];
  for (const [index, bgm] of bgms.slice(1).entries()) {
    const single = await enumerateDeclaredRenderInputs({
      projectRoot,
      edit: { ...edit, cuts: [], sources: [], overlays: [], layers: [], audio: { bgm } },
      editText,
      internalEdit: null,
      env,
    });
    const input = single.find(value => value.role === "audio:bgm");
    if (input) extra.push({ ...input, role: `audio:bgm:${index + 1}` });
  }
  return extra;
}

async function collectInputReceipts(projectRoot, edit, editText) {
  const files = new Map([["edit.json", { path: join(projectRoot, "edit.json"), text: editText }]]);
  for (const source of usedSources(edit)) {
    addReference(files, projectRoot, `source:${source.id}`, source.path);
  }
  for (const [index, overlay] of edit.overlays.entries()) {
    addReference(files, projectRoot, `overlay:${index}`, overlaySourcePath(overlay));
  }
  const captionsPath = join(projectRoot, "captions.json");
  if (await isRegularFile(captionsPath)) files.set("captions.json", { path: captionsPath });
  for (const [index, item] of (edit.audio?.bgms ?? (edit.audio?.bgm ? [edit.audio.bgm] : [])).entries()) {
    const bgm = audioPath(item);
    if (bgm) addReference(files, projectRoot, index === 0 ? "audio:bgm" : `audio:bgm:${index}`, bgm);
  }
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

export async function loadOverlays(projectRoot, edit, env = process.env) {
  return Promise.all(
    edit.overlays.map(async (overlay) => {
      const sourcePath = overlaySourcePath(overlay);
      const absolute = resolveDeclaredProjectInput(projectRoot, sourcePath, `overlay:${overlay.id ?? sourcePath}`, env);
      const sourceHtml = await readRequired(absolute, sourcePath);
      return {
        ...overlay,
        html: isInlineHtml(overlay.html) ? overlay.html : sourceHtml,
      };
    }),
  );
}

/** 袋 id の stage 宣言を、展開後の写し（parentId = 袋 id）まで含めて解決する。 */
export async function loadCaptions(projectRoot, edit) {
  const captionsPath = join(projectRoot, "captions.json");
  if (!(await isRegularFile(captionsPath))) {
    return { overlays: [], warnings: [], layout: null, captions: [], defaultTextStyle: null, emphasisWords: [] };
  }
  const parsedCaptionsRoot = parseJson(await readFile(captionsPath, "utf8"), "captions.json");
  let plan;
  try {
    plan = resolveCaptionPlan({ captionsRoot: parsedCaptionsRoot, edit, projectRoot, output: edit.output });
  } catch (error) {
    // 解決経路の入力不備（ルート形状など）は従来どおり ExecutionError として扱う。
    // display_policy 自体の違反はカーネルが専用の code 付きで投げるので、そのまま通す。
    if (error instanceof ExecutionError || error?.code) throw error;
    throw new ExecutionError(error instanceof Error ? error.message : String(error));
  }
  if (plan.layout && plan.layout.word_book_fallbacks.length > 0) {
    console.error(`単語帳: ${plan.layout.word_book_fallbacks.length} 行で行分割保護を外しました`);
  }
  return {
    overlays: plan.overlays,
    warnings: plan.warnings,
    layout: plan.layout,
    captions: plan.captions,
    defaultTextStyle: plan.defaultTextStyle,
    emphasisWords: plan.emphasisWords,
  };
}

async function readJsonIfPresent(path) {
  try {
    if (!(await isRegularFile(path))) return undefined;
    return parseJson(await readFile(path, "utf8"), "captions.json");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
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

export async function executeAudioPlan(audioPlan, ffmpegVersion, { projectRoot, temporaryDirectory = dirname(audioPlan.output), audioItemCount = 0 } = {}) {
  if (audioPlan.operation === "copy") {
    await copyFile(audioPlan.input, audioPlan.output);
    return { stderr: "" };
  }
  const graphPath = join(temporaryDirectory, `audio-filter-${process.pid}.txt`);
  let prepared;
  try {
    prepared = prepareAudioMixExecution(audioPlan, { ffmpegVersion, graphPath, projectRoot, audioItemCount });
  } catch (error) {
    throw new RefusalError(error.message);
  }
  if (prepared.filterGraph !== null) await writeFile(graphPath, prepared.filterGraph, 'utf8');
  let result;
  try {
    result = spawnSync(audioPlan.command, prepared.args, {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: AUDIO_QC_CAPTURE_LIMIT_BYTES,
    });
  } finally {
    if (prepared.filterGraph !== null) await rm(graphPath, { force: true });
  }
  if (result.error) {
    return {
      stderr: result.stderr ?? "",
      error: {
        code: result.error.code === "ENOBUFS" ? "CAPTURE_LIMIT" : "PROCESS_FAILED",
        message: result.error.code === "ENOBUFS" ? "filter report exceeded bounded capture" : `audio filter process failed: ${result.error.message}; ${summarizeAudioStderr(result.stderr)}`,
      },
    };
  }
  if (result.status !== 0) {
    return { stderr: result.stderr ?? "", error: { code: "PROCESS_FAILED", message: `audio filter process exited unsuccessfully: ${summarizeAudioStderr(result.stderr)}` } };
  }
  return { stderr: result.stderr ?? "" };
}

function summarizeAudioStderr(stderr) {
  return String(stderr ?? '').split(/\r?\n/u).map(line => line.trim()).filter(Boolean).slice(-3).join(' | ').slice(0, 240) || 'no stderr';
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

function validateEditShape(edit, internalEdit) {
  if (!edit || typeof edit !== "object" || Array.isArray(edit)) throw new ExecutionError("edit.json must be an object");
  if (!edit.output || !positive(edit.output.width) || !positive(edit.output.height) || !positive(edit.output.fps)) throw new ExecutionError("edit.json output width, height, and fps must be positive numbers");
  {
    if (!Array.isArray(edit.sources)) throw new ExecutionError("edit.json sources must be an array");
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
      const duration = internalEdit ? timelineDurationSeconds(internalEdit).seconds : 0;
      if (!(duration > 0)) {
        throw new RefusalError("edit.json version 1 has no output duration because cuts is empty");
      }
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

export function commandVersion(command, args) {
  return probeToolVersion(command, args).version;
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

function addWarning(state, warning) {
  state.warnings ??= [];
  if (!state.warnings.includes(warning)) state.warnings.push(warning);
}

export function logVerificationResult(state, io = console) {
  for (const finding of state.verify?.findings ?? []) {
    if (finding.severity === "warning") {
      const write = finding.check === "verify.blank-frames" && typeof io.error === "function"
        ? io.error.bind(io)
        : io.log.bind(io);
      write(`WARN ${finding.check}: ${finding.message}`);
    }
  }
  io.log(`${state.verify.verdict.toUpperCase()}: ${state.plan.output}`);
  return state.verify.verdict === "pass" ? 0 : 1;
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

  if (edit?.version !== 2 || !Array.isArray(edit.sources)) {
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

function isInlineHtml(value) {
  return typeof value === "string" && value.trimStart().startsWith("<");
}

function overlaySourcePath(overlay) {
  if (isInlineHtml(overlay?.html)) {
    if (typeof overlay?.htmlPath !== "string" || overlay.htmlPath === "") {
      throw new ExecutionError("inline overlay html requires htmlPath");
    }
    return overlay.htmlPath;
  }
  return overlay?.html;
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
    ...usedSources(edit).map((source) => resolve(projectRoot, source.path)),
    ...edit.overlays.map((overlay) => resolve(projectRoot, overlaySourcePath(overlay))),
  ];
  const captions = resolve(projectRoot, "captions.json");
  if (existsSync(captions)) inputs.push(captions);
  for (const item of edit.audio?.bgms ?? (edit.audio?.bgm ? [edit.audio.bgm] : [])) {
    const bgm = audioPath(item);
    if (bgm) inputs.push(resolve(projectRoot, bgm));
  }
  for (const value of edit.audio?.sfx ?? []) {
    const path = audioPath(value);
    if (path) inputs.push(resolve(projectRoot, path));
  }
  for (const value of [...(edit.audio?.narration ?? []), ...(edit.audio?.speech ?? [])]) {
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

async function readRequired(path, label) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new ExecutionError(`${label} could not be read: ${messageOf(error)}`);
  }
}

async function isRegularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function positive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
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

export async function sha256PngDirectory(directory) {
  const frames = (await readdir(directory))
    .filter((name) => /^frame-\d{5}\.png$/u.test(name))
    .sort();
  if (frames.length === 0) throw new ExecutionError("PNG sequence contains no frames");
  const digests = await Promise.all([
    sha256File(join(directory, frames[0])),
    sha256File(join(directory, frames.at(-1))),
    sha256File(join(directory, "audio.wav")),
  ]);
  return sha256(digests.join("\n"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function relativeOrAbsolute(root, value) {
  const result = relative(root, value);
  return result.startsWith("..") ? value : result;
}
