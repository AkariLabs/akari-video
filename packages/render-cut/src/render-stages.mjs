import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { buildEngineProvenance } from "./cli-arguments.mjs";
import { deriveContactSheetTimestamps, renderContactSheet } from "./contact-sheet.mjs";
import { messageOf } from "./errors.mjs";
import { runChecked, runCheckedWithProgress } from "./rasterize.mjs";
import { enumerateDeclaredRenderInputs, hashDeclaredRenderInputs } from "./render-inputs.mjs";
import { createImmutableRenderReceipt } from "./render-receipt.mjs";
import { addWarning, additionalBgmInputs, isNonEmptyString, relativeOrAbsolute, sha256File, sha256PngDirectory } from "./render-support.mjs";
import { prescanBlankFramesWithProgress, resolveVideoEvidenceReuse, verifyArtifact } from "./verify-artifact.mjs";

const VERSION = 1;

export function buildInitialRenderState({ lint, inputs, plan, capabilities, projectRoot, temporaryDirectory, engineRequested, gpuEligibility, codec, gpuForceBypassed, captionLayout }) {
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

export async function runCutAudioStage({ state, plan, capabilities, projectRoot, temporaryDirectory, progressEnabled, reporter }) {
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

export async function runVerifyStage({ reusableGpuVerification, plan, outputPath, capabilities, recordParentTiming, emitTiming, reporter, state, options, codec, edit, projectRoot }) {
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

export async function runContactSheetStage({ edit, loadedOverlays, captionOverlays, plan, projectRoot, capabilities, outputPath, temporaryDirectory, state, emitTiming }) {
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

export async function runReceiptStage({ editPath, outputPath, projectRoot, edit, internalEdit, captionFontAsset, env, state, plan, verification, capabilities, captionLayout, options, emitTiming, declaredInputs, inputSnapshot }) {
  let receiptDeclaredInputs = declaredInputs;
  let receiptInputSnapshot = inputSnapshot;
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
