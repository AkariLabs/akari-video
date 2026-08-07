import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants as fsConstants, readFileSync } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";

import { renderLintReport } from "./report.mjs";
import { musicGrid } from "../../audio-library-setup/shared/beat-grid.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";

const { resolveCaptionDisplay } = createRequire(import.meta.url)("../../edit-store/lib/index.js");

const VERSION = 1;
const EPSILON = 1e-6;
const CAPTIONS_SCHEMA = JSON.parse(readFileSync(
  new URL("../../schemas/captions.schema.json", import.meta.url),
  "utf8",
));
const CAPTION_TEXT_STYLE_FIELDS = new Set(
  Object.keys(CAPTIONS_SCHEMA.$defs.textStyle.properties),
);
const CAPTION_ANIMATION_SLOTS = new Set(
  Object.keys(CAPTIONS_SCHEMA.$defs.textAnimation.properties),
);
const CAPTION_ANIMATION_SLOT_FIELDS = new Set(
  Object.keys(CAPTIONS_SCHEMA.$defs.textAnimationSlot.properties),
);
const CAPTION_TEXTANIM_IDS = new Set(
  readFileSync(new URL("../../../presets/textanim/index.jsonl", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line).id),
);
const USAGE = `Usage: edit-lint <project-root|edit.json path> [--media] [--json]
       [--silence-error-seconds N] [--max-volume-error-db N]
       [--caption-silence-warn-percent N]
       [--declarations PATH]

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
  validateCutTrackRenderSupport(edit, cutTrackSegments, findings);
  validateDurationMaximum(edit.outputs, timeline, findings, paths);
  validateOutputAxisDurationMax(edit.outputs, cutTrackSegments, findings);
  await validateOverlays(edit.overlays, timeline, findings, paths);
  validateOverlayBackgroundRole(edit.overlays, findings);
  await validateNarration(edit?.audio?.narration, timeline, findings, paths);
  await validateBgmSfx(edit?.audio?.bgm, edit?.audio?.sfx, timeline, findings, paths);
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
    declarationsPath: null,
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
  if (
    Object.hasOwn(value, "true_peak_dbtp") &&
    (!isFiniteNumber(value.true_peak_dbtp) || value.true_peak_dbtp < -9 || value.true_peak_dbtp > 0)
  ) {
    addFinding(findings, { severity: "error", check: "audio.master.true-peak", message: "true_peak_dbtp must be a finite number within [-9, 0]", path });
  }
}

function validateOutputEncoding(value, findings, path) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    addFinding(findings, { severity: "error", check: "output.encoding.structure", message: "encoding must be an object", path });
    return;
  }
  for (const key of Object.keys(value)) {
    if (key !== "quality" && key !== "encoder") addFinding(findings, { severity: "error", check: "output.encoding.structure", message: `${key} is not defined by output.encoding`, path });
  }
  if (Object.hasOwn(value, "quality") && !["master", "high", "standard", "light"].includes(value.quality)) {
    addFinding(findings, { severity: "error", check: "output.encoding.quality", message: "quality must be master/high/standard/light", path });
  }
  if (Object.hasOwn(value, "encoder") && !["auto", "videotoolbox", "x264"].includes(value.encoder)) {
    addFinding(findings, { severity: "error", check: "output.encoding.encoder", message: "encoder must be auto/videotoolbox/x264", path });
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

// edit.json v1（sources[] 形式）の書き出しは buildMultiSourceCutCommand を通り、
// そこは cuts[] を配列順に連結するだけで track / at を見ない（v0 単一ソース経路にだけ
// gap-aware / track-aware の合成がある）。宣言だけ通って絵が消えるのが最悪なので、
// 「lint は通ったのに映像層が丸ごと無い動画が焼ける」前に error で止める。
// 実測（2026-08-04 PV ドッグフーディング）: track 1 のカットは合成されず出力尺へ連結され、
// 一度も画面に出ないまま尺だけ伸びた mp4 が PASS で焼き上がった。
function validateCutTrackRenderSupport(edit, segments, findings) {
  if (edit?.version !== 1 || !Array.isArray(edit.cuts)) return;
  const cursorByTrack = new Map();
  for (const segment of segments) {
    const cut = edit.cuts[segment.index];
    if (!isRecord(cut)) continue;
    const cursor = cursorByTrack.get(segment.track) ?? 0;
    cursorByTrack.set(segment.track, segment.end);
    if (segment.track > 0) {
      addFinding(findings, {
        severity: "warning",
        check: "cuts.track-render-unsupported",
        message:
          `cuts[].track >= 1 is declared but the v1 (sources[]) render path concatenates cuts instead of compositing them; `
          + `the clip never appears on screen. Pre-composite the upper track into one source, or move it to overlays[] / layers[].`,
        path: `edit.json#cuts[${segment.index}]`,
        range: { start: segment.start, end: segment.end },
      });
      continue;
    }
    if (Math.abs(segment.start - cursor) > EPSILON) {
      addFinding(findings, {
        severity: "warning",
        check: "cuts.at-render-unsupported",
        message:
          `cuts[].at leaves a gap/overlap on track 0, but the v1 (sources[]) render path ignores at and concatenates cuts; `
          + `the rendered timing will not match this declaration.`,
        path: `edit.json#cuts[${segment.index}]`,
        range: { start: segment.start, end: segment.end },
      });
    }
  }
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

