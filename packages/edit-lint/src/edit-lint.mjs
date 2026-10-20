import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderLintReport } from "./report.mjs";
import { applyFixes, describeChange, serializeFixedEdit, unifiedDiff } from "./fix.mjs";
import { lintText } from './i18n.mjs';
import { collectLicenseFindings } from "./license-findings.mjs";
import { deriveTracks } from "./derive-tracks.mjs";
import {
  readProjectReferences,
  resolveAssetLibraryRoots,
} from "./library-reference.mjs";
import { ExecutionError, readRequiredText, resolveReferenceBinding, addFinding, addSkipped, relativePath, isRecord, isPositiveNumber, isNonEmptyString, formatNumber, messageOf } from "./lint/shared.mjs";
import { readInternalEdit, projectLegacyEdit, timelineDurationSeconds } from "./lint/external.mjs";
import { runReferencedMediaChecks, runSourceVfrChecks, validateProxyGops } from "./lint/media-checks.mjs";
import { lintDecisionLogPredict, validateIntake } from "./lint/intake.mjs";
import { validateReview } from "./lint/review.mjs";
import { validateEngineCapabilities } from "./lint/engine-capabilities.mjs";
import { validateCaptions } from "./lint/captions.mjs";
import { validateAudioDuckKeys, validateBgmSfx, validateLegacyNarrationTrim, validateMusicGrid, validateNarration, validateReferences } from "./lint/audio.mjs";
import { collectInternalAudioTrackRefs, computeCutTrackSegments, validateCutDeclaredPlacement, validateCutTrackFields, validateCutTransformFields, validateCuts, validateDurationMaximum, validateLayerTracks, validateOutputAxisDurationMax, validateSfxTracks, validateStillImageCuts, validateTimelineTracks, validateTrackTransitionOutCompatibility } from "./lint/cuts-tracks.mjs";
import { validateOverlayBackgroundRole, validateOverlays } from "./lint/overlays.mjs";
import { validateAudioMaster, validateEditStructure, validateEditV2, validateOutputEncoding, validateV2ItemAnchors, validateV2ObjectTreeFiles } from "./lint/edit-v2.mjs";
import { collectAudioOnlySourceIds, projectAudioForLint, validateCaptionTrackDeclaration, validateGeometryFitCompat, validateTransitionAdjacency, validateTransitionLayerEvacuations } from "./lint/v2-projection.mjs";
import { hasProjectAkariDirectory } from "../../asset-resolver/src/project-root.mjs";
export { ExecutionError } from "./lint/shared.mjs";
export { findCropScaleProxyRatioFindings } from "./lint/media-checks.mjs";
export { INTAKE_ROOT_FIELDS } from "./lint/intake.mjs";
export { validateCaptionRunRanges } from "./lint/captions.mjs";
export { validateTrackTransitionOutCompatibility } from "./lint/cuts-tracks.mjs";
export { runOverlayFragmentFontGlyphCheck } from "./lint/overlays.mjs";
export { validateCaptionTrackDeclaration } from "./lint/v2-projection.mjs";

const VERSION = 1;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const USAGE = `Usage: edit-lint <project-root|edit.json path> [--fix] [--media] [--json] [--no-reports] [--engine gpu|osr|auto]
       [--silence-error-seconds N] [--max-volume-error-db N]
       [--caption-silence-warn-percent N]
       [--declarations PATH] [--ffprobe PATH]

Without --fix the check only reports; edit.json, captions.json and overlays are never rewritten.
With --fix, mechanically fixable findings are applied, the changed files, unified diff and backup
directory are printed first, and the result is re-checked.
Relative paths in edit.json resolve from the nearest project .akari/ ancestor (excluding AKARI_HOME), or the edit file directory.
Exit codes: 0 PASS, 1 FAIL, 2 execution error`;

export function loadTextstylePresetIds(repoRoot) {
  try {
    return new Set(
      readFileSync(join(repoRoot, "presets/textstyle/index.jsonl"), "utf8")
        .split(/\r?\n/u)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line).id)
        .filter((id) => typeof id === "string"),
    );
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

const providerGuidance = () => lintText('lint-messages.provenance.provider.required');

function providerGuidedMessage(error) {
  const message = messageOf(error);
  return /\.provenance\.provider\)/u.test(message) && !message.includes(providerGuidance())
    ? `${message}${lintText('lint-messages.provenance.provider.separator')}${providerGuidance()}` : message;
}

