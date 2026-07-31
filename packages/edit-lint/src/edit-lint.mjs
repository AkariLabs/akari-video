import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { renderLintReport } from "./report.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";

const VERSION = 1;
const EPSILON = 1e-6;
const USAGE = `Usage: edit-lint <project-root|edit.json path> [--media] [--json]
       [--silence-error-seconds N] [--max-volume-error-db N]
       [--caption-silence-warn-percent N]

Exit codes: 0 PASS, 1 FAIL, 2 execution error`;

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
    const result = await lintProject(options.input, options);
    if (options.json) {
      io.log(JSON.stringify(result, null, 2));
    } else {
      io.log(
        `${result.verdict.toUpperCase()}: ${options.input} (${result.findings.length} findings, ${result.skipped.length} skipped)`,
      );
      for (const finding of result.findings) {
        io.log(
          `- [${finding.severity}] ${finding.check}: ${finding.message}${finding.path ? ` (${finding.path})` : ""}`,
        );
      }
    }
    return result.verdict === "pass" ? 0 : 1;
  } catch (error) {
    io.error(`edit-lint execution error: ${messageOf(error)}`);
    return 2;
  }
}

export async function lintProject(input, options = {}) {
  const paths = await resolveInput(input, options);
  const findings = [];
  const skipped = [];
  const inputs = {};
  const editText = await readRequiredText(paths.editPath, "edit.json");
  inputs.edit_json_sha256 = sha256(editText);

  let edit;
  try {
    edit = JSON.parse(editText);
  } catch (error) {
    throw new ExecutionError(`edit.json is not valid JSON: ${messageOf(error)}`);
  }

  if (isRecord(edit) && Number.isInteger(edit.version) && edit.version >= 2) {
    addFinding(findings, {
      severity: "error",
      check: "edit.version",
      message: `edit.json version ${edit.version} は新しすぎるため検証できません。このファイルは新しい形式です。スキル / アプリを更新してください`,
      path: "edit.json#version",
    });
    addSkipped(
      skipped,
      "edit.validation",
      "a newer edit.json version was detected; no format assumptions were made",
    );
    return writeResult(findings, skipped, inputs, paths, options);
  }

  const analysisState = await readOptionalJson(paths.analysisPath, "analysis.json");
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
      edit.version === 0
        ? "analysis.json is absent; ffprobe is used for source duration"
        : "analysis.json is absent",
    );
  }

  const captionsState = await readOptionalJson(paths.captionsPath, "captions.json");
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

  const reviewState = await readOptionalJson(paths.reviewPath, "review.json");
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

  const intakeState = await readOptionalJson(paths.intakePath, "intake.json");
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
  const referenceState = await validateReferences(edit, findings, paths);
  let sourceDuration =
    edit?.version === 0 ? extractAnalysisDuration(analysisState.value) : null;

  if (
    edit?.version === 0 &&
    sourceDuration === null &&
    sourcePath &&
    referenceState.sourceExists
  ) {
    sourceDuration = probeDuration(sourcePath, options.ffprobeCommand);
  }
  if (edit?.version === 0 && sourceDuration === null) {
    addSkipped(
      skipped,
      "cuts.source-duration",
      sourcePath
        ? "source duration is unavailable because the source reference cannot be read"
        : "source duration is unavailable because source.path is invalid",
    );
  }

  const timeline = validateCuts(
    edit.cuts,
    sourceDuration,
    findings,
    paths,
    edit.version,
    structure.sourceIds,
  );
  validateCutTrackFields(edit.cuts, findings);
  validateCutTransformFields(edit.cuts, findings);
  const cutTrackSegments = computeCutTrackSegments(edit.cuts);
  for (const segment of findTrackOverlaps(cutTrackSegments)) {
    addFinding(findings, {
      severity: "error",
      check: "cuts.track-overlap",
      message: `cut overlaps another cut on track ${segment.track} in the output axis`,
      path: `edit.json#cuts[${segment.index}]`,
      range: { start: segment.start, end: segment.end },
    });
  }
  validateDurationMaximum(edit.outputs, timeline, findings, paths);
  validateOutputAxisDurationMax(edit.outputs, cutTrackSegments, findings);
  await validateOverlays(edit.overlays, timeline, findings, paths);
  await validateNarration(edit?.audio?.narration, timeline, findings, paths);
  await validateBgmSfx(edit?.audio?.bgm, edit?.audio?.sfx, timeline, findings, paths);
  validateSfxTracks(edit?.audio?.sfx, findings);
  validateAudioMaster(edit?.audio?.master, findings, "edit.json#audio.master");
  validateLayerTracks(edit.layers, findings);
  validateBeats(edit.beats, edit.version, structure.sourceIds, findings);
  validateEmphasisWords(edit.emphasis_words, edit.version, structure.sourceIds, findings);
  validateDirection(edit.direction, findings);
  validateTimelineTracks(edit, findings);

  if (captionsState.value !== undefined) {
    validateCaptions(
      captionsState.value,
      edit,
      analysisState.value,
      findings,
      paths,
    );
  }

  if (reviewState.value !== undefined) {
    await validateReview(reviewState.value, edit, findings, paths, skipped);
  }

  if (intakeState.value !== undefined) {
    validateIntake(intakeState.value, findings, paths);
  }

  if (options.media) {
    if (edit?.version === 1) {
      addSkipped(
        skipped,
        "media",
        "media checks currently apply to version 0 source.path only",
      );
    } else if (!sourcePath || !referenceState.sourceExists) {
      addSkipped(skipped, "media", "media checks require a readable source.path");
    } else {
      runMediaChecks(sourcePath, findings, paths, options, captionsState.value);
    }
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
    media: false,
    json: false,
    silenceErrorSeconds: null,
    maxVolumeErrorDb: null,
    captionSilenceWarnPercent: null,
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
    if (argument.startsWith("-")) {
      throw new ExecutionError(`Unknown option: ${argument}`);
    }
    if (input !== null) throw new ExecutionError("Only one input path may be provided");
    input = argument;
  }

  if (input === null) throw new ExecutionError("An input path is required");
  return { input, ...options };
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
  const projectRoot = dirname(editPath);
  return {
    projectRoot,
    editPath,
    analysisPath: join(projectRoot, "analysis.json"),
    captionsPath: join(projectRoot, "captions.json"),
    reviewPath: join(projectRoot, "review.json"),
    intakePath: join(projectRoot, ".akari", "intake.json"),
  };
}

function validateEditStructure(edit, findings, paths) {
  const editRelative = relativePath(paths.projectRoot, paths.editPath);
  if (!isRecord(edit)) {
    addFinding(findings, {
      severity: "error",
      check: "edit.structure",
      message: "edit.json root must be an object",
      path: editRelative,
    });
    return { sourcePath: null, sourceIds: new Set() };
  }
  if (!Number.isInteger(edit.version) || edit.version < 0) {
    structureFinding(findings, editRelative, "version must be a non-negative integer");
  }
  if (!isRecord(edit.output)) {
    structureFinding(findings, editRelative, "output must be an object");
  } else {
    for (const field of ["width", "height", "fps"]) {
      if (!isPositiveNumber(edit.output[field])) {
        structureFinding(findings, editRelative, `output.${field} must be a positive number`);
      }
    }
    validateLook(edit.output.look, findings, "edit.json#output.look");
  }
  const hasSource = Object.hasOwn(edit, "source");
  const hasSources = Object.hasOwn(edit, "sources");
  if (hasSource && hasSources) {
    addFinding(findings, {
      severity: "error",
      check: "edit.sources-exclusive",
      message: "source and sources must not coexist",
      path: editRelative,
    });
  }

  let sourcePath = null;
  const sourceIds = new Set();
  if (edit.version === 0 && !isRecord(edit.source)) {
    structureFinding(findings, editRelative, "version 0 requires source to be an object");
  } else if (isRecord(edit.source)) {
    if (!isNonEmptyString(edit.source.path)) {
      structureFinding(findings, editRelative, "source.path must be a non-empty string");
    } else {
      sourcePath = resolveReference(paths.editPath, edit.source.path);
    }
    if (
      Object.hasOwn(edit.source, "proxy") &&
      edit.source.proxy !== null &&
      !isNonEmptyString(edit.source.proxy)
    ) {
      structureFinding(
        findings,
        editRelative,
        "source.proxy must be null or a non-empty string",
      );
    }
    validateChromaKey(edit.source.chroma_key, findings, "edit.json#source.chroma_key");
  }
  if (edit.version === 0 && hasSources && !hasSource) {
    structureFinding(findings, editRelative, "version 0 does not support sources");
  }

  if (edit.version === 1 && !Array.isArray(edit.sources)) {
    structureFinding(findings, editRelative, "version 1 requires sources to be an array");
  } else if (Array.isArray(edit.sources)) {
    if (edit.sources.length === 0) {
      structureFinding(findings, editRelative, "sources must contain at least one source");
    }
    for (const [index, source] of edit.sources.entries()) {
      const sourceRelative = `edit.json#sources[${index}]`;
      if (!isRecord(source)) {
        structureFinding(findings, sourceRelative, "source must be an object");
        continue;
      }
      if (!isNonEmptyString(source.id)) {
        structureFinding(findings, sourceRelative, "source id must be a non-empty string");
      } else if (sourceIds.has(source.id)) {
        addFinding(findings, {
          severity: "error",
          check: "sources.id",
          message: `duplicate source id: ${source.id}`,
          path: sourceRelative,
        });
      } else {
        sourceIds.add(source.id);
      }
      if (!isNonEmptyString(source.path)) {
        structureFinding(findings, sourceRelative, "source path must be a non-empty string");
      }
      if (
        !Object.hasOwn(source, "proxy") ||
        (source.proxy !== null && !isNonEmptyString(source.proxy))
      ) {
        structureFinding(
          findings,
          sourceRelative,
          "source proxy must be null or a non-empty string",
        );
      }
      validateChromaKey(source.chroma_key, findings, `${sourceRelative}.chroma_key`);
    }
  }
  if (edit.version === 1 && hasSource && !hasSources) {
    structureFinding(findings, editRelative, "version 1 does not support source");
  }
  if (!Array.isArray(edit.cuts)) {
    structureFinding(findings, editRelative, "cuts must be an array");
  }
  if (!Array.isArray(edit.overlays)) {
    structureFinding(findings, editRelative, "overlays must be an array");
  }
  return { sourcePath, sourceIds };
}

// docs/contract-2026-07-22-render-basics.md #4/#2。output.look / source.chroma_key の構造検証は
// validate-edit.mjs の validateLook/validateChromaKey と同じ手書きの流儀（edit-lint は依存ゼロの
// ため他パッケージの検証ロジックを import しない）。
function validateLook(value, findings, path) {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    addFinding(findings, { severity: "error", check: "output.look.structure", message: "look must be an object", path });
    return;
  }
  if (!isNonEmptyString(value.lut)) {
    addFinding(findings, { severity: "error", check: "output.look.lut", message: "lut must be a non-empty string", path });
  }
  if (
    Object.hasOwn(value, "intensity") &&
    (!isFiniteNumber(value.intensity) || value.intensity < 0 || value.intensity > 1)
  ) {
    addFinding(findings, { severity: "error", check: "output.look.intensity", message: "intensity must be a finite number within [0, 1]", path });
  }
}