// tasks/2026-08-07-background-role（2026-08-07 オーナー裁定・確定）: overlays[].role==="background"
// は「動かせない・必ずフレームを埋める」種別で、取りうる状態のほぼ全部が正しくなければならない。
// host（preview-server の app.js / shell の overlay-runtime.js の mount・render-cut の
// rasterize.mjs の renderOverlayNode）は role==="background" のとき --x/--y/--scale/--rotate を
// 無条件で恒等値へロックするため実害は出ないが、死んだ／誤解を招くデータ（動かないのに
// transform を持つ・vars 経由の抜け道・重なった区間）を保存させない最後の砦として、
// JSON Schema では表現できない 3 条件（vars の自由形・区間の重なりは兄弟要素比較）をここで弾く。
const BACKGROUND_LOCKED_VARS = new Set(["--x", "--y", "--scale", "--rotate"]);

function validateOverlayBackgroundRole(overlays, findings) {
  if (!Array.isArray(overlays)) return;
  const segments = [];
  overlays.forEach((overlay, index) => {
    if (!isRecord(overlay) || !Object.hasOwn(overlay, "role")) return;
    const path = `edit.json#overlays[${index}]`;

    if (overlay.role !== "background") {
      addFinding(findings, {
        severity: "error",
        check: "overlays.role",
        message: 'overlay role must be "background" when present',
        path: `${path}.role`,
      });
      return;
    }

    if (Object.hasOwn(overlay, "transform")) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.role.transform",
        message: "background overlay must not declare transform (position is locked to the output frame)",
        path: `${path}.transform`,
      });
    }

    if (isRecord(overlay.vars)) {
      for (const key of Object.keys(overlay.vars)) {
        if (BACKGROUND_LOCKED_VARS.has(key)) {
          addFinding(findings, {
            severity: "error",
            check: "overlays.role.vars",
            message: `background overlay must not override ${key} via vars (would move the background off the output frame)`,
            path: `${path}.vars`,
          });
        }
      }
    }

    if (isFiniteNumber(overlay.start) && isPositiveNumber(overlay.duration)) {
      // 背景は「今どの場面か」を表す 1 枚地の差し替え物なので、track の値に関係なく
      // 同時に 2 枚以上表示できてはいけない（cuts.track-overlap と同じ error 重大度）。
      segments.push({
        index,
        track: "background",
        start: overlay.start,
        end: overlay.start + overlay.duration,
      });
    }
  });

  for (const segment of findTrackOverlaps(segments)) {
    addFinding(findings, {
      severity: "error",
      check: "overlays.role.overlap",
      message: "background overlay overlaps another background overlay (only one background may be visible at a time)",
      path: `edit.json#overlays[${segment.index}]`,
      range: { start: segment.start, end: segment.end },
    });
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

async function validateMusicGrid(bgm, sfx, timeline, findings, skipped, paths, options) {
  if (!isRecord(bgm) || !isNonEmptyString(bgm.path)) {
    addSkipped(
      skipped,
      "audio.music-grid",
      "audio.bgm is absent; music grid checks require audio.bgm.path",
    );
    return;
  }
  if (!Array.isArray(sfx) || sfx.length === 0) {
    addSkipped(
      skipped,
      "audio.music-grid",
      "audio.sfx is empty; nothing to check against the music grid",
    );
    return;
  }

  const {
    declarations,
    source: declarationsSource,
    error: declarationsError,
  } = await loadMusicDeclarations(options);
  if (declarationsError) {
    addSkipped(skipped, "audio.music-grid", declarationsError);
    return;
  }
  if (!declarations) {
    addSkipped(
      skipped,
      "audio.music-grid",
      "no declarations file found (declarations are optional)",
    );
    return;
  }

  const trackId = resolveBgmTrackId(bgm.path, declarations);
  const declaration = declarations[trackId];
  if (!declaration) {
    addSkipped(
      skipped,
      "audio.music-grid",
      `no declaration for bgm track "${trackId}" (declarations source: ${declarationsSource})`,
    );
    return;
  }

  if (timeline === null || !(timeline > 0)) {
    addSkipped(
      skipped,
      "audio.music-grid",
      "timeline duration is unavailable (cuts are invalid or empty)",
    );
    return;
  }

  const filePath = resolveReference(paths.editPath, bgm.path);
  const probed = await probeAudioDuration(filePath, options.ffprobeCommand);
  if (probed.duration === null) {
    addSkipped(
      skipped,
      "audio.music-grid",
      `bgm track duration is unavailable (${probed.reason})`,
    );
    return;
  }

  const bgmIn = isFiniteNumber(bgm.in) ? bgm.in : 0;
  const grid = musicGrid({
    declaration,
    trackDuration: probed.duration,
    bgmIn,
    timelineDuration: timeline,
  });
  const snapWindow = 0.12;
  const seamWindow = 0.3;

  for (const [index, item] of sfx.entries()) {
    if (!isRecord(item) || !isFiniteNumber(item.t)) continue;
    const itemPath = `edit.json#audio.sfx[${index}]`;
    const nearest = nearestGridPoint(item.t, grid);
    if (nearest && Math.abs(nearest.delta) > snapWindow + EPSILON) {
      addFinding(findings, {
        severity: "warning",
        check: "audio.sfx.music-grid",
        message: `t ${formatNumber(item.t)}s is ${formatNumber(Math.abs(nearest.delta))}s off the nearest ${nearest.kind} at ${formatNumber(nearest.t)}s (window ±${snapWindow}s)`,
        path: itemPath,
        range: { start: item.t, end: item.t },
      });
    }

    for (const seam of grid.seams) {
      if (Math.abs(item.t - seam) <= seamWindow + EPSILON) {
        addFinding(findings, {
          severity: "warning",
          check: "audio.sfx.music-grid-seam",
          message: `t ${formatNumber(item.t)}s fires within ${formatNumber(seamWindow)}s of a bgm loop seam at ${formatNumber(seam)}s`,
          path: itemPath,
          range: { start: item.t, end: item.t },
        });
      }
    }
  }
}

const GRID_KIND_ORDER = ["hit", "downbeat", "beat"];
const GRID_KIND_KEYS = {
  hit: "hits",
  downbeat: "downbeats",
  beat: "beats",
};

function nearestGridPoint(t, grid) {
  let best = null;
  for (const kind of GRID_KIND_ORDER) {
    for (const candidate of grid[GRID_KIND_KEYS[kind]] ?? []) {
      const delta = candidate - t;
      const absDelta = Math.abs(delta);
      const better =
        best === null ||
        absDelta < best.absDelta - 1e-9 ||
        (absDelta <= best.absDelta + 1e-9 &&
          GRID_KIND_ORDER.indexOf(kind) < GRID_KIND_ORDER.indexOf(best.kind));
      if (better) best = { t: candidate, kind, delta, absDelta };
    }
  }
  return best;
}

function resolveMusicLibraryRoot(env = process.env) {
  const home = env.AKARI_HOME || join(os.homedir(), ".akari");
  return join(home, "assets", "audio");
}

async function loadMusicDeclarations(options) {
  const fromEnv = process.env.AKARI_SOUNDS_DECLARATIONS
    ? resolve(process.env.AKARI_SOUNDS_DECLARATIONS)
    : null;
  const candidate =
    options.declarationsPath ??
    fromEnv ??
    join(resolveMusicLibraryRoot(), "declarations.json");
  try {
    await access(candidate, fsConstants.R_OK);
  } catch {
    return { declarations: null, source: null, error: null };
  }

  let text;
  try {
    text = await readFile(candidate, "utf8");
  } catch (error) {
    return {
      declarations: null,
      source: candidate,
      error: `declarations file could not be read: ${candidate} (${messageOf(error)})`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      declarations: null,
      source: candidate,
      error: `declarations file is not valid JSON: ${candidate} (${messageOf(error)})`,
    };
  }
  if (!isRecord(parsed)) {
    return {
      declarations: null,
      source: candidate,
      error: `declarations file must be a JSON object: ${candidate}`,
    };
  }
  return { declarations: parsed, source: candidate, error: null };
}

function resolveBgmTrackId(bgmPath, declarations) {
  const baseNoExt = basename(bgmPath).replace(/\.[^./]+$/, "");
  if (Object.hasOwn(declarations, baseNoExt)) return baseNoExt;
  const parentDir = basename(dirname(bgmPath));
  if (Object.hasOwn(declarations, parentDir)) return parentDir;
  return baseNoExt;
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
  const captionsRoot = captions;
  let displayPolicy;
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
      if (field !== "default_text_style" && field !== "display_policy" && field !== "captions") {
        captionFinding(
          findings,
          "captions.schema",
          `${field} is not defined by captions v0 root object`,
          captionPath,
        );
      }
    }
    displayPolicy = captions.display_policy;
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
    const optional = ["src", "words", "style", "display_text", "display_fragments", "text_style"];
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
    if (Object.hasOwn(caption, "display_fragments") && !Array.isArray(caption.display_fragments)) {
      captionFinding(findings, "captions.schema", "display_fragments must be an array when present", itemPath);
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

  if (displayPolicy !== undefined) {
    const policyCaptions = Array.isArray(captionsRoot?.captions) ? captionsRoot.captions : [];
    const emphasis = Array.isArray(edit?.emphasis_words) ? edit.emphasis_words : [];
    for (const [index, caption] of policyCaptions.entries()) {
      if (!isRecord(caption)) continue;
      const conflict = emphasis.some(word => isRecord(word)
        && (!isNonEmptyString(word.src) || !isNonEmptyString(caption.src) || word.src === caption.src)
        && isFiniteNumber(word.t_start) && isFiniteNumber(word.t_end)
        && word.t_end > caption.start && word.t_start < caption.end);
      if (conflict) captionFinding(findings, "captions.display-policy-emphasis", "emphasis_words cannot act on a cue under display_policy v1", `captions.json#[${index}]`);
    }
    try {
      resolveCaptionDisplay(captionsRoot, edit);
    } catch (error) {
      captionFinding(findings, "captions.display-policy", error instanceof Error ? error.message : String(error), captionPath);
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
  for (const field of Object.keys(value)) {
    if (!CAPTION_TEXT_STYLE_FIELDS.has(field)) {
      captionFinding(
        findings,
        "captions.text-style",
        `${label}.${field} is not defined by the text style contract`,
        path,
      );
    }
  }
  validateTextStyleV0Fields(value, label, findings, path);
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
  if (Object.hasOwn(value, "font_weight") && (!Number.isInteger(value.font_weight) || value.font_weight < 1 || value.font_weight > 1000)) {
    captionFinding(findings, "captions.text-style", `${label}.font_weight must be an integer within [1, 1000]`, path);
  }
  if (Object.hasOwn(value, "line_height") && (!isFiniteNumber(value.line_height) || value.line_height <= 0)) {
    captionFinding(findings, "captions.text-style", `${label}.line_height must be a positive finite number`, path);
  }
  if (Object.hasOwn(value, "stroke")) {
    validateCaptionStrokeStyle(value.stroke, `${label}.stroke`, findings, path);
  }
  if (Object.hasOwn(value, "background")) {
    validateCaptionBackgroundStyle(value.background, `${label}.background`, findings, path);
  }
  if (Object.hasOwn(value, "animation")) {
    validateCaptionAnimation(value.animation, `${label}.animation`, findings, path);
  }
  if (Object.hasOwn(value, "zone") && !CAPTION_TEXT_STYLE_ZONES.has(value.zone)) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.zone must be one of the nine caption zones`,
      path,
    );
  }
  if (Object.hasOwn(value, "layout")) validateCaptionReferenceLayout(value.layout, `${label}.layout`, findings, path);
  if (Object.hasOwn(value, "zone") && Object.hasOwn(value, "layout")) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label} cannot contain both zone and layout`,
      path,
    );
  }
}

function validateCaptionAnimation(value, label, findings, path) {
  if (!isRecord(value)) {
    captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
    return;
  }
  if (Object.keys(value).length === 0) {
    captionFinding(findings, "captions.text-style", `${label} must contain at least one slot`, path);
  }
  for (const slot of Object.keys(value)) {
    if (!CAPTION_ANIMATION_SLOTS.has(slot)) {
      captionFinding(
        findings,
        "captions.text-style",
        `${label}.${slot} is not defined by the animation contract`,
        path,
      );
      continue;
    }
    validateCaptionAnimationSlot(value[slot], `${label}.${slot}`, findings, path);
  }
}

function validateCaptionAnimationSlot(value, label, findings, path) {
  if (!isRecord(value)) {
    captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
    return;
  }
  for (const field of Object.keys(value)) {
    if (!CAPTION_ANIMATION_SLOT_FIELDS.has(field)) {
      captionFinding(
        findings,
        "captions.text-style",
        `${label}.${field} is not defined by the animation slot contract`,
        path,
      );
    }
  }
  if (!Object.hasOwn(value, "id")) {
    captionFinding(findings, "captions.text-style", `${label}.id is required`, path);
  } else if (!CAPTION_TEXTANIM_IDS.has(value.id)) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.id is not defined in presets/textanim/index.jsonl: ${String(value.id)}`,
      path,
    );
  }
  if (
    Object.hasOwn(value, "duration_sec")
    && (!isFiniteNumber(value.duration_sec) || value.duration_sec <= 0)
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.duration_sec must be a positive finite number`,
      path,
    );
  }
  if (
    Object.hasOwn(value, "ease")
    && value.ease !== null
    && !isNonEmptyString(value.ease)
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.ease must be null or a non-empty string`,
      path,
    );
  }
  if (
    Object.hasOwn(value, "amp")
    && value.amp !== null
    && (!isFiniteNumber(value.amp) || value.amp <= 0)
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.amp must be null or a positive finite number`,
      path,
    );
  }
}