/**
 * legacy cuts（projectLegacyEdit の cuts[] と同じ宣言順）の各位置に対応する物理 visual
 * トラックの id。cuts の連結キーが別々の物理トラックへ衝突していないかを lint が判定する
 * ために使う（報告 2026-10-20 §1）。
 */
function physicalCutTrackIds(internalEdit) {
  const ids = [];
  const visit = (item, trackId) => {
    if (item?.source?.kind === "media" && item.legacy?.collection === "cuts"
      && Number.isInteger(item.legacy?.index)) {
      ids[item.legacy.index] = trackId;
    }
    for (const child of item?.children ?? []) visit(child, trackId);
  };
  for (const track of internalEdit?.tracks ?? []) {
    for (const item of track.items ?? []) visit(item, track.id);
  }
  return ids;
}

function readEditWithProviderGuidance(edit, options) {
  try {
    return readInternalEdit(edit, options);
  } catch (error) {
    error.message = providerGuidedMessage(error);
    throw error;
  }
}

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
    if (options.fix) return await runFixMode(options, io);
    const result = await lintProject(options.input, options);
    if (options.json) {
      io.log(JSON.stringify(result, null, 2));
    } else {
      printResult(result, options, io);
      for (const line of await describeFixable(options, result)) io.log(line);
    }
    return result.verdict === "pass" ? 0 : 1;
  } catch (error) {
    io.error(`edit-lint execution error: ${providerGuidedMessage(error)}`);
    return 2;
  }
}

function printResult(result, options, io) {
  io.log(
    `${result.verdict.toUpperCase()}: ${options.input} (${result.findings.length} findings, ${result.skipped.length} skipped)`,
  );
  for (const finding of result.findings) {
    io.log(
      `- [${finding.severity}] ${finding.check}: ${finding.message}${finding.path ? ` (${finding.path})` : ""}`,
    );
  }
}

/** 既定（--fix なし）でも「--fix で直せるもの」を件数と要点で知らせる。書き込みはしない。 */
async function describeFixable(options, result) {
  if (result.findings.length === 0) return [];
  let edit;
  try {
    const paths = await resolveInput(options.input, options);
    edit = JSON.parse(await readFile(paths.editPath, "utf8"));
  } catch {
    return [];
  }
  const { changes } = applyFixes(edit, result.findings);
  if (changes.length === 0) return [];
  const lines = [lintText("lint-messages.fix.status.available", { count: changes.length, n: changes.length })];
  for (const change of changes.slice(0, 5)) lines.push(`  - ${describeChange(change)}`);
  if (changes.length > 5) {
    lines.push(`  - ${lintText("lint-messages.fix.status.more", { count: changes.length - 5, n: changes.length - 5 })}`);
  }
  return lines;
}

function formatFixHeader({ changes, backupRelative, diff }) {
  const lines = [
    lintText("lint-messages.fix.header.changed", { count: 1, n: 1 }),
    lintText("lint-messages.fix.header.files"),
    "  M edit.json",
    lintText("lint-messages.fix.header.reasons"),
    ...changes.map(change => `  - ${describeChange(change)}`),
    lintText("lint-messages.fix.header.diff"),
    ...diff.lines,
  ];
  if (diff.omitted > 0) {
    lines.push(lintText("lint-messages.fix.diff.omitted", { count: diff.omitted, n: diff.omitted }));
  }
  lines.push(
    lintText("lint-messages.fix.header.backup", { path: backupRelative }),
    lintText("lint-messages.fix.header.after"),
  );
  return lines;
}