function validateChromaKey(value, findings, path) {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    addFinding(findings, { severity: "error", check: "chroma-key.structure", message: "chroma_key must be an object", path });
    return;
  }
  if (!isNonEmptyString(value.color)) {
    addFinding(findings, { severity: "error", check: "chroma-key.color", message: "color must be a non-empty string", path });
  }
  for (const field of ["similarity", "blend"]) {
    if (
      Object.hasOwn(value, field) &&
      (!isFiniteNumber(value[field]) || value[field] < 0 || value[field] > 1)
    ) {
      addFinding(findings, { severity: "error", check: `chroma-key.${field}`, message: `${field} must be a finite number within [0, 1]`, path });
    }
  }
  if (Object.hasOwn(value, "background") && !isNonEmptyString(value.background)) {
    addFinding(findings, { severity: "error", check: "chroma-key.background", message: "background must be a non-empty string", path });
  }
}

function validateTransitionOut(value, findings, path) {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    addFinding(findings, { severity: "error", check: "cuts.transition-out.structure", message: "transition_out must be an object", path });
    return;
  }
  if (!["dissolve", "fade-black", "fade-white"].includes(value.type)) {
    addFinding(findings, { severity: "error", check: "cuts.transition-out.type", message: "type must be dissolve/fade-black/fade-white", path });
  }
  if (!isPositiveNumber(value.duration)) {
    addFinding(findings, { severity: "error", check: "cuts.transition-out.duration", message: "duration must be a positive number", path });
  }
}

function validateAudioMaster(value, findings, path) {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    addFinding(findings, { severity: "error", check: "audio.master.structure", message: "master must be an object", path });
    return;
  }
  if (Object.hasOwn(value, "denoise") && !["off", "std", "strong"].includes(value.denoise)) {
    addFinding(findings, { severity: "error", check: "audio.master.denoise", message: "denoise must be off/std/strong", path });
  }
  if (
    Object.hasOwn(value, "loudnorm") &&
    (!isFiniteNumber(value.loudnorm) || value.loudnorm < -70 || value.loudnorm > 0)
  ) {
    addFinding(findings, { severity: "error", check: "audio.master.loudnorm", message: "loudnorm must be a finite number within [-70, 0]", path });
  }
}

// at 省略 = 同一 track 内で直前カットの直後（既存ファイルは全カット track 省略=0・
// at 省略なので、この既定は従来のギャップレス連結と完全に同値 = 後方互換）
function computeCutTrackSegments(cuts) {
  if (!Array.isArray(cuts)) return [];
  const cursorByTrack = new Map();
  const segments = [];
  for (const [index, cut] of cuts.entries()) {
    if (!isRecord(cut) || !isFiniteNumber(cut.in) || !isFiniteNumber(cut.out) || cut.out <= cut.in) {
      continue;
    }
    const hasValidTrack = Object.hasOwn(cut, "track") && Number.isInteger(cut.track) && cut.track >= 0;
    const track = hasValidTrack ? cut.track : 0;
    const duration = cut.out - cut.in;
    const cursor = cursorByTrack.get(track) ?? 0;
    const hasValidAt = Object.hasOwn(cut, "at") && isFiniteNumber(cut.at) && cut.at >= 0;
    const start = hasValidAt ? cut.at : cursor;
    const end = start + duration;
    cursorByTrack.set(track, end);
    segments.push({ index, track, start, end });
  }
  return segments;
}

function findTrackOverlaps(segments) {
  const byTrack = new Map();
  for (const segment of segments) {
    if (!byTrack.has(segment.track)) byTrack.set(segment.track, []);
    byTrack.get(segment.track).push(segment);
  }
  const overlaps = [];
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].start < list[i - 1].end - EPSILON) {
        overlaps.push(list[i]);
      }
    }
  }
  return overlaps;
}

function validateCutTrackFields(cuts, findings) {
  if (!Array.isArray(cuts)) return;
  for (const [index, cut] of cuts.entries()) {
    if (!isRecord(cut)) continue;
    const path = `edit.json#cuts[${index}]`;
    if (Object.hasOwn(cut, "at") && (!isFiniteNumber(cut.at) || cut.at < 0)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.at",
        message: "at must be a non-negative finite number when present",
        path: `${path}.at`,
      });
    }
    if (Object.hasOwn(cut, "track") && (!Number.isInteger(cut.track) || cut.track < 0)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.track",
        message: "cut track must be a non-negative integer when present",
        path: `${path}.track`,
      });
    }
  }
}

function validateCutTransformFields(cuts, findings) {
  if (!Array.isArray(cuts)) return;
  for (const [index, cut] of cuts.entries()) {
    if (!isRecord(cut)) continue;
    const path = `edit.json#cuts[${index}]`;
    if (
      Object.hasOwn(cut, "opacity") &&
      (!isFiniteNumber(cut.opacity) || cut.opacity < 0 || cut.opacity > 1)
    ) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.opacity",
        message: "opacity must be a finite number between 0 and 1 when present",
        path: `${path}.opacity`,
      });
    }
    if (!Object.hasOwn(cut, "transform")) continue;
    if (!isRecord(cut.transform)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.transform",
        message: "transform must be an object when present",
        path: `${path}.transform`,
      });
      continue;
    }
    const allowedKeys = new Set(["x", "y", "scale", "rotate"]);
    for (const key of Object.keys(cut.transform)) {
      if (!allowedKeys.has(key)) {
        addFinding(findings, {
          severity: "error",
          check: "cuts.transform",
          message: `transform has an unknown key: ${key}`,
          path: `${path}.transform`,
        });
      }
    }
    for (const field of ["x", "y", "rotate"]) {
      if (Object.hasOwn(cut.transform, field) && !isFiniteNumber(cut.transform[field])) {
        addFinding(findings, {
          severity: "error",
          check: "cuts.transform",
          message: `transform.${field} must be a finite number when present`,
          path: `${path}.transform.${field}`,
        });
      }
    }
    if (Object.hasOwn(cut.transform, "scale") && !isPositiveNumber(cut.transform.scale)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.transform",
        message: "transform.scale must be a positive number when present",
        path: `${path}.transform.scale`,
      });
    }
  }
}

function validateOutputAxisDurationMax(outputs, cutSegments, findings) {
  if (!Array.isArray(outputs) || cutSegments.length === 0) return;
  const maxEnd = cutSegments.reduce((max, segment) => Math.max(max, segment.end), 0);
  for (const [index, output] of outputs.entries()) {
    if (!isRecord(output) || !Object.hasOwn(output, "duration_max")) continue;
    const maximum = output.duration_max;
    if (!isPositiveNumber(maximum)) continue;
    if (maxEnd > maximum + EPSILON) {
      addFinding(findings, {
        severity: "warning",
        check: "outputs.duration-max-gaps",
        message: `output axis duration ${formatNumber(maxEnd)}s (accounting for cuts[].at gaps/tracks) exceeds duration_max ${formatNumber(maximum)}s`,
        path: `edit.json#outputs[${index}].duration_max`,
      });
    }
  }
}

function validateLayerTracks(layers, findings) {
  if (!Array.isArray(layers)) return;
  const segments = [];
  layers.forEach((layer, index) => {
    if (!isRecord(layer)) return;
    const path = `edit.json#layers[${index}]`;
    if (Object.hasOwn(layer, "track") && (!Number.isInteger(layer.track) || layer.track < 0)) {
      addFinding(findings, {
        severity: "error",
        check: "layers.track",
        message: "layer track must be a non-negative integer when present",
        path: `${path}.track`,
      });
      return;
    }
    if (!isFiniteNumber(layer.t) || !isPositiveNumber(layer.duration)) return;
    const hasValidTrack = Object.hasOwn(layer, "track") && Number.isInteger(layer.track) && layer.track >= 0;
    const track = hasValidTrack ? layer.track : 0;
    segments.push({ index, track, start: layer.t, end: layer.t + layer.duration });
  });
  for (const segment of findTrackOverlaps(segments)) {
    addFinding(findings, {
      severity: "warning",
      check: "layers.track-overlap",
      message: `layer overlaps another layer on track ${segment.track} in the output axis`,
      path: `edit.json#layers[${segment.index}]`,
      range: { start: segment.start, end: segment.end },
    });
  }
}

// sfx には duration が無い（瞬間マーカー）ため、「重なり」は同一 track かつ
// 実質同一 t（EPSILON 以内）に退化させる。
function validateSfxTracks(sfx, findings) {
  if (!Array.isArray(sfx)) return;
  const pointsByTrack = new Map();
  sfx.forEach((item, index) => {
    if (!isRecord(item)) return;
    const path = `edit.json#audio.sfx[${index}]`;
    if (Object.hasOwn(item, "track") && (!Number.isInteger(item.track) || item.track < 0)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.sfx.track",
        message: "sfx track must be a non-negative integer when present",
        path: `${path}.track`,
      });
      return;
    }
    if (!isFiniteNumber(item.t)) return;
    const hasValidTrack = Object.hasOwn(item, "track") && Number.isInteger(item.track) && item.track >= 0;
    const track = hasValidTrack ? item.track : 0;
    if (!pointsByTrack.has(track)) pointsByTrack.set(track, []);
    pointsByTrack.get(track).push({ index, t: item.t });
  });
  for (const list of pointsByTrack.values()) {
    list.sort((a, b) => a.t - b.t);
    for (let i = 1; i < list.length; i += 1) {
      if (Math.abs(list[i].t - list[i - 1].t) <= EPSILON) {
        addFinding(findings, {
          severity: "warning",
          check: "audio.sfx.track-overlap",
          message: "sfx item shares the same track and t as another sfx item",
          path: `edit.json#audio.sfx[${list[i].index}]`,
          range: { start: list[i].t, end: list[i].t },
        });
      }
    }
  }
}

