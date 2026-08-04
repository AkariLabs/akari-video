import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readProjectEvents, resolveActiveAcceptance } from "./events.mjs";

const ABSENT_REVIEW_SENTINEL = "AKARI_REVIEW_ABSENT/v1";
const ABSENT_DECLARED_INPUT_SENTINEL = "AKARI_DECLARED_INPUT_ABSENT/v1";
const CORE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export async function inspectFullIntegrity(input, { events = null } = {}) {
  const projectRoot = realpathSync(resolve(input));
  const problems = [];
  const warnings = [];
  const render = readJson(join(projectRoot, ".akari", "render.json"), ".akari/render.json", problems);
  if (!render || render.version !== 1 || render.phase !== "verified" || render.verify?.verdict !== "pass") {
    problems.push("current render is not verified PASS");
    return result();
  }
  if (!isRecord(render.render_receipt) || !isSha(render.render_receipt.sha256)) {
    problems.push("current render has no valid immutable receipt reference");
    return result();
  }

  const receiptPath = resolveProjectFile(projectRoot, render.render_receipt.path, "render receipt", problems);
  if (!receiptPath) return result();
  const receiptBytes = readFileSync(receiptPath, "utf8");
  const receiptSha256 = sha256(receiptBytes);
  if (receiptSha256 !== render.render_receipt.sha256) problems.push("render receipt digest does not match render.json");
  if (!contentAddressedJsonFilenameMatches(receiptPath, receiptSha256)) problems.push("render receipt filename does not match its payload digest");
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes);
  } catch (error) {
    problems.push(`render receipt is not valid JSON: ${messageOf(error)}`);
    return result();
  }
  if (!isRecord(receipt) || receipt.version !== 1 || receipt.receipt_scope !== "akari-declared-render-inputs/v1") {
    problems.push("render receipt has an unsupported version or scope");
    return result();
  }
  if (!Array.isArray(receipt.inputs) || receipt.inputs.length === 0) problems.push("render receipt inputs must be non-empty");
  const seenInputs = new Set();
  for (const input of receipt.inputs ?? []) {
    if (!isRecord(input) || !isNonEmptyString(input.role) || !isNonEmptyString(input.path)
      || !Number.isInteger(input.bytes) || input.bytes < 0 || !isSha(input.sha256)) {
      problems.push("render receipt contains an invalid input entry");
      continue;
    }
    const key = `${input.role}\0${input.path}`;
    if (seenInputs.has(key)) problems.push(`render receipt duplicates input ${input.role}:${input.path}`);
    seenInputs.add(key);
    if (input.state === "absent") {
      const expected = sha256(`${ABSENT_DECLARED_INPUT_SENTINEL}:${input.role}:${input.path}`);
      if (input.scope === "akari" || input.bytes !== 0 || input.sha256 !== expected) {
        problems.push(`render receipt absent-input sentinel is invalid: ${input.role}:${input.path}`);
      } else if (!isSafeRelativePath(input.path)) {
        problems.push(`receipt absent input path is unsafe: ${input.role}:${input.path}`);
      } else if (existsSync(resolve(projectRoot, input.path))) {
        problems.push(`receipt input appeared after being recorded absent: ${input.role}:${input.path}`);
      }
      continue;
    }
    if (input.state !== undefined) {
      problems.push(`render receipt input has unknown state: ${input.role}:${input.path}`);
      continue;
    }
    const path = input.scope === "akari"
      ? resolveAkariFile(input.path, problems)
      : resolveProjectFile(projectRoot, input.path, `receipt input ${input.role}`, problems);
    if (!path) continue;
    const digest = await sha256File(path);
    if (digest.sha256 !== input.sha256 || digest.bytes !== input.bytes) {
      problems.push(`receipt input changed: ${input.role}:${input.path}`);
    }
  }

  if (!isRecord(receipt.output) || !isSafeRelativePath(receipt.output.path)
    || !Number.isInteger(receipt.output.bytes) || !isSha(receipt.output.sha256)) {
    problems.push("render receipt output is invalid");
  } else {
    const outputPath = resolveProjectFile(projectRoot, receipt.output.path, "render output", problems);
    if (outputPath) {
      const digest = await sha256File(outputPath);
      if (digest.sha256 !== receipt.output.sha256 || digest.bytes !== receipt.output.bytes) {
        problems.push(`render output changed: ${receipt.output.path}`);
      }
    }
  }
  if (receipt.verify?.verdict !== "pass") problems.push("render receipt verify verdict is not pass");
  if (!isSha(receipt.plan_sha256) || sha256(canonicalJson(render.plan)) !== receipt.plan_sha256) {
    problems.push("current render plan does not match the receipt");
  }

  const lintPath = resolveProjectFile(projectRoot, ".akari/lint.json", "lint", problems);
  if (!isSha(receipt.lint_sha256) || (lintPath && (await sha256File(lintPath)).sha256 !== receipt.lint_sha256)) {
    problems.push("current lint does not match the receipt");
  }
  const reviewPath = join(projectRoot, "review.json");
  let reviewSha256;
  if (receipt.review_state === "absent") {
    reviewSha256 = sha256(ABSENT_REVIEW_SENTINEL);
    if (existsSync(reviewPath)) problems.push("review.json appeared after the render receipt");
  } else if (receipt.review_state === "present") {
    const safeReview = resolveProjectFile(projectRoot, "review.json", "review", problems);
    reviewSha256 = safeReview ? (await sha256File(safeReview)).sha256 : null;
  } else {
    problems.push("render receipt review_state is invalid");
  }
  if (!isSha(receipt.review_sha256) || reviewSha256 !== receipt.review_sha256) {
    problems.push("current review does not match the receipt");
  }

  validateCaptionLayoutIntegrity(projectRoot, render, receipt, problems);
  const editForQc = readJson(join(projectRoot, "edit.json"), "edit.json", problems);
  const hasAudioMaster = isRecord(editForQc?.audio?.master);
  if (hasAudioMaster !== isRecord(receipt.audio_qc)) {
    problems.push(hasAudioMaster ? "render receipt is missing required audio_qc" : "render receipt has unexpected audio_qc");
  }
  if (hasAudioMaster) {
    if (canonicalJson(render.audio_qc) !== canonicalJson(receipt.audio_qc)) problems.push("render audio_qc does not match the receipt");
    validateAudioQc(receipt.audio_qc, problems, warnings);
  }

  const candidate = problems.length === 0 ? {
    receipt: relative(projectRoot, receiptPath),
    receipt_sha256: receiptSha256,
    artifact: receipt.output.path,
    artifact_sha256: receipt.output.sha256,
    review_sha256: receipt.review_sha256,
    ...(receipt.audio_qc ? { audio_qc: receipt.audio_qc } : {}),
  } : null;

  const eventResult = events ? { events, problems: [] } : readProjectEvents(projectRoot);
  problems.push(...eventResult.problems);
  const acceptanceState = resolveActiveAcceptance(eventResult.events);
  problems.push(...acceptanceState.problems);
  let activeAcceptance = acceptanceState.activeAcceptance;
  if (activeAcceptance && candidate) {
    const payload = activeAcceptance.payload;
    if (payload.artifact !== candidate.artifact
      || payload.artifact_sha256 !== candidate.artifact_sha256
      || payload.render_receipt !== candidate.receipt
      || payload.render_receipt_sha256 !== candidate.receipt_sha256
      || payload.review_sha256 !== candidate.review_sha256) {
      problems.push(`acceptance ${activeAcceptance.id} does not match the current verified receipt`);
      activeAcceptance = null;
    }
  }
  return result(candidate, activeAcceptance, acceptanceState.revoked && activeAcceptance === null);

  function result(candidate = null, activeAcceptance = null, revoked = false) {
    return {
      ok: problems.length === 0,
      candidate,
      activeAcceptance,
      revoked,
      problems: [...new Set(problems)].sort((a, b) => a.localeCompare(b, "en")),
      warnings,
    };
  }
}

