#!/usr/bin/env node
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { canonicalJson, codePointCompare, sha256 } from "./canonical-json.mjs";
import { CutCandidateError, assertErrorDefinitions, failureBytes } from "./errors.mjs";
import {
  validateAnalysisSemantics,
  validateCutCandidatesSemantics,
  validateSemanticKeepPlanSemantics,
  generatedRowsSha256,
  RESIDUAL_RISK_ORDER,
} from "./contract-semantics.mjs";
import {
  buildCandidates,
  createSilenceOutputParser,
  finalizeCandidateKeyframes,
  finalizeSkipped,
  normalizeProbe,
} from "./candidate-core.mjs";
import {
  decodeUtf8,
  detectorArgv,
  detectorArgvTemplate,
  discoverAnalysisCandidates,
  nodeReceipt,
  normalizeProjectRelative,
  parseJsonSnapshot,
  probeArgv,
  reportBytes,
  resolveAnalysisRelativeFile,
  resolveProject,
  resolveProjectFile,
  resolveTool,
  runChild,
  snapshotFile,
  verifySnapshot,
  writeContentAddressed,
} from "./runtime-support.mjs";

const require = createRequire(import.meta.url);
const validatorPath = fileURLToPath(new URL("./generated/contract-validators.cjs", import.meta.url));
const validators = require(validatorPath);
const binDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(binDirectory);
const POLICY_RELATIVE = "references/cut-candidate-policy.a4-conversation-v1.json";
const APPROVAL_PATTERN = /^checkpoint-1\/[a-z0-9](?:[a-z0-9-]{0,62})\/[0-9]{4}-[0-9]{2}-[0-9]{2}(?:-r[0-9]{1,3})?$/u;
const MAX_INPUT = Object.freeze({
  keepPlan: 8 * 1024 * 1024,
  decisionLog: 8 * 1024 * 1024,
  analysis: 64 * 1024 * 1024,
  source: Number.MAX_SAFE_INTEGER,
  keyframes: 512 * 1024 * 1024,
});
const HELPER_TIMEOUT_MS = 7_200_000;
const MAX_PEAK_RSS_BYTES = 512 * 1024 * 1024;
const MAX_ANALYSIS_RECORDS = 1_000_000;
const MAX_SILENCE_PAIRS = 1_000_000;
const EXPECTED_POLICY = Object.freeze({
  version: 1,
  id: "a4-conversation-v1",
  silence_detection_db: -35,
  minimum_silence_seconds: 0.45,
  retained_pause_seconds: Object.freeze({
    within_sentence: 0.1,
    sentence_end: 0.166667,
    topic_transition: 0.3,
  }),
  surrounding_context_seconds: 1,
  speech_guard_seconds: 0.033333,
  frame_rate: 30,
});

function fail(code) {
  throw new CutCandidateError(code);
}

function peakRssBytes() {
  return Math.max(process.memoryUsage().rss, process.resourceUsage().maxRSS * 1024);
}

export function checkBudget(deadlineAt, { now = Date.now(), rssBytes = peakRssBytes() } = {}) {
  if (now >= deadlineAt || rssBytes > MAX_PEAK_RSS_BYTES) fail("INPUT_BUDGET_EXCEEDED");
}

export function addAnalysisRecords(recordBudget, additional, maximum = MAX_ANALYSIS_RECORDS) {
  if (!Number.isSafeInteger(additional) || additional < 0
    || recordBudget.count > maximum - additional) fail("INPUT_BUDGET_EXCEEDED");
  recordBudget.count += additional;
}

function parseArguments(argv) {
  const values = new Map();
  let write = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") {
      if (write) fail("USAGE_ERROR");
      write = true;
      continue;
    }
    if (!["--project", "--keep-plan", "--decision-log", "--approval-ref"].includes(argument)
      || values.has(argument) || index + 1 >= argv.length || argv[index + 1].startsWith("--")) fail("USAGE_ERROR");
    values.set(argument, argv[index + 1]);
    index += 1;
  }
  if (values.size !== 4) fail("USAGE_ERROR");
  return {
    project: values.get("--project"),
    keepPlan: values.get("--keep-plan"),
    decisionLog: values.get("--decision-log"),
    approvalRef: values.get("--approval-ref"),
    write,
  };
}