function validateTimelineTracks(edit, findings) {
  const timeline = edit?.timeline;
  if (timeline === undefined || timeline === null) return;
  if (!isRecord(timeline)) {
    addFinding(findings, {
      severity: "error",
      check: "timeline.tracks.structure",
      message: "timeline must be an object",
      path: "edit.json#timeline",
    });
    return;
  }
  if (!Array.isArray(timeline.tracks)) {
    addFinding(findings, {
      severity: "error",
      check: "timeline.tracks.structure",
      message: "timeline.tracks must be an array",
      path: "edit.json#timeline.tracks",
    });
    return;
  }

  const actualTracks = new Map([
    ["cuts", collectActualTrackNumbers(edit?.cuts)],
    ["layers", collectActualTrackNumbers(edit?.layers)],
    ["overlays", collectActualTrackNumbers(edit?.overlays)],
    ["audio", collectActualTrackNumbers(edit?.audio?.sfx)],
  ]);
  const allowedKinds = new Set(["cuts", "layers", "overlays", "captions", "audio"]);
  const ids = new Set();
  const declarations = new Set();
  const singletonCounts = new Map();

  for (const [index, item] of timeline.tracks.entries()) {
    const path = `edit.json#timeline.tracks[${index}]`;
    if (!isRecord(item)) {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.structure",
        message: "timeline track must be an object",
        path,
      });
      continue;
    }

    if (!isNonEmptyString(item.id)) {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.id",
        message: "timeline track id must be a non-empty string",
        path: `${path}.id`,
      });
    } else if (ids.has(item.id)) {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.id",
        message: `duplicate timeline track id: ${item.id}`,
        path: `${path}.id`,
      });
    } else {
      ids.add(item.id);
    }

    if (!allowedKinds.has(item.kind)) {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.kind",
        message: "timeline track kind must be cuts/layers/overlays/captions/audio",
        path: `${path}.kind`,
      });
      continue;
    }

    const hasRef = Object.hasOwn(item, "ref");
    const validRef = !hasRef || (Number.isInteger(item.ref) && item.ref >= 0);
    if (!validRef) {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.ref",
        message: "timeline track ref must be a non-negative integer when present",
        path: `${path}.ref`,
      });
    }
    if (Object.hasOwn(item, "label") && typeof item.label !== "string") {
      addFinding(findings, {
        severity: "error",
        check: "timeline.tracks.label",
        message: "timeline track label must be a string when present",
        path: `${path}.label`,
      });
    }
    for (const field of ["muted", "hidden", "locked"]) {
      if (Object.hasOwn(item, field) && typeof item[field] !== "boolean") {
        addFinding(findings, {
          severity: "error",
          check: `timeline.tracks.${field}`,
          message: `timeline track ${field} must be a boolean when present`,
          path: `${path}.${field}`,
        });
      }
    }

    // audio は R6 契約 §1 裁定 2（2026-07-25）で複数トラック化された。宣言ごとの ref が
    // 異なる限り複数宣言は正常な運用のため、singleton warning の対象からは除外する
    // （captions は引き続き単一トラック運用のため維持）。
    if (item.kind === "captions") {
      const count = (singletonCounts.get(item.kind) ?? 0) + 1;
      singletonCounts.set(item.kind, count);
      if (count > 1) {
        addFinding(findings, {
          severity: "warning",
          check: "timeline.tracks.singleton",
          message: `${item.kind} timeline track is declared more than once`,
          path,
        });
      }
    }

    if (!validRef || item.kind === "captions") continue;
    // audio の ref は R6 契約 §1 裁定 2（2026-07-25）で複数トラック化されたため、
    // 0 固定を要求しない（非 0 ref も正当な宣言として declarations に加える）。
    const ref = item.kind === "audio" && !hasRef ? 0 : item.ref;
    if (ref === undefined) continue;
    declarations.add(`${item.kind}:${ref}`);
    if (!actualTracks.get(item.kind)?.has(ref)) {
      addFinding(findings, {
        severity: "warning",
        check: "timeline.tracks.ref-missing",
        message: `${item.kind} timeline track ref ${ref} is not used by edit data`,
        path: `${path}.ref`,
      });
    }
  }

  for (const [kind, tracks] of actualTracks) {
    for (const ref of tracks) {
      if (declarations.has(`${kind}:${ref}`)) continue;
      addFinding(findings, {
        severity: "warning",
        check: "timeline.tracks.declaration-missing",
        message: `${kind} edit data uses track ${ref}, but timeline.tracks has no matching declaration`,
        path: `edit.json#${kind === "audio" ? "audio.sfx" : kind}`,
      });
    }
  }
}

function collectActualTrackNumbers(items) {
  const tracks = new Set();
  if (!Array.isArray(items)) return tracks;
  for (const item of items) {
    if (!isRecord(item)) continue;
    if (!Object.hasOwn(item, "track")) {
      tracks.add(0);
    } else if (Number.isInteger(item.track) && item.track >= 0) {
      tracks.add(item.track);
    }
  }
  return tracks;
}

function validateCuts(cuts, sourceDuration, findings, paths, version, sourceIds) {
  if (!Array.isArray(cuts)) return null;
  let valid = true;
  let previousIn = -Infinity;
  let previousOut = -Infinity;
  let timeline = 0;

  for (const [index, cut] of cuts.entries()) {
    const path = `edit.json#cuts[${index}]`;
    if (!isRecord(cut) || !isFiniteNumber(cut.in) || !isFiniteNumber(cut.out)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.range",
        message: "cut in/out must be finite numbers",
        path,
      });
      valid = false;
      continue;
    }
    if (cut.in < 0 || cut.out <= cut.in) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.range",
        message: "cut must satisfy 0 <= in < out",
        path,
        range: { start: cut.in, end: cut.out },
      });
      valid = false;
    } else {
      timeline += cut.out - cut.in;
    }
    if (version === 1) {
      if (!isNonEmptyString(cut.src)) {
        addFinding(findings, {
          severity: "error",
          check: "cuts.src",
          message: "version 1 cut src must be a non-empty string",
          path,
        });
        valid = false;
      } else if (!sourceIds.has(cut.src)) {
        addFinding(findings, {
          severity: "error",
          check: "cuts.src-reference",
          message: `cut src does not reference sources[].id: ${cut.src}`,
          path,
        });
        valid = false;
      }
    } else if (Object.hasOwn(cut, "src")) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.src",
        message: "version 0 cut must not contain src",
        path,
      });
      valid = false;
    }
    if (version === 0 && cut.in < previousIn - EPSILON) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.order",
        message: "cuts must be sorted by in time",
        path,
        range: { start: cut.in, end: cut.out },
      });
      valid = false;
    }
    if (version === 0 && cut.in < previousOut - EPSILON) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.overlap",
        message: "cuts must not overlap",
        path,
        range: { start: cut.in, end: cut.out },
      });
      valid = false;
    }
    if (sourceDuration !== null && cut.out > sourceDuration + EPSILON) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.source-duration",
        message: `cut ends after source duration ${formatNumber(sourceDuration)}s`,
        path,
        range: { start: cut.in, end: cut.out },
      });
      valid = false;
    }
    if (Object.hasOwn(cut, "speed") && !isPositiveNumber(cut.speed)) {
      addFinding(findings, {
        severity: "error",
        check: "cuts.speed",
        message: "speed must be a positive number",
        path,
      });
      valid = false;
    }
    validateTransitionOut(cut.transition_out, findings, `${path}.transition_out`);
    previousIn = cut.in;
    previousOut = cut.out;
  }

  if (cuts.length === 0) return version === 1 ? 0 : sourceDuration;
  return valid ? timeline : null;
}

function validateDurationMaximum(outputs, timeline, findings) {
  if (outputs === undefined) return;
  if (!Array.isArray(outputs)) {
    addFinding(findings, {
      severity: "error",
      check: "outputs.duration-max",
      message: "outputs must be an array when present",
      path: "edit.json#outputs",
    });
    return;
  }
  for (const [index, output] of outputs.entries()) {
    if (!isRecord(output) || !Object.hasOwn(output, "duration_max")) continue;
    const maximum = output.duration_max;
    if (!isPositiveNumber(maximum)) {
      addFinding(findings, {
        severity: "error",
        check: "outputs.duration-max",
        message: "duration_max must be a positive number",
        path: `edit.json#outputs[${index}].duration_max`,
      });
    } else if (timeline !== null && timeline > maximum + EPSILON) {
      addFinding(findings, {
        severity: "error",
        check: "outputs.duration-max",
        message: `timeline duration ${formatNumber(timeline)}s exceeds duration_max ${formatNumber(maximum)}s`,
        path: `edit.json#outputs[${index}].duration_max`,
        range: { start: 0, end: timeline },
      });
    }
  }
}

async function validateOverlays(overlays, timeline, findings, paths) {
  if (!Array.isArray(overlays)) return;
  const ids = new Set();
  for (const [index, overlay] of overlays.entries()) {
    const itemPath = `edit.json#overlays[${index}]`;
    if (!isRecord(overlay)) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.structure",
        message: "overlay must be an object",
        path: itemPath,
      });
      continue;
    }
    if (!isNonEmptyString(overlay.id)) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.id",
        message: "overlay id must be a non-empty string",
        path: itemPath,
      });
    } else if (ids.has(overlay.id)) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.id",
        message: `duplicate overlay id: ${overlay.id}`,
        path: itemPath,
      });
    } else {
      ids.add(overlay.id);
    }

    if (
      Object.hasOwn(overlay, "track") &&
      (!Number.isInteger(overlay.track) || overlay.track < 0)
    ) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.track",
        message: "overlay track must be a non-negative integer when present",
        path: `${itemPath}.track`,
      });
    }

    if (!isFiniteNumber(overlay.start) || overlay.start < 0) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.timeline",
        message: "overlay start must be a non-negative finite number",
        path: itemPath,
      });
    }
    if (!isPositiveNumber(overlay.duration)) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.timeline",
        message: "overlay duration must be greater than zero",
        path: itemPath,
      });
    }
    if (
      timeline !== null &&
      isFiniteNumber(overlay.start) &&
      isPositiveNumber(overlay.duration) &&
      overlay.start + overlay.duration > timeline + EPSILON
    ) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.timeline",
        message: `overlay ends after timeline duration ${formatNumber(timeline)}s`,
        path: itemPath,
        range: { start: overlay.start, end: overlay.start + overlay.duration },
      });
    }
    if (!isNonEmptyString(overlay.html)) continue;
    const htmlPath = resolveReference(paths.editPath, overlay.html);
    if (!(await isRegularFile(htmlPath))) continue;

    const html = await readRequiredText(htmlPath, overlay.html);
    const fragment = inspectHtmlFragment(html);
    if (fragment.rootCount !== 1 || fragment.hasTopLevelText || fragment.unbalanced) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.html-root",
        message: "overlay HTML must contain exactly one balanced root element",
        path: relativePath(paths.projectRoot, htmlPath),
      });
      continue;
    }
    for (const [attribute, expected] of [
      ["data-start", overlay.start],
      ["data-duration", overlay.duration],
    ]) {
      const actualText = fragment.rootAttributes[attribute];
      if (actualText === undefined) continue;
      const actual = Number(actualText);
      if (!Number.isFinite(actual) || !numbersEqual(actual, expected)) {
        addFinding(findings, {
          severity: "error",
          check: "overlays.data-attributes",
          message: `${attribute} must match edit.json value ${formatNumber(expected)}`,
          path: relativePath(paths.projectRoot, htmlPath),
        });
      }
    }
  }
}