async function runFixMode(options, io) {
  const paths = await resolveInput(options.input, options);
  const preliminary = await lintProject(options.input, { ...options, fix: false, writeReports: false });
  const beforeText = await readFile(paths.editPath, "utf8");
  let edit;
  try {
    edit = JSON.parse(beforeText);
  } catch (error) {
    throw new ExecutionError(`edit.json is not valid JSON: ${messageOf(error)}`);
  }
  const { changes } = applyFixes(edit, preliminary.findings);
  const afterText = changes.length === 0 ? beforeText : serializeFixedEdit(edit);
  if (changes.length === 0 || afterText === beforeText) {
    if (options.json) {
      io.log(JSON.stringify(preliminary, null, 2));
    } else {
      printResult(preliminary, options, io);
      io.log(lintText("lint-messages.fix.status.none"));
    }
    return preliminary.verdict === "pass" ? 0 : 1;
  }

  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const backupRelative = `.akari/work/tmp/lint-fix-${stamp}`;
  const backupDirectory = join(paths.projectRoot, ...backupRelative.split("/"));
  await mkdir(backupDirectory, { recursive: true });
  await writeFile(join(backupDirectory, "edit.json"), beforeText, "utf8");
  await writeFile(paths.editPath, afterText, "utf8");

  const diff = unifiedDiff(relativePath(paths.projectRoot, paths.editPath), beforeText, afterText);
  const header = formatFixHeader({ changes, backupRelative, diff });
  const emit = options.json ? line => io.error(line) : line => io.log(line);
  for (const line of header) emit(line);

  const result = await lintProject(options.input, {
    ...options,
    fix: false,
    writeReports: options.writeReports !== false,
  });
  if (options.json) {
    io.log(JSON.stringify(result, null, 2));
  } else {
    io.log("");
    printResult(result, options, io);
  }
  return result.verdict === "pass" ? 0 : 1;
}