export function policyValues(policy) {
  if (canonicalJson(policy) !== canonicalJson(EXPECTED_POLICY)) fail("REPORT_INVALID");
  return {
    silence_detection_db: policy.silence_detection_db,
    minimum_silence_seconds: policy.minimum_silence_seconds,
    retained_pause_seconds: policy.retained_pause_seconds,
    surrounding_context_seconds: policy.surrounding_context_seconds,
    speech_guard_seconds: policy.speech_guard_seconds,
    frame_rate: policy.frame_rate,
  };
}

async function moduleReceipts(resourceGuard) {
  const roles = new Map([
    ["bin/propose-cut-candidates.mjs", "entrypoint"],
    ["bin/contract-semantics.mjs", "semantic_validator"],
    ["bin/generated/contract-validators.cjs", "schema_validator"],
  ]);
  const esmSnapshots = await discoverLocalEsmModules(
    "bin/propose-cut-candidates.mjs", skillRoot, resourceGuard,
  );
  const cjsModules = Object.keys(require.cache)
    .filter((absolute) => absolute === validatorPath || absolute.startsWith(path.join(binDirectory, "generated", "runtime") + path.sep))
    .map((absolute) => path.relative(skillRoot, absolute).split(path.sep).join("/"));
  const relativePaths = [...new Set([...esmSnapshots.keys(), ...cjsModules])].sort(codePointCompare);
  const snapshots = [];
  const receipts = [];
  for (const relative of relativePaths) {
    const absolute = path.join(skillRoot, relative);
    const resolved = await realpath(absolute).catch(() => fail("TOOL_BINARY_INVALID"));
    if (resolved !== absolute) fail("TOOL_BINARY_INVALID");
    const stat = await lstat(absolute, { bigint: true }).catch(() => fail("TOOL_BINARY_INVALID"));
    if (!stat.isFile() || stat.isSymbolicLink()) fail("TOOL_BINARY_INVALID");
    const snapshot = esmSnapshots.get(relative) ?? await snapshotFile(
      { absolute, relative }, 64 * 1024 * 1024, false, "TOOL_BINARY_INVALID", resourceGuard, skillRoot,
    );
    snapshots.push(snapshot);
    receipts.push({
      role: roles.get(relative) ?? (relative.startsWith("bin/generated/runtime/") ? "vendor_runtime" : "helper"),
      skill_relative_path: relative,
      bytes: snapshot.bytes,
      sha256: snapshot.sha256,
    });
  }
  const aggregate = Buffer.from(receipts.map((receipt) => canonicalJson(receipt)).join("\n") + "\n", "utf8");
  return { receipts, snapshots, aggregateSha256: sha256(aggregate) };
}