async function validateNarration(narration, timeline, findings, paths) {
  if (narration === undefined) return;
  if (!Array.isArray(narration)) {
    addFinding(findings, {
      severity: "error",
      check: "audio.narration.structure",
      message: "audio.narration must be an array",
      path: "edit.json#audio.narration",
    });
    return;
  }

  const tCounts = new Map();
  for (const item of narration) {
    if (isRecord(item) && isFiniteNumber(item.t)) {
      tCounts.set(item.t, (tCounts.get(item.t) ?? 0) + 1);
    }
  }

  const ids = new Set();
  for (const [index, item] of narration.entries()) {
    const itemPath = `edit.json#audio.narration[${index}]`;
    if (!isRecord(item)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.structure",
        message: "narration item must be an object",
        path: itemPath,
      });
      continue;
    }

    if (typeof item.id !== "string" || !/^n-\d{4}$/.test(item.id)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.id",
        message: "id must match n- followed by four digits",
        path: itemPath,
      });
    } else if (ids.has(item.id)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.id",
        message: `duplicate narration id: ${item.id}`,
        path: itemPath,
      });
    } else {
      ids.add(item.id);
    }

    if (!isNonEmptyString(item.path)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.path",
        message: "path must be a non-empty string",
        path: itemPath,
      });
    } else {
      const filePath = resolveReference(paths.editPath, item.path);
      if (!(await isRegularFile(filePath))) {
        addFinding(findings, {
          severity: "warning",
          check: "audio.narration.file",
          message: `narration path does not resolve to a regular file: ${item.path}`,
          path: relativePath(paths.projectRoot, filePath),
        });
      }
    }

    if (!isFiniteNumber(item.t) || item.t < 0) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.t",
        message: "t must be a non-negative finite number",
        path: itemPath,
      });
    } else {
      if (timeline !== null && item.t > timeline + EPSILON) {
        addFinding(findings, {
          severity: "warning",
          check: "audio.narration.timeline",
          message: `t ${formatNumber(item.t)}s exceeds timeline duration ${formatNumber(timeline)}s`,
          path: itemPath,
          range: { start: item.t, end: item.t },
        });
      }
      if ((tCounts.get(item.t) ?? 0) > 1) {
        addFinding(findings, {
          severity: "warning",
          check: "audio.narration.duplicate-t",
          message: `multiple narration items share the same t: ${formatNumber(item.t)}s`,
          path: itemPath,
          range: { start: item.t, end: item.t },
        });
      }
    }

    if (
      Object.hasOwn(item, "gain_db") &&
      (!isFiniteNumber(item.gain_db) || item.gain_db < -60 || item.gain_db > 12)
    ) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.gain-db",
        message: "gain_db must be a finite number within [-60, 12]",
        path: itemPath,
      });
    }

    if (!isRecord(item.provenance)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.provenance",
        message: "provenance is required and must be an object",
        path: itemPath,
      });
    } else if (!isNonEmptyString(item.provenance.provider)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.provenance",
        message: "provenance.provider must be a non-empty string",
        path: itemPath,
      });
    } else if (
      item.provenance.provider === "voicevox" &&
      !isNonEmptyString(item.provenance.credit)
    ) {
      addFinding(findings, {
        severity: "error",
        check: "audio.narration.credit",
        message: "provenance.credit is required when provider is voicevox",
        path: itemPath,
      });
    }
  }
}

// docs/contract-2026-07-22-edit-json-v1-beats.md §7: beats（見せ場マーカー）の構造検証は
// validate-edit.mjs と同一のルールを手書きで写す流儀（edit-lint は依存ゼロのため他パッケージの
// バリデータを import しない）。beats[].t は timeline 秒ではなく source 秒アンカー（同 §3）であり、
// source 実尺との突き合わせは --media なしでデコードしない規律のため行わない（同 §7 の将来課題）。
// beats フィールドの不在はエラーにしない（同 §4 の劣化規約）。
function validateBeats(beats, version, sourceIds, findings) {
  if (beats === undefined) return;
  if (!Array.isArray(beats)) {
    addFinding(findings, {
      severity: "error",
      check: "beats.structure",
      message: "beats must be an array",
      path: "edit.json#beats",
    });
    return;
  }

  const ids = new Set();
  for (const [index, item] of beats.entries()) {
    const itemPath = `edit.json#beats[${index}]`;
    if (!isRecord(item)) {
      addFinding(findings, {
        severity: "error",
        check: "beats.structure",
        message: "beat item must be an object",
        path: itemPath,
      });
      continue;
    }

    if (typeof item.id !== "string" || !/^b-\d{4}$/.test(item.id)) {
      addFinding(findings, {
        severity: "error",
        check: "beats.id",
        message: "id must match b- followed by four digits",
        path: itemPath,
      });
    } else if (ids.has(item.id)) {
      addFinding(findings, {
        severity: "error",
        check: "beats.id",
        message: `duplicate beat id: ${item.id}`,
        path: itemPath,
      });
    } else {
      ids.add(item.id);
    }

    if (!isFiniteNumber(item.t) || item.t < 0) {
      addFinding(findings, {
        severity: "error",
        check: "beats.t",
        message: "t must be a non-negative finite number (source seconds)",
        path: itemPath,
      });
    }

    if (!isNonEmptyString(item.kind)) {
      addFinding(findings, {
        severity: "error",
        check: "beats.kind",
        message: "kind must be a non-empty string",
        path: itemPath,
      });
    }

    if (!isFiniteNumber(item.strength) || item.strength < 0 || item.strength > 1) {
      addFinding(findings, {
        severity: "error",
        check: "beats.strength",
        message: "strength must be a finite number within [0, 1]",
        path: itemPath,
      });
    }

    if (Object.hasOwn(item, "basis") && typeof item.basis !== "string") {
      addFinding(findings, {
        severity: "error",
        check: "beats.basis",
        message: "basis must be a string",
        path: itemPath,
      });
    }

    if (Object.hasOwn(item, "src")) {
      if (version === 0) {
        addFinding(findings, {
          severity: "error",
          check: "beats.src",
          message: "src is not available in version 0 (no sources[] to reference)",
          path: itemPath,
        });
      } else if (!isNonEmptyString(item.src)) {
        addFinding(findings, {
          severity: "error",
          check: "beats.src",
          message: "src must be a non-empty string",
          path: itemPath,
        });
      } else if (!sourceIds.has(item.src)) {
        addFinding(findings, {
          severity: "error",
          check: "beats.src-reference",
          message: `src does not reference sources[].id: ${item.src}`,
          path: itemPath,
        });
      }
    }
  }
}

// docs/contract-2026-07-23-edit-json-v1-emphasis-words.md §7: emphasis_words（語レベル演出）の
// 構造検証は validate-edit.mjs と同一のルールを手書きで写す流儀（edit-lint は依存ゼロのため他パッケージの
// バリデータを import しない）。t_start/t_end は timeline 秒ではなく source 秒アンカー（同 §3）であり、
// source 実尺との突き合わせは --media なしでデコードしない規律のため行わない（同 §7 の将来課題）。
// 各要素は素材ファイルを参照しないためファイル実在チェックも行わない。
// emphasis_words フィールドの不在はエラーにしない（同 §5 の劣化規約）。
function validateEmphasisWords(emphasisWords, version, sourceIds, findings) {
  if (emphasisWords === undefined) return;
  if (!Array.isArray(emphasisWords)) {
    addFinding(findings, {
      severity: "error",
      check: "emphasis_words.structure",
      message: "emphasis_words must be an array",
      path: "edit.json#emphasis_words",
    });
    return;
  }

  const ids = new Set();
  for (const [index, item] of emphasisWords.entries()) {
    const itemPath = `edit.json#emphasis_words[${index}]`;
    if (!isRecord(item)) {
      addFinding(findings, {
        severity: "error",
        check: "emphasis_words.structure",
        message: "emphasis word item must be an object",
        path: itemPath,
      });
      continue;
    }

    if (typeof item.id !== "string" || !/^e-\d{4}$/.test(item.id)) {
      addFinding(findings, {
        severity: "error",
        check: "emphasis_words.id",
        message: "id must match e- followed by four digits",
        path: itemPath,
      });
    } else if (ids.has(item.id)) {
      addFinding(findings, {
        severity: "error",
        check: "emphasis_words.id",
        message: `duplicate emphasis word id: ${item.id}`,
        path: itemPath,
      });
    } else {
      ids.add(item.id);
    }

    const hasStart = isFiniteNumber(item.t_start) && item.t_start >= 0;
    const hasEnd = isFiniteNumber(item.t_end) && item.t_end >= 0;
    if (!hasStart) {
      addFinding(findings, {
        severity: "error",
        check: "emphasis_words.t_start",
        message: "t_start must be a non-negative finite number (source seconds)",
        path: itemPath,
      });
    }
    if (!hasEnd) {
      addFinding(findings, {
        severity: "error",
        check: "emphasis_words.t_end",
        message: "t_end must be a non-negative finite number (source seconds)",
        path: itemPath,
      });
    }
    if (hasStart && hasEnd && item.t_end <= item.t_start) {
      addFinding(findings, {
        severity: "error",
        check: "emphasis_words.range",
        message: "t_end must be greater than t_start",
        path: itemPath,
        range: { start: item.t_start, end: item.t_end },
      });
    }

    if (!isNonEmptyString(item.word)) {
      addFinding(findings, {
        severity: "error",
        check: "emphasis_words.word",
        message: "word must be a non-empty string",
        path: itemPath,
      });
    }

    if (!isNonEmptyString(item.emotion)) {
      addFinding(findings, {
        severity: "error",
        check: "emphasis_words.emotion",
        message: "emotion must be a non-empty string",
        path: itemPath,
      });
    }

    if (Object.hasOwn(item, "style_hint") && typeof item.style_hint !== "string") {
      addFinding(findings, {
        severity: "error",
        check: "emphasis_words.style-hint",
        message: "style_hint must be a string",
        path: itemPath,
      });
    }

    if (Object.hasOwn(item, "src")) {
      if (version === 0) {
        addFinding(findings, {
          severity: "error",
          check: "emphasis_words.src",
          message: "src is not available in version 0 (no sources[] to reference)",
          path: itemPath,
        });
      } else if (!isNonEmptyString(item.src)) {
        addFinding(findings, {
          severity: "error",
          check: "emphasis_words.src",
          message: "src must be a non-empty string",
          path: itemPath,
        });
      } else if (!sourceIds.has(item.src)) {
        addFinding(findings, {
          severity: "error",
          check: "emphasis_words.src-reference",
          message: `src does not reference sources[].id: ${item.src}`,
          path: itemPath,
        });
      }
    }
  }
}

// docs/contract-2026-07-23-edit-json-v1-direction.md §6: direction（演出宣言）の構造検証は
// validate-edit.mjs と同一のルールを手書きで写す流儀（edit-lint は依存ゼロのため他パッケージの
// バリデータを import しない）。direction は配列ではなくオブジェクト = 宣言はファイルに 1 つ（同 §1）。
// preset の値が実在するプリセットかは検証しない（enum 強制をしないため・同 §6）。
// overrides は語彙が未定義のため object であることだけを見る。
// direction フィールドの不在はエラーにしない（同 §5 の劣化規約）。
function validateDirection(direction, findings) {
  if (direction === undefined) return;
  if (!isRecord(direction)) {
    addFinding(findings, {
      severity: "error",
      check: "direction.structure",
      message: "direction must be an object",
      path: "edit.json#direction",
    });
    return;
  }

  if (!isNonEmptyString(direction.preset)) {
    addFinding(findings, {
      severity: "error",
      check: "direction.preset",
      message: "preset must be a non-empty string",
      path: "edit.json#direction",
    });
  }

  if (Object.hasOwn(direction, "intensity")) {
    if (
      !Number.isInteger(direction.intensity) ||
      direction.intensity < 0 ||
      direction.intensity > 100
    ) {
      addFinding(findings, {
        severity: "error",
        check: "direction.intensity",
        message: "intensity must be an integer within [0, 100]",
        path: "edit.json#direction",
      });
    }
  }

  if (Object.hasOwn(direction, "overrides") && !isRecord(direction.overrides)) {
    addFinding(findings, {
      severity: "error",
      check: "direction.overrides",
      message: "overrides must be an object",
      path: "edit.json#direction",
    });
  }
}