export async function lintProject(input, options = {}) {
  const paths = await resolveInput(input, options);
  const findings = [];
  const skipped = [];
  const inputs = {};
  const editText = await readRequiredText(
    paths.editPath,
    "edit.json",
    inputOverride(options, paths.projectRoot, paths.editPath),
  );
  inputs.edit_json_sha256 = sha256(editText);

  let edit;
  try {
    edit = JSON.parse(editText);
  } catch (error) {
    throw new ExecutionError(`edit.json is not valid JSON: ${messageOf(error)}`);
  }

  const engine = parseEngine(options.engine ?? null);
  const engineCapabilities = engine === null ? null : readEngineCapabilities(options);
  if (engineCapabilities !== null) {
    inputs.engine_capabilities_sha256 = sha256(engineCapabilities.text);
    if (!isRecord(edit) || edit.version !== 2) {
      addSkipped(skipped, "engine.capabilities", lintText('lint-messages.engine.capability.v2Only'));
    }
  }

  if (isRecord(edit) && Number.isInteger(edit.version) && edit.version > 2) {
    addFinding(findings, {
      severity: "error",
      check: "edit.version",
      message: lintText('lint-messages.edit.version.future', { version: edit.version }),
      path: "edit.json#version",
    });
    addSkipped(
      skipped,
      "edit.validation",
      "a newer edit.json version was detected; no format assumptions were made",
    );
    return writeResult(findings, skipped, inputs, paths, options);
  }

  if (isRecord(edit) && edit.version !== 2) readEditWithProviderGuidance(edit);
  validateEditV2(edit, findings);
  if (isRecord(edit) && edit.version === 2) {
    await validateV2ObjectTreeFiles(edit, findings, paths);
  }
  if (findings.some(finding => finding.severity === "error")) {
    return writeResult(findings, skipped, inputs, paths, options);
  }
  const rawEdit = edit.version === 2 && edit.sources === undefined
    ? { ...edit, sources: [] } : edit;
  const internalEdit = readEditWithProviderGuidance(rawEdit, { allowCutAudioSplit: true });
  const legacyEdit = projectLegacyEdit(internalEdit);
  if (engineCapabilities !== null && rawEdit.version === 2) {
    validateEngineCapabilities(rawEdit, internalEdit, engine, engineCapabilities.value, findings);
  }
  validateTransitionLayerEvacuations(rawEdit, internalEdit, findings);
  validateGeometryFitCompat(rawEdit, internalEdit, findings);
  const rawAudio = isRecord(rawEdit.audio) ? rawEdit.audio : {};
  if (rawEdit.version === 2) {
    validateLegacyNarrationTrim(rawAudio.narration, findings);
  }
  const projectedAudio = projectAudioForLint(internalEdit);
  edit = {
    ...rawEdit,
    ...legacyEdit,
    overlays: internalEdit.tracks.flatMap(track => track.items)
      .filter(item => item.source.kind === "html")
      .map(item => item.declaration),
    version: 1,
    output: rawEdit.output,
    audio: {
      ...rawAudio,
      ...projectedAudio,
    },
  };

  const analysisState = await readOptionalJson(
    paths.analysisPath,
    "analysis.json",
    inputOverride(options, paths.projectRoot, paths.analysisPath),
  );
  if (analysisState.exists) {
    inputs.analysis_json_sha256 = sha256(analysisState.text);
    if (analysisState.error) {
      addFinding(findings, {
        severity: "error",
        check: "analysis.schema",
        message: `analysis.json is not valid JSON: ${analysisState.error}`,
        path: relativePath(paths.projectRoot, paths.analysisPath),
      });
    }
  } else {
    addSkipped(
      skipped,
      "analysis.json",
      "analysis.json is absent",
    );
  }

  const captionsState = await readOptionalJson(
    paths.captionsPath,
    "captions.json",
    inputOverride(options, paths.projectRoot, paths.captionsPath),
  );
  if (captionsState.exists) {
    inputs.captions_json_sha256 = sha256(captionsState.text);
    if (captionsState.error) {
      addFinding(findings, {
        severity: "error",
        check: "captions.schema",
        message: `captions.json is not valid JSON: ${captionsState.error}`,
        path: relativePath(paths.projectRoot, paths.captionsPath),
      });
    }
  } else {
    addSkipped(skipped, "captions", "captions.json is absent");
  }
  if (isRecord(rawEdit) && rawEdit.version === 2) {
    validateV2ItemAnchors(rawEdit, captionsState, findings);
  }
  validateCaptionTrackDeclaration(rawEdit, captionsState.value, findings);

  const reviewState = await readOptionalJson(
    paths.reviewPath,
    "review.json",
    inputOverride(options, paths.projectRoot, paths.reviewPath),
  );
  if (reviewState.exists) {
    inputs.review_json_sha256 = sha256(reviewState.text);
    if (reviewState.error) {
      addFinding(findings, {
        severity: "error",
        check: "review.schema",
        message: `review.json is not valid JSON: ${reviewState.error}`,
        path: relativePath(paths.projectRoot, paths.reviewPath),
      });
    }
  } else {
    addSkipped(skipped, "review", "review.json is absent");
  }

  const intakeState = await readOptionalJson(
    paths.intakePath,
    "intake.json",
    inputOverride(options, paths.projectRoot, paths.intakePath),
  );
  if (intakeState.exists) {
    inputs.intake_json_sha256 = sha256(intakeState.text);
    if (intakeState.error) {
      addFinding(findings, {
        severity: "error",
        check: "intake.schema",
        message: `intake.json is not valid JSON: ${intakeState.error}`,
        path: relativePath(paths.projectRoot, paths.intakePath),
      });
    }
  } else {
    addSkipped(skipped, "intake", ".akari/intake.json is absent");
  }

  const structure = validateEditStructure(edit, findings, paths);
  const sourcePath = structure.sourcePath;
  const audioOnlySourceIds = collectAudioOnlySourceIds(rawEdit);
  const referenceState = await validateReferences(edit, findings, paths, audioOnlySourceIds);
  findings.push(...await collectLicenseFindings(edit, sourcePath =>
    resolveReferenceBinding(paths.editPath, sourcePath, paths).path));
  await validateProxyGops(rawEdit, findings, paths, options);
  const cutsStructureResult = validateCuts(
    edit.cuts,
    findings,
    paths,
    structure.sourceIds,
  );
  // 全素材の最大終端を出力尺とする。外部字幕の output 区間も同じ出力軸へ加える。
  // cuts が構造的に不正なら下流の尺検証は止める。
  const timelineDuration = cutsStructureResult === null ? null : timelineDurationSeconds(internalEdit);
  const captionRows = Array.isArray(captionsState.value) ? captionsState.value
    : Array.isArray(captionsState.value?.captions) ? captionsState.value.captions : [];
  const outputCaptionEnd = captionRows.reduce((end, cue) =>
    cue?.time_domain === 'output' && Number.isFinite(cue.end) ? Math.max(end, cue.end) : end, 0);
  const timeline = timelineDuration ? Math.max(timelineDuration.seconds, outputCaptionEnd) : null;
  if (timelineDuration?.basis === "overlays-audio") {
    addFinding(findings, {
      severity: "info",
      check: "timeline.duration-derived",
      message: lintText('lint-messages.timeline.duration.derived', { seconds: formatNumber(timeline), n: timeline }),
      path: "edit.json#tracks",
    });
  }
  validateCutTrackFields(edit.cuts, findings);
  validateCutTransformFields(edit.cuts, findings);
  // 宣言 at と cuts 連結後の実配置のずれ（報告 2026-10-20 §1）。legacy 投影の cuts は
  // 物理 visual トラックごとに一意な連結キーを持つ（internal-model.ts の cutRef）ため、
  // ここで連結配置を再現しても別トラックの同時表示を誤って拒否しない。
  validateCutDeclaredPlacement(edit.cuts, findings, physicalCutTrackIds(internalEdit));
  validateStillImageCuts(edit, findings);
  const cutTrackSegments = computeCutTrackSegments(edit.cuts);
  validateTransitionAdjacency(edit.cuts, cutTrackSegments, edit.sources, edit.fps, findings);
  validateDurationMaximum(edit.outputs, timeline, findings, paths);
  validateOutputAxisDurationMax(edit.outputs, cutTrackSegments, findings);
  await validateOverlays(edit.overlays, timeline, findings, paths);
  validateOverlayBackgroundRole(edit.overlays, findings);
  await validateNarration(edit?.audio?.narration, timeline, findings, paths);
  await validateBgmSfx(edit?.audio?.bgm, edit?.audio?.sfx, timeline, findings, paths);
  validateAudioDuckKeys(edit?.audio?.duck_keys, findings);
  await validateMusicGrid(
    edit?.audio?.bgm,
    edit?.audio?.sfx,
    timeline,
    findings,
    skipped,
    paths,
    options,
  );
  validateSfxTracks(edit?.audio?.sfx, findings);
  validateAudioMaster(edit?.audio?.master, findings, "edit.json#audio.master");
  validateOutputEncoding(edit?.output?.encoding, findings, "edit.json#output.encoding");
  validateLayerTracks(edit.layers, findings);
  validateTimelineTracks(edit, findings, collectInternalAudioTrackRefs(internalEdit), internalEdit);
  validateTrackTransitionOutCompatibility(edit, findings);

  if (captionsState.value !== undefined) {
    // 字幕のクランプ判定も、overlays.timeline / audio.* / 書き出し尺と同じ総尺を使う。
    // cuts の終端だけで判定すると、media より後ろまで続く html オーバーレイの終端を無視する。
    const captionTimelineEndSeconds = timelineDuration?.seconds
      ?? cutTrackSegments.reduce((maximum, segment) => Math.max(maximum, segment.end), 0);
    validateCaptions(
      captionsState.value,
      edit,
      analysisState.value,
      findings,
      paths,
      captionTimelineEndSeconds,
      loadTextstylePresetIds(options.textstyleRepositoryRoot ?? REPOSITORY_ROOT),
    );
  }

  if (reviewState.value !== undefined) {
    await validateReview(reviewState.value, edit, findings, paths, skipped);
  }

  if (intakeState.value !== undefined) {
    validateIntake(intakeState.value, findings, paths);
  }
  await lintDecisionLogPredict({ projectRoot: paths.projectRoot, intake: intakeState.value, edit: rawEdit, findings });
  runSourceVfrChecks(rawEdit, edit, findings, paths);

  if (options.media) {
    runReferencedMediaChecks(
      rawEdit,
      edit,
      findings,
      skipped,
      paths,
      options,
      captionsState.value,
    );
  } else {
    addSkipped(skipped, "media", "media checks require --media");
  }

  return writeResult(findings, skipped, inputs, paths, options);
}