const CAPTION_ALIGN_VALUES = new Set(["left", "center", "right"]);
const CAPTION_VERTICAL_ALIGN_VALUES = new Set(["top", "middle", "bottom"]);
const CAPTION_TEXT_TRANSFORM_VALUES = new Set([
  "upper", "uppercase", "lower", "lowercase", "title", "capitalize", "none",
]);
const CAPTION_TEXT_ANCHOR_VALUES = new Set(["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"]);
const CAPTION_SHADOW_KEYS = ["color", "opacity", "blur_px", "distance_px", "angle_deg"];
const CAPTION_GLOW_KEYS = ["color", "density", "spread", "offset_x", "offset_y"];
const CAPTION_NON_NEGATIVE_SHADOW_KEYS = ["blur_px", "distance_px", "density", "spread"];


// textstyle v0 のフィールド検証。edit-store の validateTextStyleV0 と同じ規則を張る
// （どちらか片方だけが緩いと、lint が通ったのに保存で弾かれる/その逆が起きる）。
function validateTextStyleV0Fields(value, label, findings, path) {
  const has = (key) => Object.hasOwn(value, key);
  const flag = (message) => captionFinding(findings, "captions.text-style", `${label}.${message}`, path);
  if (has("font_family") && (typeof value.font_family !== "string" || value.font_family === "")) {
    flag("font_family must be a non-empty string");
  }
  if (has("weight") && (!Number.isInteger(value.weight) || value.weight < 100 || value.weight > 900)) {
    flag("weight must be an integer within [100, 900]");
  }
  if (has("italic") && typeof value.italic !== "boolean") flag("italic must be a boolean");
  if (has("underline") && typeof value.underline !== "boolean") flag("underline must be a boolean");
  if (has("letter_spacing_em") && !isFiniteNumber(value.letter_spacing_em)) {
    flag("letter_spacing_em must be a finite number");
  }
  if (has("align") && !CAPTION_ALIGN_VALUES.has(value.align)) flag("align must be one of left, center, right");
  if (has("vertical_align") && !CAPTION_VERTICAL_ALIGN_VALUES.has(value.vertical_align)) {
    flag("vertical_align must be one of top, middle, bottom");
  }
  if (has("vertical") && typeof value.vertical !== "boolean") flag("vertical must be a boolean");
  if (has("text_transform") && !CAPTION_TEXT_TRANSFORM_VALUES.has(value.text_transform)) {
    flag("text_transform must be one of upper, uppercase, lower, lowercase, title, capitalize, none");
  }
  if (has("max_width_pct")
    && (!isFiniteNumber(value.max_width_pct) || value.max_width_pct <= 0 || value.max_width_pct >= 100)) {
    flag("max_width_pct must be a finite number within (0, 100)");
  }
  if (has("text_anchor") && !CAPTION_TEXT_ANCHOR_VALUES.has(value.text_anchor)) {
    flag("text_anchor must be one of the nine anchor codes");
  }
  if (has("position")) {
    if (!isRecord(value.position)) {
      flag("position must be an object");
    } else {
      for (const field of Object.keys(value.position)) {
        if (field !== "x" && field !== "y") flag(`position.${field} is not defined by the text style contract`);
      }
      for (const axis of ["x", "y"]) {
        if (Object.hasOwn(value.position, axis) && !isFiniteNumber(value.position[axis])) {
          flag(`position.${axis} must be a finite number`);
        }
      }
    }
  }
  if (has("shadow")) validateCaptionShadowLike(value.shadow, CAPTION_SHADOW_KEYS, `${label}.shadow`, findings, path);
  if (has("glow")) validateCaptionShadowLike(value.glow, CAPTION_GLOW_KEYS, `${label}.glow`, findings, path);
  if (has("animation")) validateCaptionAnimation(value.animation, `${label}.animation`, findings, path);
}