const STATIC_IMPORT_PATTERN = /(?:^|\n)\s*import\s+(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/gu;

export async function discoverLocalEsmModules(entryRelative, root = skillRoot, resourceGuard = () => {}) {
  const pending = [entryRelative];
  const snapshots = new Map();
  while (pending.length > 0) {
    pending.sort(codePointCompare);
    const relative = pending.shift();
    if (snapshots.has(relative) || !relative.startsWith("bin/") || !relative.endsWith(".mjs")) {
      if (!snapshots.has(relative)) fail("TOOL_BINARY_INVALID");
      continue;
    }
    const absolute = path.resolve(root, relative);
    if (path.relative(root, absolute).startsWith(`..${path.sep}`)) fail("TOOL_BINARY_INVALID");
    if (await realpath(absolute).catch(() => fail("TOOL_BINARY_INVALID")) !== absolute) fail("TOOL_BINARY_INVALID");
    const snapshot = await snapshotFile(
      { absolute, relative }, 64 * 1024 * 1024, true, "TOOL_BINARY_INVALID", resourceGuard, root,
    );
    snapshots.set(relative, snapshot);
    const source = decodeUtf8(snapshot.data, "TOOL_BINARY_INVALID");
    for (const match of source.matchAll(STATIC_IMPORT_PATTERN)) {
      const specifier = match[1];
      if (specifier.startsWith("node:")) continue;
      if (!specifier.startsWith(".")) fail("TOOL_BINARY_INVALID");
      const importedAbsolute = path.resolve(path.dirname(absolute), specifier);
      const importedRelative = path.relative(root, importedAbsolute).split(path.sep).join("/");
      if (!snapshots.has(importedRelative)) pending.push(importedRelative);
    }
  }
  return new Map([...snapshots].sort(([left], [right]) => codePointCompare(left, right)));
}

async function selectAnalysis(root, sourceFile, duration, resourceGuard) {
  const candidates = await discoverAnalysisCandidates(root, sourceFile.relative);
  const matches = [];
  let invalidCount = 0;
  for (const candidate of candidates) {
    let snapshot;
    let analysis;
    try {
      snapshot = await snapshotFile(candidate, MAX_INPUT.analysis, true, "INPUT_HASH_DRIFT", resourceGuard, root);
      analysis = parseJsonSnapshot(snapshot, "ANALYSIS_SCHEMA_INVALID");
      if (!validators.validateAnalysis(analysis)) {
        invalidCount += 1;
        continue;
      }
      const declaredSource = await resolveAnalysisRelativeFile(root, path.dirname(candidate.absolute), analysis.source);
      if (declaredSource.absolute !== sourceFile.absolute) continue;
      matches.push({ snapshot, analysis, directory: path.dirname(candidate.absolute) });
    } catch (error) {
      if (error instanceof CutCandidateError && error.code === "ANALYSIS_SCHEMA_INVALID") {
        invalidCount += 1;
        continue;
      }
      throw error;
    }
  }
  if (matches.length > 1) fail("ANALYSIS_AMBIGUOUS");
  if (matches.length === 0) {
    if (invalidCount > 0) fail("ANALYSIS_SCHEMA_INVALID");
    fail("ANALYSIS_MISSING");
  }
  const { recordCount } = validateAnalysisSemantics(matches[0].analysis, duration);
  return { ...matches[0], recordCount };
}

function parseProbeJson(buffer) {
  try { return JSON.parse(decodeUtf8(buffer, "FFPROBE_FAILED")); }
  catch (error) { if (error instanceof CutCandidateError) throw error; fail("FFPROBE_FAILED"); }
}

async function processSource({
  root, plan, sourceIndex, sourceOrder, occurrences, ffmpeg, ffprobe, policy,
  detectorTemplateHash, deadlineAt, recordBudget, silenceBudget,
}) {
  checkBudget(deadlineAt);
  const declaration = plan.sources[sourceIndex];
  const sourceFile = await resolveProjectFile(root, declaration.path);
  const resourceGuard = () => checkBudget(deadlineAt);
  const sourceSnapshot = await snapshotFile(
    sourceFile, MAX_INPUT.source, false, "INPUT_HASH_DRIFT", resourceGuard, root,
  );
  const probeRun = await runChild(ffprobe.absolute, probeArgv(sourceFile.absolute), {
    kind: "probe", timeoutMs: 60_000, stdoutLimit: 1024 * 1024, stderrLimit: 65_536, deadlineAt,
  });
  await verifySnapshot(sourceSnapshot, undefined, resourceGuard);
  const probe = normalizeProbe(parseProbeJson(probeRun.stdout));
  const duration = probe.format_duration_seconds;
  const effectiveOccurrences = occurrences.map(({ occurrence, index }) => {
    const explicit = occurrence.range.mode === "explicit";
    const start = explicit ? occurrence.range.in : 0;
    const end = explicit ? occurrence.range.out : duration;
    if (!(start >= 0 && start < end && end <= duration)) fail("KEEP_PLAN_INVALID");
    return { index, start, end, origin: explicit ? "explicit_range" : "full_source" };
  });
  const analysis = await selectAnalysis(root, sourceFile, duration, resourceGuard);
  addAnalysisRecords(recordBudget, analysis.recordCount);
  checkBudget(deadlineAt);
  const missingWords = analysis.analysis.transcript.length === 0
    || analysis.analysis.transcript.some((segment) => !segment.words?.length);
  let silences = [];
  let detector;
  if (missingWords) {
    detector = {
      status: "NOT_RUN_WORD_TIMING_UNAVAILABLE",
      silence_pair_count: 0,
      stderr_bytes: 0,
      argv_template_sha256: detectorTemplateHash,
    };
  } else {
    const timeoutMs = Math.min(7_200_000, Math.max(60_000, Math.ceil(duration * 2 + 30) * 1000));
    const remainingSilencePairs = MAX_SILENCE_PAIRS - silenceBudget.count;
    const silenceParser = createSilenceOutputParser(duration, policy, Math.min(100_000, remainingSilencePairs));
    const detectorRun = await runChild(ffmpeg.absolute, detectorArgv(sourceFile.absolute, probe.selected_audio_stream_index, policy), {
      kind: "detector", timeoutMs, stdoutLimit: 65_536, stderrLimit: 8 * 1024 * 1024, deadlineAt,
      stderrConsumer: (chunk) => silenceParser.push(chunk),
    });
    silences = silenceParser.finish();
    silenceBudget.count += silences.length;
    detector = {
      status: "COMPLETED",
      silence_pair_count: silences.length,
      stderr_bytes: detectorRun.stderrBytes,
      argv_template_sha256: detectorTemplateHash,
    };
  }
  await verifySnapshot(sourceSnapshot, undefined, resourceGuard);
  return {
    src: declaration.id,
    sourceIndex,
    sourceOrder,
    sourceFile,
    sourceSnapshot,
    probe,
    detector,
    duration,
    occurrences: effectiveOccurrences,
    analysis: analysis.analysis,
    analysisDirectory: analysis.directory,
    analysisSnapshot: analysis.snapshot,
    silences,
  };
}

function srcCompare(left, right) {
  if (left === null) return right === null ? 0 : -1;
  if (right === null) return 1;
  return codePointCompare(left, right);
}

async function referencedKeyframes(root, sources, candidates, resourceGuard) {
  const bySource = new Map(sources.map((source) => [source.src === null ? "null" : `s:${source.src}`, source]));
  const records = [];
  const recordByKey = new Map();
  const originalToKey = new Map();
  for (const candidate of candidates) {
    resourceGuard();
    const sourceKey = candidate.src === null ? "null" : `s:${candidate.src}`;
    const source = bySource.get(sourceKey);
    for (const keyframe of candidate._keyframes) {
      const resolved = await resolveAnalysisRelativeFile(root, source.analysisDirectory, keyframe.path);
      const key = `${sourceKey}\0${keyframe.t}\0${resolved.relative}`;
      const originalKey = `${sourceKey}\0${keyframe.originalIndex}`;
      originalToKey.set(originalKey, key);
      const normalizedMetadata = canonicalJson({ note: keyframe.note, ...(keyframe.origin ? { origin: keyframe.origin } : {}) });
      const existing = recordByKey.get(key);
      if (existing) {
        if (existing.metadata !== normalizedMetadata) fail("KEYFRAME_METADATA_AMBIGUOUS");
        existing.originalIndex = Math.min(existing.originalIndex, keyframe.originalIndex);
      } else {
        const record = { key, sourceKey, src: source.src, keyframe, resolved, metadata: normalizedMetadata, originalIndex: keyframe.originalIndex };
        records.push(record);
        recordByKey.set(key, record);
      }
    }
  }
  records.sort((left, right) => srcCompare(left.src, right.src) || left.keyframe.t - right.keyframe.t
    || codePointCompare(left.resolved.relative, right.resolved.relative) || left.originalIndex - right.originalIndex);
  let totalBytes = 0;
  const keyToIndex = new Map();
  const receipts = [];
  const snapshots = [];
  for (const [inputIndex, record] of records.entries()) {
    resourceGuard();
    const snapshot = await snapshotFile(
      record.resolved, MAX_INPUT.keyframes - totalBytes, false, "INPUT_HASH_DRIFT", resourceGuard, root,
    );
    totalBytes += snapshot.bytes;
    if (totalBytes > MAX_INPUT.keyframes) fail("INPUT_BUDGET_EXCEEDED");
    snapshots.push(snapshot);
    keyToIndex.set(record.key, inputIndex);
    receipts.push({
      input_index: inputIndex,
      src: record.src,
      t: record.keyframe.t,
      path: record.resolved.relative,
      bytes: snapshot.bytes,
      sha256: snapshot.sha256,
      note: record.keyframe.note,
      ...(record.keyframe.origin ? { origin: record.keyframe.origin } : {}),
    });
  }
  const resolver = (src, keyframe) => {
    const sourceKey = src === null ? "null" : `s:${src}`;
    const key = originalToKey.get(`${sourceKey}\0${keyframe.originalIndex}`);
    const index = keyToIndex.get(key);
    if (index === undefined) fail("REPORT_INVALID");
    return index;
  };
  return { receipts, snapshots, resolver };
}

function sourceKey(src) {
  return src === null ? "null" : `string:${src}`;
}

export function summaryFor(sources, candidates, skipped) {
  const skippedByCode = {};
  const bySource = new Map(sources.map((source) => [sourceKey(source.src), {
    src: source.src, candidate_count: 0, skipped_count: 0,
  }]));
  let semanticCount = 0;
  let pauseCount = 0;
  for (const candidate of candidates) {
    if (candidate.family === "semantic_event_review") semanticCount += 1;
    else pauseCount += 1;
    const aggregate = bySource.get(sourceKey(candidate.src));
    if (!aggregate) fail("REPORT_INVALID");
    aggregate.candidate_count += 1;
  }
  for (const entry of skipped) {
    skippedByCode[entry.code] = (skippedByCode[entry.code] ?? 0) + 1;
    const aggregate = bySource.get(sourceKey(entry.src));
    if (!aggregate) fail("REPORT_INVALID");
    aggregate.skipped_count += 1;
  }
  return {
    candidate_count: candidates.length,
    semantic_event_review_count: semanticCount,
    pause_shortening_review_count: pauseCount,
    skipped_count: skipped.length,
    skipped_by_code: skippedByCode,
    by_source: [...bySource.values()],
  };
}

async function buildReport(args) {
  const startedAt = Date.now();
  const deadlineAt = startedAt + HELPER_TIMEOUT_MS;
  const resourceGuard = () => checkBudget(deadlineAt);
  assertErrorDefinitions();
  if (!APPROVAL_PATTERN.test(args.approvalRef)) fail("APPROVAL_REF_INVALID");
  const root = await resolveProject(args.project);
  const keepFile = await resolveProjectFile(root, normalizeProjectRelative(args.keepPlan));
  const logFile = await resolveProjectFile(root, normalizeProjectRelative(args.decisionLog));
  const keepSnapshot = await snapshotFile(
    keepFile, MAX_INPUT.keepPlan, true, "INPUT_HASH_DRIFT", resourceGuard, root,
  );
  const logSnapshot = await snapshotFile(
    logFile, MAX_INPUT.decisionLog, true, "INPUT_HASH_DRIFT", resourceGuard, root,
  );
  if (decodeUtf8(logSnapshot.data, "DECISION_LOG_INVALID").length === 0) fail("DECISION_LOG_INVALID");
  const plan = parseJsonSnapshot(keepSnapshot, "KEEP_PLAN_INVALID");
  if (!validators.validateSemanticKeepPlan(plan)) fail("KEEP_PLAN_INVALID");
  validateSemanticKeepPlanSemantics(plan);
  if (plan.occurrences.length > 100_000) fail("INPUT_BUDGET_EXCEEDED");

  const policyFile = { absolute: path.join(skillRoot, POLICY_RELATIVE), relative: POLICY_RELATIVE };
  if (await realpath(policyFile.absolute).catch(() => fail("TOOL_BINARY_INVALID")) !== policyFile.absolute) fail("TOOL_BINARY_INVALID");
  const policySnapshot = await snapshotFile(
    policyFile, 1024 * 1024, true, "TOOL_BINARY_INVALID", resourceGuard, skillRoot,
  );
  const policy = parseJsonSnapshot(policySnapshot, "REPORT_INVALID");
  const values = policyValues(policy);
  resourceGuard();
  const modules = await moduleReceipts(resourceGuard);
  resourceGuard();
  const ffmpeg = await resolveTool("ffmpeg", process.env.AKARI_FFMPEG_BIN || process.env.FFMPEG_PATH, { deadlineAt, resourceGuard });
  const ffprobe = await resolveTool("ffprobe", process.env.AKARI_FFPROBE_BIN || process.env.FFPROBE_PATH, { deadlineAt, resourceGuard });
  const node = await nodeReceipt({ resourceGuard });
  const detectorTemplateHash = sha256(Buffer.from(canonicalJson(detectorArgvTemplate(values)), "utf8"));

  const occurrenceGroups = new Map();
  for (const [index, occurrence] of plan.occurrences.entries()) {
    const group = occurrenceGroups.get(occurrence.source_index) ?? [];
    group.push({ occurrence, index });
    occurrenceGroups.set(occurrence.source_index, group);
  }
  const activeIndexes = [...occurrenceGroups.keys()].sort((a, b) => a - b);
  if (activeIndexes.length > 256) fail("INPUT_BUDGET_EXCEEDED");
  const sources = [];
  const recordBudget = { count: 0 };
  const silenceBudget = { count: 0 };
  for (const [sourceOrder, sourceIndex] of activeIndexes.entries()) {
    const source = await processSource({
      root, plan, sourceIndex, sourceOrder, occurrences: occurrenceGroups.get(sourceIndex), ffmpeg, ffprobe,
      policy: values, detectorTemplateHash, deadlineAt, recordBudget, silenceBudget,
    });
    sources.push(source);
    resourceGuard();
  }

  const built = buildCandidates(sources, values, { resourceGuard });
  const keyframes = await referencedKeyframes(root, sources, built.candidates, resourceGuard);
  finalizeCandidateKeyframes(built.candidates, keyframes.resolver);
  finalizeSkipped(built.skipped);
  resourceGuard();
  const expectedRowsSha256 = generatedRowsSha256(built.candidates, built.skipped);
  resourceGuard();
  const report = {
    version: 1,
    kind: "akari-cut-candidates-v1",
    policy: {
      id: "a4-conversation-v1",
      origin: "EDIT_PLAN_SKILL",
      skill_relative_path: POLICY_RELATIVE,
      bytes: policySnapshot.bytes,
      sha256: policySnapshot.sha256,
      values,
    },
    inputs: {
      semantic_keep_plan: {
        path: keepFile.relative, bytes: keepSnapshot.bytes, sha256: keepSnapshot.sha256,
        claim: "CALLER_SUPPLIED_SEMANTIC_KEEP_DRAFT",
      },
      decision_log: {
        path: logFile.relative, bytes: logSnapshot.bytes, sha256: logSnapshot.sha256,
        approval_ref: args.approvalRef, verification: "CALLER_ASSERTED_NOT_MACHINE_VERIFIED",
      },
      processed_sources: sources.map((source) => ({
        id: source.src,
        path: source.sourceFile.relative,
        bytes: source.sourceSnapshot.bytes,
        sha256: source.sourceSnapshot.sha256,
        source_order: source.sourceOrder,
        probe: source.probe,
        detector: source.detector,
      })),
      analyses: sources.map((source) => ({
        src: source.src,
        path: source.analysisSnapshot.relative,
        bytes: source.analysisSnapshot.bytes,
        sha256: source.analysisSnapshot.sha256,
        analysis_freshness: "UNVERIFIED_CONTRACT_LIMIT",
      })),
      keyframes: keyframes.receipts,
    },
    tool: {
      module_source_set: modules.receipts,
      module_source_set_sha256: modules.aggregateSha256,
      contract_schemas: validators.contractSchemas,
      ffmpeg: ffmpeg.receipt,
      ffprobe: ffprobe.receipt,
      node: node.receipt,
      detector_argv_template_sha256: detectorTemplateHash,
    },
    candidates: built.candidates,
    skipped: built.skipped,
    summary: summaryFor(sources, built.candidates, built.skipped),
    residual_risks: RESIDUAL_RISK_ORDER,
    approved_to_apply: false,
    edit_json_modified: false,
  };

  if (!validators.validateCutCandidates(report)) fail("REPORT_INVALID");
  validateCutCandidatesSemantics(report, values, {
    plan,
    sources,
    expectedRowsSha256,
    expectedContractSchemas: validators.contractSchemas,
    root,
    resourceGuard,
  });
  const allInputSnapshots = [keepSnapshot, logSnapshot, ...sources.flatMap((source) => [source.sourceSnapshot, source.analysisSnapshot]), ...keyframes.snapshots];
  for (const snapshot of allInputSnapshots) await verifySnapshot(snapshot, undefined, resourceGuard);
  for (const snapshot of [...modules.snapshots, policySnapshot, ffmpeg.snapshot, ffprobe.snapshot, node.snapshot]) {
    await verifySnapshot(snapshot, "TOOL_IDENTITY_DRIFT", resourceGuard);
  }
  resourceGuard();
  const bytes = reportBytes(report);
  resourceGuard();
  if (args.write) await writeContentAddressed(root, bytes, { resourceGuard });
  return bytes;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  return buildReport(args);
}

const invokedEntrypoint = process.argv[1]
  ? await realpath(path.resolve(process.argv[1])).catch(() => path.resolve(process.argv[1]))
  : null;
const currentEntrypoint = await realpath(fileURLToPath(import.meta.url)).catch(() => fileURLToPath(import.meta.url));
if (invokedEntrypoint === currentEntrypoint) {
  try {
    const bytes = await main();
    process.stdout.write(bytes);
  } catch (error) {
    const failure = failureBytes(error);
    process.stderr.write(failure.bytes);
    process.exitCode = failure.exitCode;
  }
}
