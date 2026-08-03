import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import { readProjectEvents, resolveActiveAcceptance } from "./events.mjs";
import { inspectFullIntegrity } from "./integrity.mjs";
import { validateAndCountReview } from "./review.mjs";

const MEDIA_EXTENSIONS = new Set([
  ".aac", ".aif", ".aiff", ".avi", ".bmp", ".flac", ".gif", ".jpeg", ".jpg",
  ".m4a", ".m4v", ".mkv", ".mov", ".mp3", ".mp4", ".ogg", ".png", ".wav",
  ".webm", ".webp",
]);
const LINT_VERDICTS = new Set(["pass", "fail"]);
const RENDER_PHASES = new Set(["planned", "rendered", "verified", "error"]);

export function resolveProjectStatus(input = process.cwd(), { mode = "fast" } = {}) {
  if (mode !== "fast" && mode !== "full") throw new TypeError(`unsupported status mode: ${mode}`);
  const resolvedInput = resolve(input);
  let projectRoot = resolvedInput;
  try {
    projectRoot = realpathSync(resolvedInput);
  } catch {
    // A non-existent target is a normal non-project result; keep the lexical path for its name.
  }
  const problems = [];
  const warnings = [];
  const projectName = basename(projectRoot) || "project";
  const akariDirectory = join(projectRoot, ".akari");
  const connectionsPath = join(akariDirectory, "connections.json");
  const scaffolded = existsSync(akariDirectory) && existsSync(connectionsPath);

  let workflow = null;
  let intake = null;
  let interpretation = null;
  let plan = null;
  let edit = null;
  let review = null;
  let lint = null;
  let render = null;

  if (scaffolded) {
    readAuthoritativeJson(connectionsPath, ".akari/connections.json", problems);
    workflow = readAuthoritativeJson(join(akariDirectory, "workflow.json"), ".akari/workflow.json", problems, { optional: true });
    intake = readAuthoritativeJson(join(akariDirectory, "intake.json"), ".akari/intake.json", problems, { optional: true });
    interpretation = readAuthoritativeJson(join(projectRoot, "interpretation.json"), "interpretation.json", problems, { optional: true });
    plan = readAuthoritativeJson(join(projectRoot, "plan.json"), "plan.json", problems, { optional: true });
    edit = readAuthoritativeJson(join(projectRoot, "edit.json"), "edit.json", problems, { optional: true });
    review = readAuthoritativeJson(join(projectRoot, "review.json"), "review.json", problems, { optional: true });
    lint = readAuthoritativeJson(join(akariDirectory, "lint.json"), ".akari/lint.json", problems, { optional: true });
    render = readAuthoritativeJson(join(akariDirectory, "render.json"), ".akari/render.json", problems, { optional: true });
  }

  validateWorkflow(workflow, problems);
  validateIntake(intake, problems);
  validateInterpretationShape(interpretation, problems);
  validatePlan(plan, problems);
  validateEdit(edit, problems);
  const reviewResult = validateAndCountReview(review);
  const reviewCounts = reviewResult.counts;
  problems.push(...reviewResult.problems);
  validateLint(lint, problems);
  validateRender(render, problems);

  const { events, problems: eventProblems } = readProjectEvents(projectRoot, {
    gateTypes: Array.isArray(workflow?.events?.gateTypes) ? workflow.events.gateTypes : [],
  });
  problems.push(...eventProblems);
  const acceptanceState = resolveActiveAcceptance(events);
  problems.push(...acceptanceState.problems);

  const materials = scaffolded
    ? resolveMaterialState({ projectRoot, edit, interpretation, problems, warnings })
    : { sources: [], fixed: false, covered: new Set() };

  let stage = "not_scaffolded";
  if (scaffolded) {
    if (!intake || intake.status !== "submitted") stage = "intake_pending";
    else if (materials.sources.length > materials.covered.size) stage = "analysis_pending";
    else if (materials.sources.length > 1 && !interpretation) stage = "interpretation_pending";
    else if (materials.sources.length === 0 && !plan) stage = "planning_pending";
    else if (!edit) stage = "edit_pending";
    else if (reviewCounts.open > 0) stage = "review_pending";
    else if (reviewCounts.addressed > 0) stage = "human_review_pending";
    else if (!lint || lint.verdict !== "pass" || !lintMatchesCurrent(lint, edit, review, projectRoot)) stage = "lint_pending";
    else if (!render || render.phase !== "verified" || render.verify?.verdict !== "pass") stage = "render_pending";
    else stage = "acceptance_pending";
  }

  if (problems.length > 0) stage = "state_inconclusive";
  const stateHealth = problems.length > 0 ? "inconclusive" : "valid";
  const finalEvents = events.filter((event) => event.type === "final-acceptance");
  const activeRecorded = acceptanceState.activeAcceptance !== null;
  const releaseState = problems.length > 0
    ? "inconclusive"
    : activeRecorded
      ? "acceptance_recorded_unverified"
      : finalEvents.length > 0
        ? "acceptance_revoked_unverified"
      : stage === "acceptance_pending"
        ? "acceptance_pending"
        : "not_accepted";

  const routing = routeForStage(stage, reviewCounts, materials);
  return {
    version: 1,
    mode,
    project: { name: projectName, scaffolded },
    workflow_stage: stage,
    state_health: stateHealth,
    waiting_on: routing.waiting_on,
    next_skill: routing.next_skill,
    review: reviewCounts,
    release: { state: releaseState, accepted: false },
    problems: [...new Set(problems)].sort((a, b) => a.localeCompare(b, "en")),
    warnings: [...new Set(warnings)].sort((a, b) => a.localeCompare(b, "en")),
  };
}