// docs/contract-2026-07-14-edit-json-v1-audio.md §1/§5: bgm/sfx の構造検証は narration と
// 同じ手書きの流儀。ファイル実在欠落は「装飾・欠落は警告」の劣化規約どおり warning に留める
// （validateReferences の一律 error 経路には audio.bgm/sfx を含めない）。
async function validateBgmSfx(bgm, sfx, timeline, findings, paths) {
  // docs/contract-2026-07-14-edit-json-v1-audio.md §1 says omission means "no BGM"; real
  // edit.json data (fieldtest/2026-07-14) spells that as an explicit `"bgm": null` rather than
  // omitting the key -- the same tolerant-reader convention already used for source.proxy.
  if (bgm !== undefined && bgm !== null) {
    if (!isRecord(bgm)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.bgm.structure",
        message: "audio.bgm must be an object",
        path: "edit.json#audio.bgm",
      });
    } else {
      if (!isNonEmptyString(bgm.path)) {
        addFinding(findings, {
          severity: "error",
          check: "audio.bgm.path",
          message: "path must be a non-empty string",
          path: "edit.json#audio.bgm",
        });
      } else {
        const filePath = resolveReference(paths.editPath, bgm.path);
        if (!(await isRegularFile(filePath))) {
          addFinding(findings, {
            severity: "warning",
            check: "audio.bgm.file",
            message: `bgm path does not resolve to a regular file: ${bgm.path}`,
            path: relativePath(paths.projectRoot, filePath),
          });
        }
      }
      if (
        Object.hasOwn(bgm, "gain_db") &&
        (!isFiniteNumber(bgm.gain_db) || bgm.gain_db < -60 || bgm.gain_db > 12)
      ) {
        addFinding(findings, {
          severity: "error",
          check: "audio.bgm.gain-db",
          message: "gain_db must be a finite number within [-60, 12]",
          path: "edit.json#audio.bgm",
        });
      }
      if (Object.hasOwn(bgm, "ducking") && typeof bgm.ducking !== "boolean") {
        addFinding(findings, {
          severity: "error",
          check: "audio.bgm.ducking",
          message: "ducking must be a boolean",
          path: "edit.json#audio.bgm",
        });
      }
      // audio.bgm.fadeIn/fadeOut clamp rule: render-cut trims/loops bgm to the full timeline, so
      // fadeIn/fadeOut are each independently clamped there at timeline/2 -- warn here so the same
      // overshoot is visible before rendering.
      for (const field of ["fadeIn", "fadeOut"]) {
        if (!Object.hasOwn(bgm, field)) continue;
        if (!isFiniteNumber(bgm[field]) || bgm[field] < 0) {
          addFinding(findings, {
            severity: "error",
            check: `audio.bgm.${field}`,
            message: `${field} must be a non-negative finite number`,
            path: "edit.json#audio.bgm",
          });
        } else if (timeline !== null && bgm[field] > timeline / 2 + EPSILON) {
          addFinding(findings, {
            severity: "warning",
            check: `audio.bgm.${field}`,
            message: `${field} ${formatNumber(bgm[field])}s exceeds half the timeline duration ${formatNumber(timeline)}s; will be clamped to ${formatNumber(timeline / 2)}s at render time`,
            path: "edit.json#audio.bgm",
          });
        }
      }
    }
  }

  if (sfx === undefined || sfx === null) return;
  if (!Array.isArray(sfx)) {
    addFinding(findings, {
      severity: "error",
      check: "audio.sfx.structure",
      message: "audio.sfx must be an array",
      path: "edit.json#audio.sfx",
    });
    return;
  }
  for (const [index, item] of sfx.entries()) {
    const itemPath = `edit.json#audio.sfx[${index}]`;
    if (!isRecord(item)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.sfx.structure",
        message: "sfx item must be an object",
        path: itemPath,
      });
      continue;
    }
    if (!isNonEmptyString(item.path)) {
      addFinding(findings, {
        severity: "error",
        check: "audio.sfx.path",
        message: "path must be a non-empty string",
        path: itemPath,
      });
    } else {
      const filePath = resolveReference(paths.editPath, item.path);
      if (!(await isRegularFile(filePath))) {
        addFinding(findings, {
          severity: "warning",
          check: "audio.sfx.file",
          message: `sfx path does not resolve to a regular file: ${item.path}`,
          path: relativePath(paths.projectRoot, filePath),
        });
      }
    }
    if (!isFiniteNumber(item.t) || item.t < 0) {
      addFinding(findings, {
        severity: "error",
        check: "audio.sfx.t",
        message: "t must be a non-negative finite number",
        path: itemPath,
      });
    } else if (timeline !== null && item.t > timeline + EPSILON) {
      addFinding(findings, {
        severity: "warning",
        check: "audio.sfx.timeline",
        message: `t ${formatNumber(item.t)}s exceeds timeline duration ${formatNumber(timeline)}s`,
        path: itemPath,
        range: { start: item.t, end: item.t },
      });
    }
    if (
      Object.hasOwn(item, "gain_db") &&
      (!isFiniteNumber(item.gain_db) || item.gain_db < -60 || item.gain_db > 12)
    ) {
      addFinding(findings, {
        severity: "error",
        check: "audio.sfx.gain-db",
        message: "gain_db must be a finite number within [-60, 12]",
        path: itemPath,
      });
    }
    // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: in/out はどちらも省略可（片方のみの
    // 指定は valid）で、型不正（負値・非数値）は schema 側（edit.schema.json + validate-edit.mjs）が
    // 拒否する。edit-lint はスキーマ単体では表せない兄弟値の関係（out > in）だけをここで検証する
    // （cuts[].out > in と同じ分担 — cuts.range 参照）。
    if (
      Object.hasOwn(item, "in") &&
      Object.hasOwn(item, "out") &&
      isFiniteNumber(item.in) &&
      isFiniteNumber(item.out) &&
      item.out <= item.in
    ) {
      addFinding(findings, {
        severity: "error",
        check: "audio.sfx.in-out",
        message: "sfx must satisfy in < out when both are present",
        path: itemPath,
        range: { start: item.in, end: item.out },
      });
    }
  }
}

async function validateReferences(edit, findings, paths) {
  const references = [];
  if (isRecord(edit?.source)) {
    references.push({ label: "source.path", value: edit.source.path, source: true });
    if (edit.source.proxy !== null && edit.source.proxy !== undefined) {
      references.push({ label: "source.proxy", value: edit.source.proxy });
    }
  }
  if (Array.isArray(edit?.sources)) {
    for (const [index, source] of edit.sources.entries()) {
      if (!isRecord(source)) continue;
      references.push({
        label: `sources[${index}].path`,
        value: source.path,
      });
      if (source.proxy !== null && source.proxy !== undefined) {
        references.push({
          label: `sources[${index}].proxy`,
          value: source.proxy,
        });
      }
    }
  }
  if (Array.isArray(edit?.overlays)) {
    for (const [index, overlay] of edit.overlays.entries()) {
      references.push({
        label: `overlays[${index}].html`,
        value: overlay?.html,
      });
    }
  }
  if (isRecord(edit?.thumbnail)) {
    references.push({ label: "thumbnail.path", value: edit.thumbnail.path });
  }

  let sourceExists = false;
  for (const reference of references) {
    if (!isNonEmptyString(reference.value)) {
      addFinding(findings, {
        severity: "error",
        check: "references.files",
        message: `${reference.label} must be a non-empty file path`,
        path: `edit.json#${reference.label}`,
      });
      continue;
    }
    const filePath = resolveReference(paths.editPath, reference.value);
    const exists = await isRegularFile(filePath);
    if (reference.source) sourceExists = exists;
    if (!exists) {
      addFinding(findings, {
        severity: "error",
        check: "references.files",
        message: `${reference.label} does not resolve to a regular file`,
        path: relativePath(paths.projectRoot, filePath),
      });
    }
  }
  return { sourceExists };
}

function validateCaptions(captions, edit, analysis, findings, paths) {
  const captionPath = relativePath(paths.projectRoot, paths.captionsPath);
  if (!Array.isArray(captions)) {
    if (!isRecord(captions)) {
      addFinding(findings, {
        severity: "error",
        check: "captions.schema",
        message: "captions.json root must be an array or object",
        path: captionPath,
      });
      return;
    }
    for (const field of Object.keys(captions)) {
      if (field !== "default_text_style" && field !== "captions") {
        captionFinding(
          findings,
          "captions.schema",
          `${field} is not defined by captions v0 root object`,
          captionPath,
        );
      }
    }
    if (Object.hasOwn(captions, "default_text_style")) {
      validateTextStyle(
        captions.default_text_style,
        "default_text_style",
        findings,
        captionPath,
      );
    }
    if (!Array.isArray(captions.captions)) {
      captionFinding(
        findings,
        "captions.schema",
        "captions must be an array in the captions.json root object",
        captionPath,
      );
      return;
    }
    captions = captions.captions;
  }
  const ids = new Set();
  const overlayIds = new Set(
    Array.isArray(edit?.overlays)
      ? edit.overlays.filter(isRecord).map((overlay) => overlay.id)
      : [],
  );
  let previousStart = -Infinity;

  for (const [index, caption] of captions.entries()) {
    const itemPath = `captions.json#[${index}]`;
    if (!isRecord(caption)) {
      captionFinding(findings, "captions.schema", "caption must be an object", itemPath);
      continue;
    }
    const required = ["id", "start", "end", "text", "speaker", "sourceRef", "edited"];
    const optional = ["src", "words", "style", "display_text", "text_style"];
    for (const field of required) {
      if (!Object.hasOwn(caption, field)) {
        captionFinding(findings, "captions.schema", `${field} is required`, itemPath);
      }
    }
    for (const field of Object.keys(caption)) {
      if (![...required, ...optional].includes(field)) {
        captionFinding(
          findings,
          "captions.schema",
          `${field} is not defined by captions v0`,
          itemPath,
        );
      }
    }
    if (Object.hasOwn(caption, "src")) {
      if (!isNonEmptyString(caption.src)) {
        captionFinding(
          findings,
          "captions.schema",
          "src must be a non-empty string when present",
          itemPath,
        );
      } else if (edit?.version === 1) {
        const sourceIds = new Set(
          Array.isArray(edit.sources)
            ? edit.sources.filter(isRecord).map((source) => source.id)
            : [],
        );
        if (!sourceIds.has(caption.src)) {
          captionFinding(
            findings,
            "captions.src-reference",
            `src does not reference sources[].id: ${caption.src}`,
            itemPath,
          );
        }
      }
    }
    if (typeof caption.id !== "string" || !/^c-\d{4}$/.test(caption.id)) {
      captionFinding(
        findings,
        "captions.schema",
        "id must match c- followed by four digits",
        itemPath,
      );
    } else if (ids.has(caption.id)) {
      captionFinding(findings, "captions.schema", `duplicate id: ${caption.id}`, itemPath);
    } else {
      ids.add(caption.id);
    }
    if (!isNonEmptyString(caption.text)) {
      captionFinding(findings, "captions.schema", "text must be a non-empty string", itemPath);
    }
    if (caption.speaker !== null) {
      captionFinding(findings, "captions.schema", "speaker must be null in v0", itemPath);
    }
    if (typeof caption.edited !== "boolean") {
      captionFinding(findings, "captions.edited", "edited must be a boolean", itemPath);
    }
    if (Object.hasOwn(caption, "style")) {
      if (caption.style !== "karaoke"
        && caption.style !== "pop"
        && caption.style !== "reveal") {
        captionFinding(
          findings,
          "captions.schema",
          'style must be "karaoke", "pop", or "reveal"',
          itemPath,
        );
      }
    }
    if (Object.hasOwn(caption, "display_text") && typeof caption.display_text !== "string") {
      captionFinding(
        findings,
        "captions.schema",
        "display_text must be a string when present",
        itemPath,
      );
    }
    if (Object.hasOwn(caption, "text_style")) {
      validateTextStyle(caption.text_style, "text_style", findings, itemPath);
    }
    if (Object.hasOwn(caption, "words")) {
      validateCaptionWords(caption.words, caption, findings, itemPath);
    }
    const timesValid =
      isFiniteNumber(caption.start) &&
      isFiniteNumber(caption.end) &&
      caption.start >= 0 &&
      caption.end > caption.start;
    if (!timesValid) {
      captionFinding(
        findings,
        "captions.schema",
        "caption must satisfy 0 <= start < end",
        itemPath,
      );
    } else {
      if (caption.start < previousStart - EPSILON) {
        captionFinding(
          findings,
          "captions.order",
          "captions must be sorted by start time",
          itemPath,
        );
      }
      previousStart = caption.start;
      const displaySeconds = caption.end - caption.start;
      if (displaySeconds < 1.0 - EPSILON) {
        addFinding(findings, {
          severity: "warning",
          check: "captions.short-duration",
          message: `caption display duration is ${displaySeconds.toFixed(2)}s, under the 1.0s readability floor`,
          path: itemPath,
          range: { start: caption.start, end: caption.end },
        });
      }
      const kept = keptOverlap(caption.start, caption.end, edit?.cuts, caption.src);
      const ratio = kept / (caption.end - caption.start);
      if (ratio < 0.5 - EPSILON) {
        addFinding(findings, {
          severity: "error",
          check: "captions.cut-visibility",
          message: "less than 50% of the caption remains after cuts",
          path: itemPath,
          range: { start: caption.start, end: caption.end },
        });
      }
    }

    const sourceSegment = sourceSegmentIndex(caption.sourceRef);
    if (caption.sourceRef !== null && sourceSegment === null) {
      captionFinding(
        findings,
        "captions.schema",
        "sourceRef must be null or { segment: non-negative integer }",
        itemPath,
      );
    } else if (sourceSegment !== null && Array.isArray(analysis?.transcript)) {
      const transcript = analysis.transcript[sourceSegment];
      if (!isRecord(transcript)) {
        addFinding(findings, {
          severity: "warning",
          check: "captions.edited",
          message: "sourceRef.segment no longer exists in analysis.json",
          path: itemPath,
        });
      } else if (caption.edited === false && caption.text !== transcript.text) {
        captionFinding(
          findings,
          "captions.edited",
          "text differs from its source transcript but edited is false",
          itemPath,
        );
      }
    }
    if (typeof caption.id === "string" && !overlayIds.has(caption.id)) {
      addFinding(findings, {
        severity: "warning",
        check: "captions.overlay-link",
        message: "caption id has no matching overlay id",
        path: itemPath,
      });
    }
  }
}