async function writeResult(findings, skipped, inputs, paths, options) {
  const normalizedFindings = finalizeFindings(findings);
  const normalizedSkipped = finalizeSkipped(skipped);
  const result = {
    version: VERSION,
    checked_at: options.checkedAt ?? new Date().toISOString(),
    inputs: sortObject(inputs),
    verdict: normalizedFindings.some((finding) => finding.severity === "error")
      ? "fail"
      : "pass",
    findings: normalizedFindings,
    skipped: normalizedSkipped,
  };

  if (options.writeReports === false) {
    return result;
  }

  const lintDirectory = join(paths.projectRoot, ".akari");
  const reportsDirectory = join(lintDirectory, "reports");
  const lintPath = join(lintDirectory, "lint.json");
  const reportPath = join(reportsDirectory, "edit-lint-report.html");
  await mkdir(reportsDirectory, { recursive: true });
  await writeFile(lintPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(
    reportPath,
    renderLintReport(result, reportPath, paths.projectRoot),
    "utf8",
  );

  return result;
}

export function parseArguments(argv) {
  let input = null;
  const options = {
    fix: false,
    media: false,
    json: false,
    writeReports: true,
    silenceErrorSeconds: null,
    maxVolumeErrorDb: null,
    captionSilenceWarnPercent: null,
    declarationsPath: null,
    ffprobeCommand: null,
    engine: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--media") {
      options.media = true;
      continue;
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--fix") {
      options.fix = true;
      continue;
    }
    if (argument === "--no-reports") {
      options.writeReports = false;
      continue;
    }
    if (argument === "--engine") {
      options.engine = parseEngine(argv[++index]);
      if (options.engine === null) throw new ExecutionError("--engine requires gpu, osr, or auto");
      continue;
    }
    if (argument.startsWith("--engine=")) {
      options.engine = parseEngine(argument.slice("--engine=".length));
      if (options.engine === null) throw new ExecutionError("--engine requires gpu, osr, or auto");
      continue;
    }
    if (argument === "--silence-error-seconds") {
      options.silenceErrorSeconds = parseThreshold(argv[++index], argument);
      continue;
    }
    if (argument.startsWith("--silence-error-seconds=")) {
      options.silenceErrorSeconds = parseThreshold(
        argument.slice("--silence-error-seconds=".length),
        "--silence-error-seconds",
      );
      continue;
    }
    if (argument === "--max-volume-error-db") {
      options.maxVolumeErrorDb = parseNumber(argv[++index], argument);
      continue;
    }
    if (argument.startsWith("--max-volume-error-db=")) {
      options.maxVolumeErrorDb = parseNumber(
        argument.slice("--max-volume-error-db=".length),
        "--max-volume-error-db",
      );
      continue;
    }
    if (argument === "--caption-silence-warn-percent") {
      options.captionSilenceWarnPercent = parseNumber(argv[++index], argument);
      continue;
    }
    if (argument.startsWith("--caption-silence-warn-percent=")) {
      options.captionSilenceWarnPercent = parseNumber(
        argument.slice("--caption-silence-warn-percent=".length),
        "--caption-silence-warn-percent",
      );
      continue;
    }
    if (argument === "--declarations") {
      const value = argv[++index];
      if (!isNonEmptyString(value)) {
        throw new ExecutionError("--declarations requires a path");
      }
      options.declarationsPath = resolve(value);
      continue;
    }
    if (argument.startsWith("--declarations=")) {
      const value = argument.slice("--declarations=".length);
      if (!isNonEmptyString(value)) {
        throw new ExecutionError("--declarations requires a path");
      }
      options.declarationsPath = resolve(value);
      continue;
    }
    if (argument === "--ffprobe") {
      const value = argv[++index];
      if (!isNonEmptyString(value)) {
        throw new ExecutionError("--ffprobe requires a path");
      }
      options.ffprobeCommand = value;
      continue;
    }
    if (argument.startsWith("--ffprobe=")) {
      const value = argument.slice("--ffprobe=".length);
      if (!isNonEmptyString(value)) {
        throw new ExecutionError("--ffprobe requires a path");
      }
      options.ffprobeCommand = value;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new ExecutionError(`Unknown option: ${argument}`);
    }
    if (input !== null) throw new ExecutionError("Only one input path may be provided");
    input = argument;
  }

  if (input === null) throw new ExecutionError("An input path is required");
  return { input, ...options };
}