export async function resolveFullProjectStatus(input = process.cwd()) {
  const status = resolveProjectStatus(input, { mode: "full" });
  if (status.workflow_stage !== "acceptance_pending" || status.state_health !== "valid") return status;
  const integrity = await inspectFullIntegrity(input);
  status.warnings = [...new Set([...status.warnings, ...integrity.warnings])]
    .sort((a, b) => a.localeCompare(b, "en"));
  if (!integrity.ok || !integrity.candidate) {
    status.workflow_stage = "state_inconclusive";
    status.state_health = "inconclusive";
    status.waiting_on = null;
    status.next_skill = null;
    status.release = { state: "inconclusive", accepted: false };
    status.problems = [...new Set([...status.problems, ...integrity.problems])]
      .sort((a, b) => a.localeCompare(b, "en"));
    return status;
  }
  if (integrity.activeAcceptance) {
    status.workflow_stage = "accepted_verified";
    status.waiting_on = null;
    status.next_skill = null;
    status.release = {
      state: "accepted_verified",
      accepted: true,
      receipt: integrity.candidate.receipt,
      artifact: integrity.candidate.artifact,
      artifact_sha256: integrity.candidate.artifact_sha256,
    };
    return status;
  }
  status.release = {
    state: integrity.revoked ? "acceptance_revoked" : "ready_for_acceptance",
    accepted: false,
  };
  return status;
}

export function serializeStatus(status) {
  return `${JSON.stringify(status, null, 2)}\n`;
}

export function formatStatusSummary(status) {
  const next = status.next_skill ? ` Next skill: ${status.next_skill}.` : "";
  const wait = status.waiting_on ? ` Waiting on ${status.waiting_on.kind}: ${status.waiting_on.action}.` : "";
  return `AKARI status: ${status.workflow_stage} (${status.state_health}).${next}${wait}`;
}

function readAuthoritativeJson(filePath, label, problems, { optional = false } = {}) {
  if (!existsSync(filePath)) {
    if (!optional) problems.push(`${label} is missing`);
    return null;
  }
  try {
    if (!lstatSync(filePath).isFile()) {
      problems.push(`${label} is not a regular file`);
      return null;
    }
    const value = JSON.parse(readFileSync(filePath, "utf8"));
    if (!isRecord(value)) problems.push(`${label} root must be an object`);
    return value;
  } catch (error) {
    problems.push(`${label} is not valid JSON: ${messageOf(error)}`);
    return null;
  }
}

function validateWorkflow(value, problems) {
  if (!value) return;
  if (value.version !== 1) problems.push(`.akari/workflow.json has unsupported version ${String(value.version)}`);
  if (!Array.isArray(value.roles) || !isRecord(value.events)) problems.push(".akari/workflow.json has an invalid shape");
}

function validateIntake(value, problems) {
  if (!value) return;
  if (value.version !== 1) problems.push(`.akari/intake.json has unsupported version ${String(value.version)}`);
  if (value.status !== "draft" && value.status !== "submitted") problems.push(`.akari/intake.json has unknown status ${String(value.status)}`);
}

function validateInterpretationShape(value, problems) {
  if (!value) return;
  if (value.version !== 0) problems.push(`interpretation.json has unsupported version ${String(value.version)}`);
  if (!Array.isArray(value.inputs?.analyses) || value.inputs.analyses.length === 0) {
    problems.push("interpretation.json inputs.analyses must be a non-empty array");
  }
}

function validatePlan(value, problems) {
  if (!value) return;
  if (value.version !== 0) problems.push(`plan.json has unsupported version ${String(value.version)}`);
  if (value.slots !== undefined && !Array.isArray(value.slots)) problems.push("plan.json slots must be an array");
}