function validateCaptionLayoutIntegrity(projectRoot, render, receipt, problems) {
  const reference = receipt.caption_layout;
  if (render.caption_layout === undefined && reference === undefined) return;
  if (!isRecord(reference) || canonicalJson(render.caption_layout) !== canonicalJson(reference)
    || reference.schema !== "caption-layout/v1" || !isSha(reference.sha256) || !isRecord(reference.summary)) {
    problems.push("caption layout receipt reference is invalid or does not match render.json");
    return;
  }
  const path = resolveProjectFile(projectRoot, reference.path, "caption layout", problems);
  if (!path) return;
  const bytes = readFileSync(path, "utf8");
  if (sha256(bytes) !== reference.sha256 || !contentAddressedJsonFilenameMatches(path, reference.sha256)) {
    problems.push("caption layout file digest or filename does not match its receipt reference");
    return;
  }
  try {
    const layout = JSON.parse(bytes);
    for (const field of ["source_cue_count", "occurrence_count", "display_cue_count", "split_source_cue_count"]) {
      if (!Number.isInteger(reference.summary[field]) || layout[field] !== reference.summary[field]) problems.push(`caption layout summary ${field} is invalid`);
    }
    if (!isSha(reference.summary.boundary_projection_sha256)
      || layout.boundary_projection_sha256 !== reference.summary.boundary_projection_sha256
      || sha256(JSON.stringify(layout.boundary_projection)) !== reference.summary.boundary_projection_sha256) {
      problems.push("caption layout boundary projection digest is invalid");
    }
    if (!isNonEmptyString(layout.runtime?.node) || !isNonEmptyString(layout.runtime?.icu)) problems.push("caption layout runtime Node/ICU metadata is invalid");
  } catch (error) {
    problems.push(`caption layout is not valid JSON: ${messageOf(error)}`);
  }
}

/**
 * File identity and containment are validated separately. This helper only
 * validates the final content-addressed filename, using the host path API in
 * production and an injectable basename in cross-platform contract tests.
 */
export function contentAddressedJsonFilenameMatches(filePath, sha256Value, basenameImpl = basename) {
  return basenameImpl(filePath) === `${sha256Value}.json`;
}