const CAPTION_WORD_FIELDS = ["start", "end", "text"];

// caption.words[] は analysis.json の transcriptSegment.words（$defs/word）と同形・同座標系
// （source 秒）。充填パイプライン自体はこの検証の対象外（captions-contract-revision-note.md 参照）
// で、ここは「words が置かれているならその形が正しいか」だけを見る。
function validateCaptionWords(words, caption, findings, itemPath) {
  if (!Array.isArray(words)) {
    captionFinding(findings, "captions.schema", "words must be an array", itemPath);
    return;
  }
  const hasCaptionRange = isFiniteNumber(caption.start) && isFiniteNumber(caption.end);
  words.forEach((word, wordIndex) => {
    const wordPath = `${itemPath}.words[${wordIndex}]`;
    if (!isRecord(word)) {
      captionFinding(findings, "captions.schema", "word must be an object", wordPath);
      return;
    }
    for (const field of CAPTION_WORD_FIELDS) {
      if (!Object.hasOwn(word, field)) {
        captionFinding(findings, "captions.schema", `${field} is required`, wordPath);
      }
    }
    for (const field of Object.keys(word)) {
      if (!CAPTION_WORD_FIELDS.includes(field)) {
        captionFinding(
          findings,
          "captions.schema",
          `${field} is not defined by captions v0 words[]`,
          wordPath,
        );
      }
    }
    const wordTimesValid =
      isFiniteNumber(word.start) &&
      isFiniteNumber(word.end) &&
      word.start >= 0 &&
      word.end >= word.start;
    if (!wordTimesValid) {
      captionFinding(findings, "captions.schema", "word must satisfy 0 <= start <= end", wordPath);
    } else if (
      hasCaptionRange &&
      (word.start < caption.start - EPSILON || word.end > caption.end + EPSILON)
    ) {
      addFinding(findings, {
        severity: "warning",
        check: "captions.words-range",
        message: "word falls outside the caption's [start, end] range",
        path: wordPath,
        range: { start: word.start, end: word.end },
      });
    }
    if (!isNonEmptyString(word.text)) {
      captionFinding(findings, "captions.schema", "text must be a non-empty string", wordPath);
    }
  });
}

const CAPTION_TEXT_STYLE_ZONES = new Set([
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
]);
const CAPTION_HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function validateTextStyle(value, label, findings, path) {
  if (!isRecord(value)) {
    captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
    return;
  }
  const allowed = ["color", "size_px", "stroke", "background", "zone"];
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) {
      captionFinding(
        findings,
        "captions.text-style",
        `${label}.${field} is not defined by the text style contract`,
        path,
      );
    }
  }
  if (Object.hasOwn(value, "color")) {
    validateCaptionHexColor(value.color, `${label}.color`, findings, path);
  }
  if (
    Object.hasOwn(value, "size_px")
    && (!isFiniteNumber(value.size_px) || value.size_px <= 0)
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.size_px must be a finite number greater than zero`,
      path,
    );
  }
  if (Object.hasOwn(value, "stroke")) {
    validateCaptionStrokeStyle(value.stroke, `${label}.stroke`, findings, path);
  }
  if (Object.hasOwn(value, "background")) {
    validateCaptionBackgroundStyle(value.background, `${label}.background`, findings, path);
  }
  if (Object.hasOwn(value, "zone") && !CAPTION_TEXT_STYLE_ZONES.has(value.zone)) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.zone must be one of the nine caption zones`,
      path,
    );
  }
}

function validateCaptionStrokeStyle(value, label, findings, path) {
  if (!isRecord(value)) {
    captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
    return;
  }
  for (const field of Object.keys(value)) {
    if (field !== "color" && field !== "width_px") {
      captionFinding(
        findings,
        "captions.text-style",
        `${label}.${field} is not defined by the stroke style contract`,
        path,
      );
    }
  }
  if (Object.hasOwn(value, "color")) {
    validateCaptionHexColor(value.color, `${label}.color`, findings, path);
  }
  if (
    Object.hasOwn(value, "width_px")
    && (!isFiniteNumber(value.width_px) || value.width_px < 0)
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.width_px must be a non-negative finite number`,
      path,
    );
  }
}

function validateCaptionBackgroundStyle(value, label, findings, path) {
  if (!isRecord(value)) {
    captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
    return;
  }
  const allowed = ["color", "opacity", "radius_px", "mode"];
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) {
      captionFinding(
        findings,
        "captions.text-style",
        `${label}.${field} is not defined by the background style contract`,
        path,
      );
    }
  }
  if (Object.hasOwn(value, "color")) {
    validateCaptionHexColor(value.color, `${label}.color`, findings, path);
  }
  if (
    Object.hasOwn(value, "opacity")
    && (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1)
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.opacity must be a finite number from zero to one`,
      path,
    );
  }
  if (
    Object.hasOwn(value, "radius_px")
    && (!isFiniteNumber(value.radius_px) || value.radius_px < 0)
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.radius_px must be a non-negative finite number`,
      path,
    );
  }
  if (
    Object.hasOwn(value, "mode")
    && value.mode !== "per-line"
    && value.mode !== "block"
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.mode must be either per-line or block`,
      path,
    );
  }
}

function validateCaptionHexColor(value, label, findings, path) {
  if (typeof value !== "string" || !CAPTION_HEX_COLOR.test(value)) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label} must be a #RGB, #RRGGBB, or #RRGGBBAA hex color`,
      path,
    );
  }
}

const REVIEW_TARGET_KINDS = new Set(["instant", "range", "region", "asset", "insert"]);
const REVIEW_REQUIRED_FIELDS = ["id", "createdAt", "sourceT", "text", "input", "status"];
const REVIEW_OPTIONAL_FIELDS = [
  "src",
  "sourceRange",
  "timelineT",
  "target",
  "targetKind",
  "region",
  "strokes",
  "refs",
  "insertPosition",
  "intent",
  "audio",
  "poses",
  "response",
];