function validateEdit(value, problems) {
  if (!value) return;
  if (value.version !== 0 && value.version !== 1) {
    problems.push(`edit.json has unsupported version ${String(value.version)}`);
    return;
  }
  if (!isRecord(value.output) || !Array.isArray(value.overlays)) problems.push("edit.json has an invalid output/overlays shape");
  if (value.version === 0) {
    if (!isNonEmptyString(value.source?.path) || Object.hasOwn(value, "sources")) problems.push("edit.json v0 source shape is invalid");
  } else {
    if (!Array.isArray(value.sources) || Object.hasOwn(value, "source") || !Array.isArray(value.cuts)) {
      problems.push("edit.json v1 sources/cuts shape is invalid");
      return;
    }
    const ids = new Set();
    for (const source of value.sources) {
      if (!isNonEmptyString(source?.id) || !isNonEmptyString(source?.path) || ids.has(source.id)) {
        problems.push("edit.json v1 sources are invalid or duplicated");
        break;
      }
      ids.add(source.id);
    }
    for (const cut of value.cuts) {
      if (!isRecord(cut) || !ids.has(cut.src)) {
        problems.push(`edit.json cut references unknown source ${String(cut?.src)}`);
        break;
      }
    }
  }
}

function validateLint(value, problems) {
  if (!value) return;
  if (value.version !== 1 || !LINT_VERDICTS.has(value.verdict) || !isRecord(value.inputs)) {
    problems.push(".akari/lint.json has an unsupported version, verdict, or inputs shape");
  }
}

function validateRender(value, problems) {
  if (!value) return;
  if (value.version !== 1 || !RENDER_PHASES.has(value.phase)) {
    problems.push(`.akari/render.json has an unsupported version or phase ${String(value.phase)}`);
  }
  if (value.verify !== null && value.verify !== undefined
    && value.verify.verdict !== "pass" && value.verify.verdict !== "fail") {
    problems.push(`.akari/render.json has unknown verify verdict ${String(value.verify?.verdict)}`);
  }
}

function resolveMaterialState({ projectRoot, edit, interpretation, problems, warnings }) {
  let sources = [];
  let fixed = false;
  if (edit) {
    fixed = true;
    if (edit.version === 0 && isNonEmptyString(edit.source?.path)) {
      sources = [resolveProjectPath(projectRoot, edit.source.path, "edit source", problems)];
    } else if (edit.version === 1 && Array.isArray(edit.sources) && Array.isArray(edit.cuts)) {
      const usedIds = new Set(edit.cuts.map((cut) => cut?.src));
      sources = edit.sources
        .filter((source) => usedIds.has(source.id))
        .map((source) => resolveProjectPath(projectRoot, source.path, `edit source ${source.id}`, problems));
    }
  } else if (interpretation && Array.isArray(interpretation.inputs?.analyses)) {
    fixed = true;
    for (const [index, entry] of interpretation.inputs.analyses.entries()) {
      if (!isNonEmptyString(entry?.path)) {
        problems.push(`interpretation analysis ${index} has no path`);
        continue;
      }
      const analysisPath = resolveProjectPath(projectRoot, entry.path, `interpretation analysis ${index}`, problems);
      const analysis = analysisPath ? readAuthoritativeJson(analysisPath, entry.path, problems) : null;
      const source = resolveAnalysisSource(projectRoot, analysisPath, analysis, problems);
      if (source) sources.push(source);
    }
  } else {
    sources = listCandidateMedia(projectRoot, warnings);
  }
  sources = uniquePaths(sources.filter(Boolean));
  const covered = new Set();
  for (const source of sources) {
    const analysis = findAnalysisForSource(projectRoot, source, problems, warnings);
    if (analysis) covered.add(source);
  }
  if (!fixed && sources.length > 0) warnings.push("material paths are candidates because edit.json and interpretation.json are absent");
  return { sources, fixed, covered };
}

function findAnalysisForSource(projectRoot, sourcePath, problems, warnings) {
  const sourceRelative = relative(projectRoot, sourcePath);
  const stem = basename(sourcePath, extname(sourcePath));
  const candidates = [
    join(projectRoot, ".akari", "sidecars", `${sourceRelative}.analysis`, "analysis.json"),
    join(dirname(sourcePath), "analysis", stem, "analysis.json"),
    join(dirname(sourcePath), "analysis", "analysis.json"),
    join(projectRoot, "analysis.json"),
  ];
  for (const analysisPath of uniquePaths(candidates)) {
    if (!existsSync(analysisPath)) continue;
    const analysis = readAuthoritativeJson(analysisPath, relative(projectRoot, analysisPath), problems);
    if (!analysis) return null;
    if (analysis.version !== 0 || !isNonEmptyString(analysis.source)) {
      problems.push(`${relative(projectRoot, analysisPath)} has an unsupported analysis contract`);
      return null;
    }
    const resolved = resolveAnalysisSource(projectRoot, analysisPath, analysis, problems);
    if (resolved === sourcePath) return analysisPath;
    warnings.push(`${relative(projectRoot, analysisPath)} is stale for ${sourceRelative}`);
  }
  return null;
}