function parseEngine(value) {
  if (value === null || value === undefined) return null;
  if (["gpu", "osr", "auto"].includes(value)) return value;
  throw new ExecutionError("--engine requires gpu, osr, or auto");
}

function readEngineCapabilities(options) {
  let text;
  try {
    if (typeof options.engineCapabilitiesText === "string") {
      text = options.engineCapabilitiesText;
    } else if (isRecord(options.engineCapabilities)) {
      text = `${JSON.stringify(options.engineCapabilities, null, 2)}\n`;
    } else if (typeof options.engineCapabilitiesPath === "string") {
      text = readFileSync(options.engineCapabilitiesPath, "utf8");
    } else {
      const checkout = new URL("../../schemas/engine-capabilities.json", import.meta.url);
      const bundled = new URL("./engine-capabilities.json", import.meta.url);
      text = readFileSync(existsSync(checkout) ? checkout : bundled, "utf8");
    }
  } catch (error) {
    const location = options.engineCapabilitiesPath
      ? lintText('lint-messages.engine.capability.selectedTable', { path: options.engineCapabilitiesPath })
      : lintText('lint-messages.engine.capability.bundledMissing');
    throw new ExecutionError(`engine capability table cannot be read (${location}): ${messageOf(error)}`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ExecutionError(`engine capability table is not valid JSON: ${messageOf(error)}`);
  }
  if (!isRecord(value) || !Array.isArray(value.fields) || !Array.isArray(value.engines)) {
    throw new ExecutionError("engine capability table has an invalid shape");
  }
  return { text, value };
}

async function resolveInput(input, options = {}) {
  const absolute = resolve(input);
  let inputStats;
  try {
    inputStats = await stat(absolute);
  } catch (error) {
    throw new ExecutionError(`Input cannot be read: ${messageOf(error)}`);
  }

  const editPath = options.editPath
    ? resolve(options.editPath)
    : inputStats.isDirectory()
      ? join(absolute, "edit.json")
      : absolute;
  if (!options.editPath && !inputStats.isDirectory() && basename(absolute) !== "edit.json") {
    throw new ExecutionError("Input file must be named edit.json");
  }
  let projectRoot = dirname(editPath);
  for (let current = projectRoot; ; current = dirname(current)) {
    if (hasProjectAkariDirectory(current, options.env ?? process.env)) {
      projectRoot = current;
      break;
    }
    if (dirname(current) === current) break;
  }
  return {
    projectRoot,
    editPath,
    analysisPath: join(projectRoot, "analysis.json"),
    captionsPath: join(projectRoot, "captions.json"),
    reviewPath: join(projectRoot, "review.json"),
    intakePath: join(projectRoot, ".akari", "intake.json"),
    assetReferences: readProjectReferences(projectRoot),
    libraryRoots: resolveAssetLibraryRoots(options.env ?? process.env).read,
  };
}

function extractAnalysisDuration(analysis) {
  const candidates = [
    analysis?.duration,
    analysis?.source?.duration,
    analysis?.media?.duration,
    analysis?.metadata?.duration,
  ];
  return candidates.find(isPositiveNumber) ?? null;
}

function inputOverride(options, projectRoot, filePath) {
  const overrides = options.inputOverrides;
  if (!overrides || typeof overrides !== "object") return undefined;
  const key = relative(projectRoot, filePath).split("\\").join("/");
  return Object.hasOwn(overrides, key) ? { present: true, text: overrides[key] } : undefined;
}

async function readOptionalJson(filePath, label, override) {
  if (override?.present) {
    if (override.text === null) return { exists: false };
    if (typeof override.text !== "string") {
      throw new ExecutionError(`${label} cannot be read: invalid in-memory override`);
    }
    try {
      return { exists: true, text: override.text, value: JSON.parse(override.text) };
    } catch (error) {
      return { exists: true, text: override.text, error: messageOf(error) };
    }
  }
  try {
    const text = await readFile(filePath, "utf8");
    try {
      return { exists: true, text, value: JSON.parse(text) };
    } catch (error) {
      return { exists: true, text, error: messageOf(error) };
    }
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false };
    throw new ExecutionError(`${label} cannot be read: ${messageOf(error)}`);
  }
}