async function validateReview(review, edit, findings, paths, skipped) {
  const reviewRelative = relativePath(paths.projectRoot, paths.reviewPath);
  if (!isRecord(review)) {
    reviewFinding(findings, "review.schema", "review.json root must be an object", reviewRelative);
    return;
  }
  if (Number.isInteger(review.version) && review.version > 0) {
    reviewFinding(
      findings,
      "review.version",
      `review.json version ${review.version} は新しすぎるため検証できません。このファイルは新しい形式です。スキル / アプリを更新してください`,
      `${reviewRelative}#version`,
    );
    addSkipped(
      skipped,
      "review.validation",
      "a newer review.json version was detected; no format assumptions were made",
    );
    return;
  }
  if (review.version !== 0) {
    reviewFinding(findings, "review.schema", "version must be 0", `${reviewRelative}#version`);
  }
  if (!Array.isArray(review.annotations)) {
    reviewFinding(findings, "review.schema", "annotations must be an array", reviewRelative);
    return;
  }

  const sourceIds = new Set(
    edit?.version === 1 && Array.isArray(edit.sources)
      ? edit.sources.filter(isRecord).map((source) => source.id).filter(isNonEmptyString)
      : [],
  );
  const ids = new Set();

  for (const [index, annotation] of review.annotations.entries()) {
    const itemPath = `review.json#annotations[${index}]`;
    if (!isRecord(annotation)) {
      reviewFinding(findings, "review.schema", "annotation must be an object", itemPath);
      continue;
    }
    for (const field of REVIEW_REQUIRED_FIELDS) {
      if (!Object.hasOwn(annotation, field)) {
        reviewFinding(findings, "review.schema", `${field} is required`, itemPath);
      }
    }
    for (const field of Object.keys(annotation)) {
      if (![...REVIEW_REQUIRED_FIELDS, ...REVIEW_OPTIONAL_FIELDS].includes(field)) {
        // 寛容リーダー原則（contract-2026-07-17 原則 1）に従い未知フィールドは warning に留める
        reviewFinding(
          findings,
          "review.schema",
          `${field} is not defined by review v0`,
          itemPath,
          "warning",
        );
      }
    }
    if (isNonEmptyString(annotation.id)) {
      if (ids.has(annotation.id)) {
        reviewFinding(findings, "review.schema", `duplicate id: ${annotation.id}`, itemPath);
      } else {
        ids.add(annotation.id);
      }
    } else if (Object.hasOwn(annotation, "id")) {
      reviewFinding(findings, "review.schema", "id must be a non-empty string", itemPath);
    }
    if (
      Object.hasOwn(annotation, "sourceT") &&
      (!isFiniteNumber(annotation.sourceT) || annotation.sourceT < 0)
    ) {
      reviewFinding(
        findings,
        "review.schema",
        "sourceT must be a non-negative finite number (source seconds)",
        itemPath,
      );
    }
    if (annotation.sourceRange !== undefined && annotation.sourceRange !== null) {
      const range = annotation.sourceRange;
      if (
        !Array.isArray(range) ||
        range.length !== 2 ||
        !isFiniteNumber(range[0]) ||
        !isFiniteNumber(range[1]) ||
        range[0] < 0 ||
        range[1] <= range[0]
      ) {
        reviewFinding(
          findings,
          "review.schema",
          "sourceRange must be null or satisfy 0 <= start < end",
          itemPath,
        );
      }
    }
    if (annotation.timelineT !== undefined && annotation.timelineT !== null) {
      reviewFinding(
        findings,
        "review.timeline-t",
        "timelineT is deprecated; project timeline positions from cuts[] instead",
        itemPath,
        "warning",
      );
    }
    if (Object.hasOwn(annotation, "src") && annotation.src !== null) {
      if (!isNonEmptyString(annotation.src)) {
        reviewFinding(findings, "review.schema", "src must be null or a non-empty string", itemPath);
      } else if (edit?.version === 1 && !sourceIds.has(annotation.src)) {
        reviewFinding(
          findings,
          "review.src-reference",
          `src does not reference sources[].id: ${annotation.src}`,
          itemPath,
        );
      }
    }
    const targetKind =
      annotation.targetKind === undefined || annotation.targetKind === null
        ? null
        : annotation.targetKind;
    if (targetKind !== null && !REVIEW_TARGET_KINDS.has(targetKind)) {
      reviewFinding(
        findings,
        "review.schema",
        "targetKind must be one of instant / range / region / asset / insert or null",
        itemPath,
      );
    }
    const region = validateReviewRegion(annotation.region, findings, itemPath);
    const strokes = validateReviewStrokes(annotation.strokes, findings, itemPath);
    const refs = await validateReviewRefs(annotation.refs, edit, sourceIds, findings, paths, itemPath);
    const insertPosition =
      annotation.insertPosition === "before" || annotation.insertPosition === "after"
        ? annotation.insertPosition
        : null;
    if (
      annotation.insertPosition !== undefined &&
      annotation.insertPosition !== null &&
      insertPosition === null
    ) {
      reviewFinding(
        findings,
        "review.schema",
        "insertPosition must be before / after or null",
        itemPath,
      );
    }
    if (region && strokes) {
      reviewFinding(
        findings,
        "review.target-consistency",
        "both region and strokes are set; region.box wins",
        itemPath,
        "warning",
      );
    }
    if (targetKind === "range" && !Array.isArray(annotation.sourceRange)) {
      reviewFinding(
        findings,
        "review.target-consistency",
        "targetKind range expects sourceRange",
        itemPath,
        "warning",
      );
    }
    if (targetKind === "region" && !region && !strokes) {
      reviewFinding(
        findings,
        "review.target-consistency",
        "targetKind region expects region or strokes",
        itemPath,
        "warning",
      );
    }
    if (targetKind === "asset" && !refs) {
      reviewFinding(
        findings,
        "review.target-consistency",
        "targetKind asset expects refs",
        itemPath,
        "warning",
      );
    }
    if (targetKind === "insert") {
      if (!insertPosition) {
        reviewFinding(
          findings,
          "review.target-consistency",
          "targetKind insert expects insertPosition",
          itemPath,
          "warning",
        );
      }
      validateInsertAnchor(annotation, edit, findings, itemPath);
    }
  }
}

function validateReviewRegion(region, findings, itemPath) {
  if (region === undefined || region === null) return null;
  const box = isRecord(region) ? region.box : undefined;
  if (
    Array.isArray(box) &&
    box.length === 4 &&
    box.every((entry) => isFiniteNumber(entry) && entry >= 0 && entry <= 1) &&
    box[2] > 0 &&
    box[3] > 0 &&
    box[0] + box[2] <= 1 &&
    box[1] + box[3] <= 1
  ) {
    return region;
  }
  reviewFinding(
    findings,
    "review.schema",
    "region must be null or { box: [x, y, w, h] } normalized to the source frame with x+w<=1 and y+h<=1",
    itemPath,
  );
  return null;
}

function validateReviewStrokes(strokes, findings, itemPath) {
  if (strokes === undefined || strokes === null) return null;
  const valid =
    Array.isArray(strokes) &&
    strokes.length > 0 &&
    strokes.every(
      (stroke) =>
        Array.isArray(stroke) &&
        stroke.length >= 2 &&
        stroke.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            point.every((entry) => isFiniteNumber(entry) && entry >= 0 && entry <= 1),
        ),
    );
  if (valid) return strokes;
  reviewFinding(
    findings,
    "review.schema",
    "strokes must be null or an array of [x, y] paths (2+ points, normalized to the source frame)",
    itemPath,
  );
  return null;
}

async function validateReviewRefs(refs, edit, sourceIds, findings, paths, itemPath) {
  if (refs === undefined || refs === null) return null;
  if (!Array.isArray(refs) || refs.length === 0) {
    reviewFinding(findings, "review.schema", "refs must be null or a non-empty array", itemPath);
    return null;
  }
  let valid = true;
  for (const [refIndex, ref] of refs.entries()) {
    const refPath = `${itemPath}.refs[${refIndex}]`;
    if (!isRecord(ref)) {
      reviewFinding(findings, "review.schema", "ref must be an object", refPath);
      valid = false;
      continue;
    }
    const hasSrc = Object.hasOwn(ref, "src");
    const hasPath = Object.hasOwn(ref, "path");
    if (hasSrc === hasPath) {
      reviewFinding(
        findings,
        "review.schema",
        "ref must contain exactly one of src / path",
        refPath,
      );
      valid = false;
      continue;
    }
    if (hasSrc) {
      if (!isNonEmptyString(ref.src)) {
        reviewFinding(findings, "review.schema", "ref src must be a non-empty string", refPath);
        valid = false;
      } else if (edit?.version === 1 && !sourceIds.has(ref.src)) {
        reviewFinding(
          findings,
          "review.refs-reference",
          `ref src does not reference sources[].id: ${ref.src}`,
          refPath,
        );
        valid = false;
      }
    } else if (!isNonEmptyString(ref.path)) {
      reviewFinding(findings, "review.schema", "ref path must be a non-empty string", refPath);
      valid = false;
    } else {
      const filePath = resolveReference(paths.editPath, ref.path);
      if (!(await isRegularFile(filePath))) {
        // 注釈は助言データのため、参照先の実体欠落は warning に留める（契約 §4 劣化規約）
        reviewFinding(
          findings,
          "review.refs-file",
          `ref path does not resolve to a regular file: ${ref.path}`,
          refPath,
          "warning",
        );
      }
    }
  }
  return valid ? refs : null;
}

function validateInsertAnchor(annotation, edit, findings, itemPath) {
  if (!Array.isArray(edit?.cuts) || !isFiniteNumber(annotation.sourceT)) return;
  const anchorSrc = isNonEmptyString(annotation.src) ? annotation.src : null;
  if (edit?.version === 1 && anchorSrc === null) {
    reviewFinding(
      findings,
      "review.insert-anchor-unresolved",
      "insert anchor cannot resolve without src on a multi-source edit.json",
      itemPath,
      "warning",
    );
    return;
  }
  let matches = 0;
  for (const cut of edit.cuts) {
    if (!isRecord(cut) || !isFiniteNumber(cut.in) || !isFiniteNumber(cut.out)) continue;
    if (edit?.version === 1 && cut.src !== anchorSrc) continue;
    if (annotation.sourceT >= cut.in - EPSILON && annotation.sourceT <= cut.out + EPSILON) {
      matches += 1;
    }
  }
  if (matches === 0) {
    reviewFinding(
      findings,
      "review.insert-anchor-unresolved",
      "insert anchor (src, sourceT) is not covered by any cut; automatic placement is unresolved",
      itemPath,
      "warning",
    );
  } else if (matches > 1) {
    reviewFinding(
      findings,
      "review.insert-anchor-ambiguous",
      "insert anchor matches multiple cuts; the first match in cuts[] array order wins",
      itemPath,
      "warning",
    );
  }
}

function reviewFinding(findings, check, message, path, severity = "error") {
  addFinding(findings, { severity, check, message, path });
}

const INTAKE_TASK_IDS = new Set([
  "transcribe-captions",
  "silence-cut",
  "bgm-sfx",
  "narration",
  "3d-inserts",
]);
const INTAKE_AUTONOMY_VALUES = new Set(["full-auto", "checkpoint", "collaborative"]);
const INTAKE_STATUS_VALUES = new Set(["draft", "submitted"]);
const INTAKE_ROOT_FIELDS = ["version", "tasks", "target", "autonomy", "status", "submitted_at"];
const INTAKE_TARGET_FIELDS = ["duration_s", "keep_length", "taste"];

// intake.schema.json（packages/schemas/intake.schema.json）を手書きで再検証する。
// edit-lint は依存ゼロ・自己完結の規律のため、他パッケージのバリデータを import しない
// （review / captions と同じ「ルールをこちらにも手書きで写す」流儀）。
function validateIntake(intake, findings, paths) {
  const intakeRelative = relativePath(paths.projectRoot, paths.intakePath);
  if (!isRecord(intake)) {
    intakeFinding(findings, "intake.schema", "intake.json root must be an object", intakeRelative);
    return;
  }
  if (Number.isInteger(intake.version) && intake.version > 1) {
    intakeFinding(
      findings,
      "intake.version",
      `intake.json version ${intake.version} は新しすぎるため検証できません。このファイルは新しい形式です。スキル / アプリを更新してください`,
      `${intakeRelative}#version`,
    );
    return;
  }

  for (const field of INTAKE_ROOT_FIELDS) {
    if (!Object.hasOwn(intake, field)) {
      intakeFinding(findings, "intake.schema", `${field} is required`, intakeRelative);
    }
  }
  for (const field of Object.keys(intake)) {
    if (!INTAKE_ROOT_FIELDS.includes(field)) {
      intakeFinding(
        findings,
        "intake.schema",
        `${field} is not defined by intake v1`,
        intakeRelative,
        "warning",
      );
    }
  }
  if (intake.version !== 1) {
    intakeFinding(findings, "intake.schema", "version must be 1", `${intakeRelative}#version`);
  }

  if (!Array.isArray(intake.tasks)) {
    intakeFinding(findings, "intake.schema", "tasks must be an array", `${intakeRelative}#tasks`);
  } else {
    const seen = new Set();
    intake.tasks.forEach((task, index) => {
      const itemPath = `${intakeRelative}#tasks[${index}]`;
      if (typeof task !== "string" || !INTAKE_TASK_IDS.has(task)) {
        intakeFinding(findings, "intake.tasks", `unknown task id: ${JSON.stringify(task)}`, itemPath);
        return;
      }
      if (seen.has(task)) {
        intakeFinding(findings, "intake.tasks", `duplicate task id: ${task}`, itemPath);
      }
      seen.add(task);
    });
  }

  validateIntakeTarget(intake.target, findings, `${intakeRelative}#target`);

  if (Object.hasOwn(intake, "autonomy") && !INTAKE_AUTONOMY_VALUES.has(intake.autonomy)) {
    intakeFinding(
      findings,
      "intake.schema",
      "autonomy must be one of full-auto / checkpoint / collaborative",
      `${intakeRelative}#autonomy`,
    );
  }
  if (Object.hasOwn(intake, "status") && !INTAKE_STATUS_VALUES.has(intake.status)) {
    intakeFinding(findings, "intake.schema", "status must be draft or submitted", `${intakeRelative}#status`);
  }

  if (intake.status === "submitted") {
    if (typeof intake.submitted_at !== "string" || !isIsoDateTime(intake.submitted_at)) {
      intakeFinding(
        findings,
        "intake.submitted_at",
        "submitted_at must be an ISO 8601 timestamp when status is submitted",
        `${intakeRelative}#submitted_at`,
      );
    }
  } else if (intake.status === "draft") {
    if (intake.submitted_at !== null && intake.submitted_at !== undefined) {
      intakeFinding(
        findings,
        "intake.submitted_at",
        "submitted_at must be null while status is draft",
        `${intakeRelative}#submitted_at`,
      );
    }
    intakeFinding(
      findings,
      "intake.status",
      "intake.json is still a draft; the plan is not confirmed yet — settle tasks / target / autonomy with the user (form or conversation) before following it",
      intakeRelative,
      "warning",
    );
  }
}