function resolveAnalysisSource(projectRoot, analysisPath, analysis, problems) {
  if (!analysis || analysis.version !== 0 || !isNonEmptyString(analysis.source)) return null;
  return resolveProjectPath(projectRoot, resolve(dirname(analysisPath), analysis.source), "analysis source", problems);
}

function listCandidateMedia(projectRoot, warnings) {
  const candidates = [];
  const assets = join(projectRoot, "assets");
  visitMediaDirectory(assets, candidates, warnings);
  let rootEntries = [];
  try {
    rootEntries = readdirSync(projectRoot, { withFileTypes: true });
  } catch (error) {
    warnings.push(`project directory could not be enumerated: ${messageOf(error)}`);
  }
  for (const entry of rootEntries) {
    if (entry.isFile() && MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      candidates.push(join(projectRoot, entry.name));
    }
  }
  return uniquePaths(candidates);
}

function visitMediaDirectory(directory, candidates, warnings) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") warnings.push(`assets directory could not be enumerated: ${messageOf(error)}`);
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visitMediaDirectory(path, candidates, warnings);
    else if (entry.isFile() && MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase())) candidates.push(path);
  }
}

function resolveProjectPath(projectRoot, value, label, problems) {
  if (!isNonEmptyString(value)) return null;
  const path = isAbsolute(value) ? resolve(value) : resolve(projectRoot, value);
  if (!isWithin(projectRoot, path)) {
    problems.push(`${label} escapes the project root`);
    return null;
  }
  try {
    const realRoot = realpathSync(projectRoot);
    const realPath = realpathSync(path);
    if (!isWithin(realRoot, realPath) || !lstatSync(path).isFile()) {
      problems.push(`${label} is not a regular project file`);
      return null;
    }
    return realPath;
  } catch (error) {
    problems.push(`${label} could not be resolved: ${messageOf(error)}`);
    return null;
  }
}

function lintMatchesCurrent(lint, edit, review, projectRoot) {
  if (!lint?.inputs?.edit_json_sha256 || !edit) return false;
  const editText = readFileSync(join(projectRoot, "edit.json"), "utf8");
  if (sha256Text(editText) !== lint.inputs.edit_json_sha256) return false;
  if (review) {
    const reviewText = readFileSync(join(projectRoot, "review.json"), "utf8");
    if (!isSha(lint.inputs.review_json_sha256)
      || sha256Text(reviewText) !== lint.inputs.review_json_sha256) return false;
  } else if (Object.hasOwn(lint.inputs, "review_json_sha256")) {
    return false;
  }
  return true;
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function routeForStage(stage, review, materials) {
  const routes = {
    state_inconclusive: [null, null],
    not_scaffolded: [{ kind: "human", action: "create-project", reason: "project is not scaffolded" }, "create-project"],
    intake_pending: [{ kind: "human", action: "complete-intake", reason: "project intake is not submitted" }, null],
    analysis_pending: [{ kind: "agent", action: "analyze-footage", reason: `analysis coverage ${materials.covered.size}/${materials.sources.length}` }, "analyze-footage"],
    interpretation_pending: [{ kind: "agent", action: "analyze-project", reason: "multiple materials require project interpretation" }, "analyze-project"],
    planning_pending: [{ kind: "agent", action: "edit-plan", reason: materials.sources.length === 0 ? "zero-material planning has not started" : "plan.json is absent" }, "edit-plan"],
    edit_pending: [{ kind: "agent", action: "edit-plan", reason: "edit.json is absent" }, "edit-plan"],
    review_pending: [{ kind: "agent", action: "address-review", reason: `open review tickets: ${review.open}` }, "address-review"],
    human_review_pending: [{ kind: "human", action: "resolve-review", reason: `addressed review tickets: ${review.addressed}` }, null],
    lint_pending: [{ kind: "agent", action: "edit-lint", reason: "current edit/review has no fresh PASS lint" }, "edit-lint"],
    render_pending: [{ kind: "human", action: "render-cut", reason: "current render is not verified PASS" }, "render-cut"],
    acceptance_pending: [{ kind: "human", action: "akari-accept", reason: "verified render needs final human acceptance" }, null],
  };
  const [waiting_on, next_skill] = routes[stage] ?? [null, null];
  return { waiting_on, next_skill };
}

function isWithin(root, target) {
  const value = relative(root, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function uniquePaths(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "en"));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isSha(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