function finalizeFindings(findings) {
  return findings
    .map((finding) => ({ ...finding }))
    .sort(compareFindings)
    .map((finding, index) => ({
      id: `F${String(index + 1).padStart(3, "0")}`,
      severity: finding.severity,
      check: finding.check,
      message: finding.message,
      ...(finding.path ? { path: finding.path } : {}),
      ...(finding.range ? { range: finding.range } : {}),
      ...(finding.details ? { details: finding.details } : {}),
    }));
}

function compareFindings(left, right) {
  return ["check", "severity", "path", "message"]
    .map((field) => String(left[field] ?? "").localeCompare(String(right[field] ?? ""), "en"))
    .find((value) => value !== 0) ?? 0;
}

function finalizeSkipped(skipped) {
  const unique = new Map();
  for (const item of skipped) unique.set(`${item.check}\0${item.reason}`, item);
  return [...unique.values()].sort(
    (left, right) =>
      left.check.localeCompare(right.check, "en") ||
      left.reason.localeCompare(right.reason, "en"),
  );
}

function parseThreshold(value, option) {
  const number = parseNumber(value, option);
  if (number <= 0) throw new ExecutionError(`${option} must be greater than zero`);
  return number;
}

function parseNumber(value, option) {
  if (value === undefined || value === "") {
    throw new ExecutionError(`${option} requires a numeric value`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ExecutionError(`${option} must be a finite number`);
  return number;
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right, "en")));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