function validateIntakeTarget(target, findings, itemPath) {
  if (!isRecord(target)) {
    intakeFinding(findings, "intake.schema", "target must be an object", itemPath);
    return;
  }
  for (const field of ["duration_s", "keep_length"]) {
    if (!Object.hasOwn(target, field)) {
      intakeFinding(findings, "intake.schema", `target.${field} is required`, itemPath);
    }
  }
  for (const field of Object.keys(target)) {
    if (!INTAKE_TARGET_FIELDS.includes(field)) {
      intakeFinding(
        findings,
        "intake.schema",
        `target.${field} is not defined by intake v1`,
        itemPath,
        "warning",
      );
    }
  }

  const hasDuration = target.duration_s !== null && target.duration_s !== undefined;
  if (hasDuration && !isPositiveNumber(target.duration_s)) {
    intakeFinding(
      findings,
      "intake.schema",
      "target.duration_s must be null or a positive finite number",
      itemPath,
    );
  }
  if (Object.hasOwn(target, "keep_length") && typeof target.keep_length !== "boolean") {
    intakeFinding(findings, "intake.schema", "target.keep_length must be a boolean", itemPath);
  }
  if (hasDuration && target.keep_length === true) {
    intakeFinding(
      findings,
      "intake.target-exclusive",
      "target.duration_s and target.keep_length: true must not both be set",
      itemPath,
    );
  }
  if (Object.hasOwn(target, "taste") && target.taste !== null && typeof target.taste !== "string") {
    intakeFinding(findings, "intake.schema", "target.taste must be null or a string", itemPath);
  }
}

function intakeFinding(findings, check, message, path, severity = "error") {
  addFinding(findings, { severity, check, message, path });
}

function isIsoDateTime(value) {
  const timestamp = Date.parse(value);
  return typeof value === "string" && Number.isFinite(timestamp) && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

function runMediaChecks(sourcePath, findings, paths, options, captions) {
  const command = options.ffmpegCommand ?? process.env.FFMPEG ?? resolveFfmpeg();
  const sourceRelative = relativePath(paths.projectRoot, sourcePath);
  const silence = runCommand(command, [
    "-hide_banner",
    "-nostdin",
    "-i",
    sourcePath,
    "-vn",
    "-af",
    "silencedetect=noise=-50dB:d=0.5",
    "-f",
    "null",
    "-",
  ]);
  const silenceIntervals = parseSilenceIntervals(silence.stderr);
  for (const interval of silenceIntervals) {
    const severity =
      options.silenceErrorSeconds !== null &&
      interval.duration >= options.silenceErrorSeconds - EPSILON
        ? "error"
        : "warning";
    addFinding(findings, {
      severity,
      check: "media.silence",
      message: `silence detected for ${formatNumber(interval.duration)}s`,
      path: sourceRelative,
      range: { start: interval.start, end: interval.end },
    });
  }
  const captionSilenceIntervals = silenceIntervals.filter(
    (interval) => interval.duration >= 1.0 - EPSILON,
  );
  if (Array.isArray(captions)) {
    const validCaptions = captions.filter(
      (caption) =>
        isFiniteNumber(caption?.start) &&
        isFiniteNumber(caption?.end) &&
        caption.end > caption.start,
    );
    const totalCaptionSeconds = validCaptions.reduce(
      (total, caption) => total + (caption.end - caption.start),
      0,
    );
    const overlapSeconds = validCaptions.reduce(
      (total, caption) =>
        total +
        captionSilenceIntervals.reduce(
          (captionTotal, interval) =>
            captionTotal +
            Math.max(
              0,
              Math.min(caption.end, interval.end) -
                Math.max(caption.start, interval.start),
            ),
          0,
        ),
      0,
    );
    if (totalCaptionSeconds > 0) {
      const thresholdPercent = options.captionSilenceWarnPercent ?? 30;
      const coveragePercent = (100 * overlapSeconds) / totalCaptionSeconds;
      if (coveragePercent > thresholdPercent + EPSILON) {
        addFinding(findings, {
          severity: "warning",
          check: "media.caption-silence-coverage",
          message: `captions cover ${coveragePercent.toFixed(1)}% of their total display time with silence (>=1.0s intervals); threshold is ${thresholdPercent}%`,
          path: relativePath(paths.projectRoot, paths.captionsPath),
        });
      }
    }
  }

  const volume = runCommand(command, [
    "-hide_banner",
    "-nostdin",
    "-i",
    sourcePath,
    "-vn",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const levels = parseVolumeLevels(volume.stderr);
  if (levels.max !== null || levels.mean !== null) {
    const tooLoud =
      levels.max !== null &&
      options.maxVolumeErrorDb !== null &&
      levels.max > options.maxVolumeErrorDb + EPSILON;
    addFinding(findings, {
      severity: tooLoud ? "error" : "warning",
      check: "media.volume",
      message: `volume mean=${formatDb(levels.mean)}, max=${formatDb(levels.max)}`,
      path: sourceRelative,
    });
  } else {
    addFinding(findings, {
      severity: "warning",
      check: "media.volume",
      message: "volumedetect returned no audio level values",
      path: sourceRelative,
    });
  }
}

function probeDuration(sourcePath, configuredCommand) {
  const command = configuredCommand ?? process.env.FFPROBE ?? resolveFfprobe();
  const result = runCommand(command, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    sourcePath,
  ]);
  const duration = Number(result.stdout.trim());
  if (!isPositiveNumber(duration)) {
    throw new ExecutionError("ffprobe did not return a positive source duration");
  }
  return duration;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw new ExecutionError(`${command} failed to start: ${messageOf(result.error)}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr ?? result.stdout ?? "").trim().split("\n").at(-1);
    throw new ExecutionError(
      `${command} exited with status ${result.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function parseSilenceIntervals(stderr) {
  const intervals = [];
  let pendingStart = null;
  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (startMatch) pendingStart = Number(startMatch[1]);
    const endMatch = line.match(
      /silence_end:\s*(-?\d+(?:\.\d+)?)\s*\|\s*silence_duration:\s*(\d+(?:\.\d+)?)/,
    );
    if (endMatch) {
      const end = Number(endMatch[1]);
      const duration = Number(endMatch[2]);
      intervals.push({ start: pendingStart ?? Math.max(0, end - duration), end, duration });
      pendingStart = null;
    }
  }
  return intervals;
}

function parseVolumeLevels(stderr) {
  const mean = stderr.match(/mean_volume:\s*(-?(?:inf|\d+(?:\.\d+)?))\s*dB/i);
  const max = stderr.match(/max_volume:\s*(-?(?:inf|\d+(?:\.\d+)?))\s*dB/i);
  return {
    mean: parseDb(mean?.[1]),
    max: parseDb(max?.[1]),
  };
}

function parseDb(value) {
  if (value === undefined) return null;
  if (value.toLowerCase() === "-inf") return -Infinity;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function inspectHtmlFragment(html) {
  const tokens = html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>/g) ?? [];
  const stack = [];
  let rootCount = 0;
  let rootAttributes = {};
  let hasTopLevelText = false;
  let unbalanced = false;
  let cursor = 0;

  for (const token of tokens) {
    const index = html.indexOf(token, cursor);
    if (index > cursor && stack.length === 0 && html.slice(cursor, index).trim() !== "") {
      hasTopLevelText = true;
    }
    cursor = index + token.length;
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    const closing = /^<\//.test(token);
    const nameMatch = token.match(/^<\/?\s*([A-Za-z][\w:-]*)/);
    if (!nameMatch) continue;
    const name = nameMatch[1].toLowerCase();
    if (closing) {
      if (stack.at(-1) !== name) unbalanced = true;
      else stack.pop();
      continue;
    }
    if (stack.length === 0) {
      rootCount += 1;
      if (rootCount === 1) rootAttributes = parseHtmlAttributes(token);
    }
    if (!isVoidElement(name) && !/\/\s*>$/.test(token)) stack.push(name);
  }
  if (html.slice(cursor).trim() !== "" && stack.length === 0) hasTopLevelText = true;
  if (stack.length > 0) unbalanced = true;
  return { rootCount, rootAttributes, hasTopLevelText, unbalanced };
}

function parseHtmlAttributes(openingTag) {
  const attributes = {};
  const head = openingTag.replace(/^<\s*[A-Za-z][\w:-]*/, "").replace(/\/?>$/, "");
  const pattern = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of head.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function isVoidElement(name) {
  return new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]).has(name);
}

function keptOverlap(start, end, cuts, src) {
  if (!Array.isArray(cuts) || cuts.length === 0) return end - start;
  let overlap = 0;
  for (const cut of cuts) {
    if (!isRecord(cut) || !isFiniteNumber(cut.in) || !isFiniteNumber(cut.out)) continue;
    if (isNonEmptyString(src) && cut.src !== src) continue;
    overlap += Math.max(0, Math.min(end, cut.out) - Math.max(start, cut.in));
  }
  return overlap;
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

function sourceSegmentIndex(sourceRef) {
  if (sourceRef === null) return null;
  if (
    isRecord(sourceRef) &&
    Number.isInteger(sourceRef.segment) &&
    sourceRef.segment >= 0
  ) {
    return sourceRef.segment;
  }
  return null;
}

async function readRequiredText(filePath, label) {
  try {
    await access(filePath, fsConstants.R_OK);
    return await readFile(filePath, "utf8");
  } catch (error) {
    throw new ExecutionError(`${label} cannot be read: ${messageOf(error)}`);
  }
}

async function readOptionalJson(filePath, label) {
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

function resolveReference(editPath, reference) {
  return isAbsolute(reference) ? reference : resolve(dirname(editPath), reference);
}

async function isRegularFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function structureFinding(findings, path, message) {
  addFinding(findings, { severity: "error", check: "edit.structure", message, path });
}

function captionFinding(findings, check, message, path) {
  addFinding(findings, { severity: "error", check, message, path });
}

function addFinding(findings, finding) {
  findings.push(finding);
}

function addSkipped(skipped, check, reason) {
  skipped.push({ check, reason });
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

function relativePath(root, filePath) {
  const value = relative(root, filePath);
  return value === "" ? basename(filePath) : value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveNumber(value) {
  return isFiniteNumber(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function numbersEqual(left, right) {
  return isFiniteNumber(left) && isFiniteNumber(right) && Math.abs(left - right) <= EPSILON;
}

function formatNumber(value) {
  return Number.isFinite(value) ? String(Number(value.toFixed(6))) : String(value);
}

function formatDb(value) {
  if (value === null) return "n/a";
  if (value === -Infinity) return "-inf dB";
  return `${formatNumber(value)} dB`;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