function validateAudioQc(value, problems, warnings) {
  if (!isRecord(value) || !isRecord(value.configured)
    || !isFiniteNumber(value.configured.integrated_lufs) || !isFiniteNumber(value.configured.true_peak_dbtp)
    || !isNonEmptyString(value.tool_version)) {
    problems.push("audio_qc configured target or tool version is invalid");
    return;
  }
  if (value.verdict === "MEASUREMENT_ERROR") {
    problems.push("audio_qc measurement failed");
    const phases = new Set(["filter_report", "decoded_measurement"]);
    const codes = new Set(["JSON_NOT_FOUND", "MISSING_FIELD", "INVALID_VALUE", "CAPTURE_LIMIT", "PROCESS_FAILED"]);
    if (!isRecord(value.error) || !phases.has(value.error.phase) || !codes.has(value.error.code)
      || !isNonEmptyString(value.error.message)) {
      problems.push("audio_qc measurement error detail is invalid");
      return;
    }
    if (value.decoded_measurement !== null) problems.push("audio_qc failed decoded_measurement must be null");
    if (value.error.phase === "filter_report") {
      if (value.filter_report !== null) problems.push("audio_qc failed filter_report must be null");
    } else {
      validateQcReport(value.filter_report, ["output_i", "output_tp"], "audio_qc.filter_report", problems);
    }
    return;
  }
  if (value.verdict !== "INCONCLUSIVE") {
    problems.push("audio_qc verdict is invalid");
    return;
  }
  validateQcReport(value.filter_report, ["output_i", "output_tp"], "audio_qc.filter_report", problems);
  if (!isRecord(value.decoded_measurement) || value.decoded_measurement.metric !== "ffmpeg-loudnorm-input-v1") {
    problems.push("audio_qc.decoded_measurement metric is invalid");
  } else {
    validateQcReport(value.decoded_measurement, ["input_i", "input_tp"], "audio_qc.decoded_measurement", problems);
  }
  if (value.error !== undefined) problems.push("audio_qc INCONCLUSIVE must not contain an error");
  warnings.push("audio_qc is INCONCLUSIVE; configured target, filter report, and decoded measurement require human review");
}

// akari-audio-qc-decimal-v1: exact finite base-10 text only. This intentionally duplicates the
// render-cut grammar because status-core is distributed as a self-contained generated mirror.
const STRICT_FINITE_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

function validateQcReport(value, fields, label, problems) {
  if (!isRecord(value) || !isRecord(value.raw) || !isRecord(value.normalized)) {
    problems.push(`${label} is invalid`);
    return;
  }
  for (const field of fields) {
    const raw = value.raw[field];
    const normalized = value.normalized[field];
    if (typeof raw !== "string") {
      problems.push(`${label}.${field} raw value is invalid`);
    } else if (raw === "-inf") {
      if (normalized !== "-inf") problems.push(`${label}.${field} raw/normalized values disagree`);
    } else if (!STRICT_FINITE_DECIMAL.test(raw) || !Number.isFinite(Number(raw)) || normalized !== Number(raw)) {
      problems.push(`${label}.${field} raw/normalized values disagree`);
    }
  }
}

function readJson(path, label, problems) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    problems.push(`${label} could not be read: ${messageOf(error)}`);
    return null;
  }
}

function resolveProjectFile(root, value, label, problems) {
  if (!isSafeRelativePath(value)) {
    problems.push(`${label} path is not safe and project-relative`);
    return null;
  }
  const lexical = resolve(root, value);
  if (!isWithin(root, lexical)) {
    problems.push(`${label} escapes the project root`);
    return null;
  }
  try {
    const actual = realpathSync(lexical);
    if (!isWithin(root, actual) || !lstatSync(lexical).isFile()) {
      problems.push(`${label} is not a regular project file`);
      return null;
    }
    return actual;
  } catch (error) {
    problems.push(`${label} could not be resolved: ${messageOf(error)}`);
    return null;
  }
}

function resolveAkariFile(value, problems) {
  if (!value.startsWith("akari:") || !isSafeRelativePath(value.slice(6))) {
    problems.push(`AKARI input path is invalid: ${value}`);
    return null;
  }
  const relativePath = value.slice(6);
  const candidates = [
    resolve(CORE_DIRECTORY, "../../../..", relativePath),
    resolve(CORE_DIRECTORY, "../../..", relativePath),
    resolve(CORE_DIRECTORY, "..", relativePath),
    resolve(CORE_DIRECTORY, "../..", "vendor", relativePath),
  ];
  for (const candidate of candidates) {
    try {
      const actual = realpathSync(candidate);
      if (lstatSync(actual).isFile()) return actual;
    } catch {
      // Try the next supported distribution topology.
    }
  }
  problems.push(`AKARI package input is unavailable in this distribution: ${relativePath}`);
  return null;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => { bytes += chunk.length; hash.update(chunk); });
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return { sha256: hash.digest("hex"), bytes };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort((a, b) => a.localeCompare(b, "en"))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isSafeRelativePath(value) {
  return isNonEmptyString(value) && !isAbsolute(value) && !value.split(/[\\/]/u).includes("..");
}

function isWithin(root, target) {
  const value = relative(root, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isSha(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
