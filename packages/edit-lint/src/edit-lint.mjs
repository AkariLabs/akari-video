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

const VERSION = 1;
const EPSILON = 1e-6;
const USAGE = `Usage: edit-lint <project-root|edit.json path> [--media] [--json]
       [--silence-error-seconds N] [--max-volume-error-db N]

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
  const paths = await resolveInput(input);
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
  validateDurationMaximum(edit.outputs, timeline, findings, paths);
  await validateOverlays(edit.overlays, timeline, findings, paths);

  if (captionsState.value !== undefined) {
    validateCaptions(
      captionsState.value,
      edit,
      analysisState.value,
      findings,
      paths,
    );
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
      runMediaChecks(sourcePath, findings, paths, options);
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
    if (argument.startsWith("-")) {
      throw new ExecutionError(`Unknown option: ${argument}`);
    }
    if (input !== null) throw new ExecutionError("Only one input path may be provided");
    input = argument;
  }

  if (input === null) throw new ExecutionError("An input path is required");
  return { input, ...options };
}

async function resolveInput(input) {
  const absolute = resolve(input);
  let inputStats;
  try {
    inputStats = await stat(absolute);
  } catch (error) {
    throw new ExecutionError(`Input cannot be read: ${messageOf(error)}`);
  }

  const editPath = inputStats.isDirectory() ? join(absolute, "edit.json") : absolute;
  if (!inputStats.isDirectory() && basename(absolute) !== "edit.json") {
    throw new ExecutionError("Input file must be named edit.json");
  }
  const projectRoot = dirname(editPath);
  return {
    projectRoot,
    editPath,
    analysisPath: join(projectRoot, "analysis.json"),
    captionsPath: join(projectRoot, "captions.json"),
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
  if (isRecord(edit?.audio)) {
    const bgmPath = isRecord(edit.audio.bgm) ? edit.audio.bgm.path : edit.audio.bgm;
    if (bgmPath !== null && bgmPath !== undefined) {
      references.push({ label: "audio.bgm", value: bgmPath });
    }
    if (Array.isArray(edit.audio.sfx)) {
      for (const [index, item] of edit.audio.sfx.entries()) {
        references.push({
          label: `audio.sfx[${index}]`,
          value: isRecord(item) ? item.path : item,
        });
      }
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
    addFinding(findings, {
      severity: "error",
      check: "captions.schema",
      message: "captions.json root must be an array",
      path: captionPath,
    });
    return;
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
    const optional = ["src"];
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

function runMediaChecks(sourcePath, findings, paths, options) {
  const command = options.ffmpegCommand ?? process.env.FFMPEG ?? "ffmpeg";
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
  for (const interval of parseSilenceIntervals(silence.stderr)) {
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
  const command = configuredCommand ?? process.env.FFPROBE ?? "ffprobe";
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