// shadow / glow は「color 必須 + 残りは数値」の同型。color を任意にすると消費側が
// 影を組めず無言で落ちるため必須で揃える。
function validateCaptionShadowLike(value, keys, label, findings, path) {
  if (!isRecord(value)) return captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
  for (const field of Object.keys(value)) {
    if (!keys.includes(field)) {
      captionFinding(findings, "captions.text-style", `${label}.${field} is not defined by the text style contract`, path);
    }
  }
  if (!Object.hasOwn(value, "color")) {
    captionFinding(findings, "captions.text-style", `${label}.color is required`, path);
  } else {
    validateCaptionHexColor(value.color, `${label}.color`, findings, path);
  }
  for (const key of keys) {
    if (key === "color" || !Object.hasOwn(value, key)) continue;
    if (!isFiniteNumber(value[key])) {
      captionFinding(findings, "captions.text-style", `${label}.${key} must be a finite number`, path);
      continue;
    }
    if (key === "opacity" && (value[key] < 0 || value[key] > 1)) {
      captionFinding(findings, "captions.text-style", `${label}.opacity must be within [0, 1]`, path);
    }
    // 非負なのは長さ・量のみ。angle_deg は向きなので負値が正当（-90 = 真上）、
    // offset_* も両方向へ動かせる。
    if (CAPTION_NON_NEGATIVE_SHADOW_KEYS.includes(key) && value[key] < 0) {
      captionFinding(findings, "captions.text-style", `${label}.${key} must be non-negative`, path);
    }
  }
}

function validateCaptionStrokeStyle(value, label, findings, path) {
  if (!isRecord(value)) {
    captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
    return;
  }
  for (const field of Object.keys(value)) {
    if (field !== "method" && field !== "color" && field !== "width_px") {
      captionFinding(
        findings,
        "captions.text-style",
        `${label}.${field} is not defined by the stroke style contract`,
        path,
      );
    }
  }
  if (Object.hasOwn(value, "method") && value.method !== "webkit-outline") {
    captionFinding(findings, "captions.text-style", `${label}.method must be webkit-outline`, path);
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

function validateCaptionReferenceLayout(value, label, findings, path) {
  if (!isRecord(value)) return captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
  const keys = ["mode", "reference_width_px", "reference_height_px", "left_px", "width_px", "bottom_px", "text_align", "max_lines"];
  for (const field of Object.keys(value)) if (!keys.includes(field)) captionFinding(findings, "captions.text-style", `${label}.${field} is not defined by reference-pixel layout`, path);
  for (const field of keys) if (!Object.hasOwn(value, field)) captionFinding(findings, "captions.text-style", `${label}.${field} is required`, path);
  const valid = value.mode === "reference-pixel"
    && Number.isInteger(value.reference_width_px) && value.reference_width_px > 0
    && Number.isInteger(value.reference_height_px) && value.reference_height_px > 0
    && isFiniteNumber(value.left_px) && value.left_px >= 0
    && isFiniteNumber(value.width_px) && value.width_px > 0
    && value.left_px + value.width_px <= value.reference_width_px
    && isFiniteNumber(value.bottom_px) && value.bottom_px >= 0
    && value.text_align === "center" && value.max_lines === 1;
  if (!valid) captionFinding(findings, "captions.text-style", `${label} must be a bounded reference-pixel layout with center/max_lines=1`, path);
}

function validateCaptionBackgroundStyle(value, label, findings, path) {
  if (!isRecord(value)) {
    captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
    return;
  }
  const allowed = [
    "color", "opacity", "radius_px", "mode",
    // textstyle v0 の座布団拡張: 一律余白 / 文字box比での拡張 / 座布団だけの平行移動
    "padding_px", "width_pct", "height_pct", "offset_x", "offset_y",
  ];
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
  for (const key of ["padding_px", "width_pct", "height_pct"]) {
    if (Object.hasOwn(value, key) && (!isFiniteNumber(value[key]) || value[key] < 0)) {
      captionFinding(findings, "captions.text-style", `${label}.${key} must be a non-negative finite number`, path);
    }
  }
  for (const key of ["offset_x", "offset_y"]) {
    if (Object.hasOwn(value, key) && !isFiniteNumber(value[key])) {
      captionFinding(findings, "captions.text-style", `${label}.${key} must be a finite number`, path);
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
const REVIEW_INPUTS = new Set(["typed", "voice", "session"]);
const REVIEW_STATUSES = new Set(["open", "addressed", "resolved"]);
const REVIEW_STROKE_SPACES = new Set(["content-rect", "image-rect", "canvas-rect"]);
const REVIEW_DOC_TARGET_PATTERN = /^doc:(.+)#(.+)$/;
const REVIEW_IMAGE_TARGET_PATTERN = /^image:(.+)$/;
const REVIEW_CANVAS_TARGET_PATTERN = /^canvas:(c-\d{4,})$/;
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
    if (Object.hasOwn(annotation, "createdAt") && typeof annotation.createdAt !== "string") {
      reviewFinding(findings, "review.schema", "createdAt must be a string", itemPath);
    }
    const nonVideoTarget = isNonVideoReviewTarget(annotation.target);
    if (Object.hasOwn(annotation, "sourceT") && annotation.sourceT === null && !nonVideoTarget) {
      reviewFinding(
        findings,
        "review.schema",
        "sourceT may be null only for doc:, image:, or canvas: targets",
        itemPath,
      );
    } else if (
      Object.hasOwn(annotation, "sourceT") &&
      annotation.sourceT !== null &&
      (!isFiniteNumber(annotation.sourceT) || annotation.sourceT < 0)
    ) {
      reviewFinding(findings, "review.schema", "sourceT must be null or a non-negative finite number (source seconds)", itemPath);
    }
    validateReviewTarget(annotation.target, findings, itemPath);
    if (Object.hasOwn(annotation, "text") && typeof annotation.text !== "string") {
      reviewFinding(findings, "review.schema", "text must be a string", itemPath);
    }
    if (Object.hasOwn(annotation, "input") && !REVIEW_INPUTS.has(annotation.input)) {
      reviewFinding(findings, "review.schema", "input must be typed / voice / session", itemPath);
    }
    if (Object.hasOwn(annotation, "status") && !REVIEW_STATUSES.has(annotation.status)) {
      reviewFinding(findings, "review.schema", "status must be open / addressed / resolved", itemPath);
    }
    validateReviewResponse(annotation.response, findings, itemPath);
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
    strokes.every((stroke) => validateReviewStroke(stroke));
  if (valid) return strokes;
  reviewFinding(
    findings,
    "review.schema",
    "strokes must be null or object strokes with tool, space, and normalized points",
    itemPath,
  );
  return null;
}

function validateReviewStroke(stroke) {
  if (!isRecord(stroke) || stroke.tool !== "pen" || !REVIEW_STROKE_SPACES.has(stroke.space)) {
    return false;
  }
  if (
    !Array.isArray(stroke.points) ||
    stroke.points.length < 2 ||
    !stroke.points.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every((entry) => isFiniteNumber(entry) && entry >= 0 && entry <= 1),
    )
  ) {
    return false;
  }
  if (stroke.space === "content-rect") {
    return isRecord(stroke.frame)
      && isFiniteNumber(stroke.frame.sourceT)
      && stroke.frame.sourceT >= 0
      && (!Object.hasOwn(stroke.frame, "cutIndex")
        || stroke.frame.cutIndex === null
        || (Number.isInteger(stroke.frame.cutIndex) && stroke.frame.cutIndex >= 0))
      && isNonEmptyString(stroke.sessionRef);
  }
  if (Object.hasOwn(stroke, "frame")) return false;
  if (stroke.space === "image-rect") {
    return !Object.hasOwn(stroke, "sessionRef") || isNonEmptyString(stroke.sessionRef);
  }
  return !Object.hasOwn(stroke, "canvasRef") || isNonEmptyString(stroke.canvasRef);
}

function isNonVideoReviewTarget(value) {
  return typeof value === "string"
    && (REVIEW_DOC_TARGET_PATTERN.test(value)
      || REVIEW_IMAGE_TARGET_PATTERN.test(value)
      || REVIEW_CANVAS_TARGET_PATTERN.test(value));
}

function validateReviewTarget(value, findings, itemPath) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || value === "") {
    reviewFinding(findings, "review.schema", "target must be null or a non-empty string", itemPath);
  } else if (value.startsWith("doc:") && !REVIEW_DOC_TARGET_PATTERN.test(value)) {
    reviewFinding(findings, "review.schema", "target must use doc:<project-relative-path>#<block-id>", itemPath);
  } else if (value.startsWith("image:") && !REVIEW_IMAGE_TARGET_PATTERN.test(value)) {
    reviewFinding(findings, "review.schema", "target must use image:<project-relative-path>", itemPath);
  } else if (value.startsWith("canvas:") && !REVIEW_CANVAS_TARGET_PATTERN.test(value)) {
    reviewFinding(findings, "review.schema", "target must use canvas:<c-NNNN>", itemPath);
  }
}

function validateReviewResponse(value, findings, itemPath) {
  if (value === undefined || value === null) return;
  if (
    !isRecord(value)
    || typeof value.summary !== "string"
    || (value.action !== "edited" && value.action !== "declined")
    || typeof value.respondedAt !== "string"
  ) {
    reviewFinding(
      findings,
      "review.schema",
      "response must be null or { summary, action: edited|declined, respondedAt }",
      itemPath,
    );
  }
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

async function probeAudioDuration(filePath, configuredCommand) {
  let command;
  try {
    command = configuredCommand ?? process.env.FFPROBE ?? resolveFfprobe();
  } catch (error) {
    return { duration: null, reason: messageOf(error) };
  }
  const result = spawnSync(
    command,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error) return { duration: null, reason: messageOf(result.error) };
  if (result.status !== 0) {
    const detail = String(result.stderr ?? result.stdout ?? "").trim().split("\n").at(-1);
    return {
      duration: null,
      reason: detail || `ffprobe exited with status ${result.status}`,
    };
  }
  const duration = Number(String(result.stdout ?? "").trim());
  if (!isPositiveNumber(duration)) {
    return { duration: null, reason: "ffprobe did not return a positive duration" };
  }
  return { duration, reason: null };
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
