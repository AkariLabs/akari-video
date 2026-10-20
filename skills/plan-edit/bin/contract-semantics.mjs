import path from "node:path";

import { canonicalBytesBounded, canonicalJson, codePointCompare, round6, sha256 } from "./canonical-json.mjs";
import { CutCandidateError } from "./errors.mjs";

const RISK_ORDER = Object.freeze([
  "UI_WAIT_UNRESOLVED",
  "SCREEN_CONTEXT_MISSING",
  "INFORMATION_RETENTION_REVIEW",
  "PARTIAL_EVENT_OCCURRENCE",
]);
const RESIDUAL_RISK_ORDER = Object.freeze([
  "ANALYSIS_FRESHNESS_UNVERIFIED",
  "CONCURRENT_RETARGET_NOT_PROVEN",
  "DYNAMIC_LIBRARY_CLOSURE_UNVERIFIED",
]);
const CONTRACT_SCHEMA_SOURCES = Object.freeze([
  Object.freeze({ id: "analysis-v0", canonical_source_path: "packages/schemas/analysis.schema.json" }),
  Object.freeze({ id: "semantic-keep-plan-v1", canonical_source_path: "packages/schemas/semantic-keep-plan.schema.json" }),
  Object.freeze({ id: "cut-candidates-v1", canonical_source_path: "packages/schemas/cut-candidates.schema.json" }),
]);

function fail(code) {
  throw new CutCandidateError(code);
}

function intervalValid(value, duration = Infinity) {
  return Number.isFinite(value?.start) && Number.isFinite(value?.end)
    && value.start >= 0 && value.start < value.end && value.end <= duration;
}

function equalJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function validateSemanticKeepPlanSemantics(plan) {
  for (const source of plan.sources) {
    if (source.path.startsWith("/") || source.path.includes("\\")
      || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(source.path)
      || source.path.split("/").includes("..")) fail("KEEP_PLAN_INVALID");
  }
  if (plan.intended_edit_version === 0) {
    if (plan.sources.length !== 1 || plan.sources[0].id !== null) fail("KEEP_PLAN_INVALID");
  } else {
    const ids = plan.sources.map((source) => source.id);
    if (ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) fail("KEEP_PLAN_INVALID");
  }
  for (const occurrence of plan.occurrences) {
    if (occurrence.source_index >= plan.sources.length) fail("KEEP_PLAN_INVALID");
    if (occurrence.range.mode === "explicit"
      && !(Number.isFinite(occurrence.range.in) && Number.isFinite(occurrence.range.out)
        && occurrence.range.in >= 0 && occurrence.range.in < occurrence.range.out)) {
      fail("KEEP_PLAN_INVALID");
    }
  }
  return true;
}

export function validateAnalysisSemantics(analysis, sourceDuration) {
  let recordCount = analysis.events.length + analysis.keyframes.length;
  for (const [segmentIndex, segment] of analysis.transcript.entries()) {
    if (!intervalValid(segment, sourceDuration)) fail("ANALYSIS_SEMANTIC_INVALID");
    if (segment.words) {
      recordCount += segment.words.length;
      for (const word of segment.words) {
        if (!intervalValid(word, sourceDuration)
          || word.start < segment.start || word.end > segment.end) fail("ANALYSIS_SEMANTIC_INVALID");
      }
    }
    if (!Number.isSafeInteger(segmentIndex)) fail("ANALYSIS_SEMANTIC_INVALID");
  }
  for (const event of analysis.events) {
    if (event.type === "chapter") {
      if (!Number.isFinite(event.t) || event.t < 0 || event.t > sourceDuration) fail("ANALYSIS_SEMANTIC_INVALID");
    } else if (Object.hasOwn(event, "start") && !intervalValid(event, sourceDuration)) {
      fail("ANALYSIS_SEMANTIC_INVALID");
    }
  }
  for (const keyframe of analysis.keyframes) {
    if (!Number.isFinite(keyframe.t) || keyframe.t < 0 || keyframe.t > sourceDuration) fail("ANALYSIS_SEMANTIC_INVALID");
  }
  if (recordCount > 1_000_000) fail("INPUT_BUDGET_EXCEEDED");
  return { recordCount };
}

function compareModule(left, right) {
  return codePointCompare(left.skill_relative_path, right.skill_relative_path);
}

function validateContext(context, occurrence) {
  if (!intervalValid(context) || context.start < occurrence.start || context.end > occurrence.end) fail("REPORT_INVALID");
  for (const word of [context.previous_word, context.next_word]) {
    if (word !== null && !intervalValid(word)) fail("REPORT_INVALID");
  }
  if (new Set(context.chapter_event_indexes).size !== context.chapter_event_indexes.length) fail("REPORT_INVALID");
  if ([...context.keyframe_input_indexes].sort((a, b) => a - b)
    .some((value, index) => value !== context.keyframe_input_indexes[index])) fail("REPORT_INVALID");
}

export function validateContractSchemaReceipts(receipts) {
  if (!Array.isArray(receipts) || receipts.length !== CONTRACT_SCHEMA_SOURCES.length
    || receipts.some((entry) => entry === null || typeof entry !== "object")
    || new Set(receipts.map((entry) => entry.id)).size !== receipts.length
    || new Set(receipts.map((entry) => entry.canonical_source_path)).size !== receipts.length) fail("REPORT_INVALID");
  for (let index = 0; index < CONTRACT_SCHEMA_SOURCES.length; index += 1) {
    if (receipts[index].id !== CONTRACT_SCHEMA_SOURCES[index].id
      || receipts[index].canonical_source_path !== CONTRACT_SCHEMA_SOURCES[index].canonical_source_path) {
      fail("REPORT_INVALID");
    }
  }
  return true;
}

export function validateCutCandidatesSemantics(report, policyValues, inputContext = null) {
  if (report.approved_to_apply !== false || report.edit_json_modified !== false) fail("REPORT_INVALID");
  if (!equalJson(report.policy.values, policyValues)) fail("REPORT_INVALID");
  if (!equalJson(report.residual_risks, RESIDUAL_RISK_ORDER)) fail("REPORT_INVALID");

  const modules = [...report.tool.module_source_set].sort(compareModule);
  if (!equalJson(modules, report.tool.module_source_set)
    || new Set(modules.map((entry) => entry.skill_relative_path)).size !== modules.length) fail("REPORT_INVALID");
  const moduleBytes = Buffer.from(modules.map((entry) => canonicalJson(entry)).join("\n") + "\n", "utf8");
  if (sha256(moduleBytes) !== report.tool.module_source_set_sha256) fail("REPORT_INVALID");
  validateContractSchemaReceipts(report.tool.contract_schemas);

  const sourceById = new Map();
  const aggregateBySource = new Map();
  for (const [sourceIndex, source] of report.inputs.processed_sources.entries()) {
    const key = source.id === null ? "null" : `string:${source.id}`;
    if (sourceById.has(key)) fail("REPORT_INVALID");
    sourceById.set(key, source);
    aggregateBySource.set(key, { candidate_count: 0, skipped_count: 0 });
    if (source.source_order !== sourceIndex
      || source.detector.argv_template_sha256 !== report.tool.detector_argv_template_sha256) fail("REPORT_INVALID");
    const probe = source.probe;
    if (probe.stream_count !== probe.streams.length || probe.audio_stream_count !== 1) fail("REPORT_INVALID");
    const audio = probe.streams.filter((stream) => stream.codec_type === "audio");
    if (audio.length !== 1 || audio[0].index !== probe.selected_audio_stream_index) fail("REPORT_INVALID");
    const normalized = { ...probe };
    delete normalized.normalized_sha256;
    if (sha256(Buffer.from(canonicalJson(normalized), "utf8")) !== probe.normalized_sha256) fail("REPORT_INVALID");
    if (source.detector.status === "NOT_RUN_WORD_TIMING_UNAVAILABLE"
      && (source.detector.silence_pair_count !== 0 || source.detector.stderr_bytes !== 0)) fail("REPORT_INVALID");
  }

  const keyframeIndexes = new Set(report.inputs.keyframes.map((entry) => entry.input_index));
  if (keyframeIndexes.size !== report.inputs.keyframes.length
    || report.inputs.keyframes.some((entry, index) => entry.input_index !== index)) fail("REPORT_INVALID");
  const keyframeKeys = new Set();
  for (let index = 0; index < report.inputs.keyframes.length; index += 1) {
    const entry = report.inputs.keyframes[index];
    const sourceKey = entry.src === null ? "null" : `string:${entry.src}`;
    if (!sourceById.has(sourceKey)) fail("REPORT_INVALID");
    const key = `${sourceKey}\0${entry.t}\0${entry.path}`;
    if (keyframeKeys.has(key)) fail("REPORT_INVALID");
    keyframeKeys.add(key);
    if (index > 0) {
      const previous = report.inputs.keyframes[index - 1];
      const previousSource = previous.src === null ? "" : previous.src;
      const source = entry.src === null ? "" : entry.src;
      if (codePointCompare(previousSource, source) > 0 || (previousSource === source
        && (previous.t > entry.t || (previous.t === entry.t
          && codePointCompare(previous.path, entry.path) > 0)))) fail("REPORT_INVALID");
    }
  }
  if (report.inputs.analyses.length !== report.inputs.processed_sources.length
    || report.inputs.analyses.some((entry, index) => !equalJson(entry.src, report.inputs.processed_sources[index].id))) fail("REPORT_INVALID");

  const sourceOrder = (src) => sourceById.get(src === null ? "null" : `string:${src}`)?.source_order ?? Infinity;
  const candidateOrder = (left, right) => {
    const leftInterval = left.family === "semantic_event_review" ? left.event.projected_interval : left.source_interval;
    const rightInterval = right.family === "semantic_event_review" ? right.event.projected_interval : right.source_interval;
    return sourceOrder(left.src) - sourceOrder(right.src)
      || left.occurrence_index - right.occurrence_index
      || (left.family === right.family ? 0 : left.family === "semantic_event_review" ? -1 : 1)
      || leftInterval.start - rightInterval.start || leftInterval.end - rightInterval.end
      || (left.event?.index ?? 0) - (right.event?.index ?? 0);
  };
  let semanticCount = 0;
  let pauseCount = 0;
  for (const candidate of report.candidates) {
    if (candidate.family === "semantic_event_review") semanticCount += 1;
    else pauseCount += 1;
  }
  const semanticWidth = Math.max(4, String(semanticCount).length);
  const pauseWidth = Math.max(4, String(pauseCount).length);
  let semanticIndex = 0;
  let pauseIndex = 0;
  let previousCandidate = null;
  for (const candidate of report.candidates) {
    if (previousCandidate && candidateOrder(previousCandidate, candidate) > 0) fail("REPORT_INVALID");
    previousCandidate = candidate;
    const sourceKey = candidate.src === null ? "null" : `string:${candidate.src}`;
    if (!sourceById.has(sourceKey)) fail("REPORT_INVALID");
    aggregateBySource.get(sourceKey).candidate_count += 1;
    if (candidate.family === "semantic_event_review") {
      semanticIndex += 1;
      if (candidate.id !== `semantic-${String(semanticIndex).padStart(semanticWidth, "0")}`) fail("REPORT_INVALID");
    } else {
      pauseIndex += 1;
      if (candidate.id !== `pause-${String(pauseIndex).padStart(pauseWidth, "0")}`) fail("REPORT_INVALID");
    }
    if (!intervalValid(candidate.occurrence_interval)) fail("REPORT_INVALID");
    validateContext(candidate.context, candidate.occurrence_interval);
    if (candidate.context.keyframe_input_indexes.some((index) => !keyframeIndexes.has(index))) fail("REPORT_INVALID");
    const sortedRisks = RISK_ORDER.filter((risk) => candidate.risk_flags.includes(risk));
    if (!equalJson(sortedRisks, candidate.risk_flags) || !candidate.risk_flags.includes("UI_WAIT_UNRESOLVED")) fail("REPORT_INVALID");
    if (candidate.context.keyframe_input_indexes.length === 0
      !== candidate.risk_flags.includes("SCREEN_CONTEXT_MISSING")) fail("REPORT_INVALID");
    if (candidate.family === "semantic_event_review") {
      if (!intervalValid(candidate.event.event_original_interval)
        || !intervalValid(candidate.event.projected_interval)
        || candidate.event.projected_interval.start < candidate.occurrence_interval.start
        || candidate.event.projected_interval.end > candidate.occurrence_interval.end
        || candidate.event.projected_interval.start < candidate.event.event_original_interval.start
        || candidate.event.projected_interval.end > candidate.event.event_original_interval.end) fail("REPORT_INVALID");
      const partialRisk = candidate.risk_flags.includes("PARTIAL_EVENT_OCCURRENCE");
      if (candidate.event.partial_event_occurrence !== partialRisk
        || !candidate.risk_flags.includes("INFORMATION_RETENTION_REVIEW")) fail("REPORT_INVALID");
    } else {
      if (!intervalValid(candidate.source_interval)
        || candidate.source_interval.start < candidate.occurrence_interval.start
        || candidate.source_interval.end > candidate.occurrence_interval.end
        || candidate.proposal.remove_start_frame >= candidate.proposal.remove_end_frame
        || candidate.proposal.remove_start !== Math.round(candidate.proposal.remove_start_frame / 30 * 1e6) / 1e6
        || candidate.proposal.remove_end !== Math.round(candidate.proposal.remove_end_frame / 30 * 1e6) / 1e6) fail("REPORT_INVALID");
      const targetByClass = { within_sentence: 0.1, sentence_end: 0.166667, topic_transition: 0.3 };
      const target = targetByClass[candidate.classification];
      const proposal = candidate.proposal;
      const rawStart = candidate.source_interval.start + target / 2;
      const rawEnd = candidate.source_interval.end - target / 2;
      const startFrame = Math.ceil((rawStart - 1e-9) * 30);
      const endFrame = Math.floor((rawEnd + 1e-9) * 30);
      const retained = Math.round(((proposal.remove_start - candidate.source_interval.start)
        + (candidate.source_interval.end - proposal.remove_end)) * 1e6) / 1e6;
      if (proposal.target_retained_seconds !== target
        || proposal.raw_remove_start !== Math.round(rawStart * 1e6) / 1e6
        || proposal.raw_remove_end !== Math.round(rawEnd * 1e6) / 1e6
        || proposal.remove_start_frame !== startFrame || proposal.remove_end_frame !== endFrame
        || proposal.actual_retained_seconds !== retained
        || (candidate.classification === "topic_transition") !== (candidate.classification_basis.kind === "chapter_event")
        || (candidate.classification === "sentence_end") !== (candidate.classification_basis.kind === "sentence_terminal")) {
        fail("REPORT_INVALID");
      }
    }
  }

  const detailKeysByCode = {
    WORD_TIMING_UNAVAILABLE: ["missing_segment_indexes"],
    MISSING_SPEECH_CONTEXT: ["next_word_available", "previous_word_available"],
    PROTECTED_WORD_OVERLAP: ["protected_words"],
    OUTSIDE_KEEP_OCCURRENCE: ["detector_pair_index"],
    CROSSES_OCCURRENCE_BOUNDARY: ["detector_pair_index", "occurrence_interval"],
    NO_FRAME_CELL: ["raw_remove_end", "raw_remove_start", "remove_end_frame", "remove_start_frame"],
    NO_EFFECTIVE_CHANGE: ["retained_after_seconds", "retained_before_seconds", "target_retained_seconds"],
    TARGET_NOT_REACHED: ["retained_after_seconds", "retained_before_seconds", "target_retained_seconds"],
  };
  const skippedOrder = (left, right) => sourceOrder(left.src) - sourceOrder(right.src)
    || (left.occurrence_index ?? -1) - (right.occurrence_index ?? -1)
    || left.source_interval.start - right.source_interval.start
    || left.source_interval.end - right.source_interval.end
    || codePointCompare(left.code, right.code);
  const skipWidth = Math.max(4, String(report.skipped.length).length);
  let previousSkipped = null;
  const skippedByCode = {};
  for (const [skipIndex, skipped] of report.skipped.entries()) {
    if (previousSkipped && skippedOrder(previousSkipped, skipped) > 0) fail("REPORT_INVALID");
    previousSkipped = skipped;
    if (skipped.id !== `skip-${String(skipIndex + 1).padStart(skipWidth, "0")}`) fail("REPORT_INVALID");
    if (!intervalValid(skipped.source_interval)) fail("REPORT_INVALID");
    if (skipped.occurrence_index === null
      ? skipped.code !== "OUTSIDE_KEEP_OCCURRENCE" || skipped.occurrence_origin !== null
      : skipped.occurrence_origin === null) fail("REPORT_INVALID");
    const sourceKey = skipped.src === null ? "null" : `string:${skipped.src}`;
    if (!sourceById.has(sourceKey)
      || !equalJson(Object.keys(skipped.detail).sort(codePointCompare), detailKeysByCode[skipped.code])) fail("REPORT_INVALID");
    aggregateBySource.get(sourceKey).skipped_count += 1;
    skippedByCode[skipped.code] = (skippedByCode[skipped.code] ?? 0) + 1;
  }

  const summary = report.summary;
  if (summary.candidate_count !== report.candidates.length
    || summary.semantic_event_review_count !== semanticCount
    || summary.pause_shortening_review_count !== pauseCount
    || summary.skipped_count !== report.skipped.length
    || !equalJson(summary.skipped_by_code, skippedByCode)) fail("REPORT_INVALID");
  const expectedBySource = report.inputs.processed_sources.map((source) => ({
    src: source.id,
    ...aggregateBySource.get(source.id === null ? "null" : `string:${source.id}`),
  }));
  if (!equalJson(summary.by_source, expectedBySource)) fail("REPORT_INVALID");
  if (inputContext) validateReportAgainstInputs(report, inputContext);
  return true;
}

function sourceKey(src) {
  return src === null ? "null" : `string:${src}`;
}

function roundedInterval(value) {
  return { start: round6(value.start), end: round6(value.end) };
}

function lowerBoundBy(items, value, field) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle][field] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBoundBy(items, value, field) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle][field] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function wordReference(word) {
  return word ? {
    segment_index: word.segmentIndex,
    word_index: word.wordIndex,
    start: word.start,
    end: word.end,
    text: word.text,
  } : null;
}

function keyframeIdentityKey(src, t, relativePath) {
  return canonicalJson([src, t, relativePath]);
}

function keyframeReceiptKey(src, t, relativePath, note, origin) {
  return canonicalJson([src, t, relativePath, note ?? null, origin ?? null]);
}

function resolvedKeyframe(source, keyframe, originalIndex, root) {
  if (typeof root !== "string" || typeof source.analysisDirectory !== "string") fail("REPORT_INVALID");
  const relativePath = path.relative(root, path.resolve(source.analysisDirectory, keyframe.path))
    .split(path.sep).join("/");
  return {
    ...keyframe,
    originalIndex,
    receiptKey: keyframeReceiptKey(source.src, keyframe.t, relativePath, keyframe.note, keyframe.origin),
    identityKey: keyframeIdentityKey(source.src, keyframe.t, relativePath),
  };
}

function buildReportKeyframeIndex(receipts, resourceGuard) {
  const inputIndexByReceiptKey = new Map();
  const identities = new Set();
  const indexedReceipts = [];
  for (const [position, receipt] of receipts.entries()) {
    resourceGuard();
    const identityKey = keyframeIdentityKey(receipt.src, receipt.t, receipt.path);
    const receiptKey = keyframeReceiptKey(receipt.src, receipt.t, receipt.path, receipt.note, receipt.origin);
    if (receipt.input_index !== position || identities.has(identityKey)
      || inputIndexByReceiptKey.has(receiptKey)) fail("REPORT_INVALID");
    identities.add(identityKey);
    inputIndexByReceiptKey.set(receiptKey, receipt.input_index);
    indexedReceipts.push({ receipt, receiptKey });
  }
  return { inputIndexByReceiptKey, indexedReceipts };
}

function buildContextIndex(source, resourceGuard, root) {
  const words = [];
  for (const [segmentIndex, segment] of source.analysis.transcript.entries()) {
    resourceGuard();
    for (const [wordIndex, word] of (segment.words ?? []).entries()) {
      words.push({ ...word, segmentIndex, wordIndex, owner: segment });
    }
  }
  words.sort((left, right) => left.start - right.start || left.end - right.end
    || left.segmentIndex - right.segmentIndex || left.wordIndex - right.wordIndex);
  const terminalWordBySegment = new Map();
  for (const word of words) terminalWordBySegment.set(word.segmentIndex, word);
  for (const word of words) word.isOwnerTerminalWord = terminalWordBySegment.get(word.segmentIndex) === word;
  const wordsByEnd = [...words].sort((left, right) => left.end - right.end || left.start - right.start
    || left.segmentIndex - right.segmentIndex || left.wordIndex - right.wordIndex);
  const chapters = source.analysis.events.map((event, eventIndex) => ({ ...event, eventIndex }))
    .filter((event) => event.type === "chapter")
    .sort((left, right) => left.t - right.t || left.eventIndex - right.eventIndex);
  const keyframeMetadataByIdentity = new Map();
  const keyframeReceiptKeys = new Set();
  const keyframes = source.analysis.keyframes.map((keyframe, originalIndex) => {
    resourceGuard();
    const indexed = resolvedKeyframe(source, keyframe, originalIndex, root);
    const existing = keyframeMetadataByIdentity.get(indexed.identityKey);
    if (existing !== undefined && existing !== indexed.receiptKey) fail("REPORT_INVALID");
    keyframeMetadataByIdentity.set(indexed.identityKey, indexed.receiptKey);
    keyframeReceiptKeys.add(indexed.receiptKey);
    return indexed;
  })
    .sort((left, right) => left.t - right.t || codePointCompare(left.path, right.path)
      || left.originalIndex - right.originalIndex);
  const occurrenceByIndex = new Map();
  for (const occurrence of source.occurrences) {
    resourceGuard();
    if (occurrenceByIndex.has(occurrence.index)) fail("REPORT_INVALID");
    occurrenceByIndex.set(occurrence.index, occurrence);
  }
  const silenceByRoundedInterval = new Map();
  for (const silence of source.silences) {
    resourceGuard();
    const key = canonicalJson(roundedInterval(silence));
    const existing = silenceByRoundedInterval.get(key);
    if (existing) existing.count += 1;
    else silenceByRoundedInterval.set(key, { count: 1, value: silence });
  }
  return {
    words,
    wordsByEnd,
    chapters,
    keyframes,
    keyframeReceiptKeys,
    occurrenceByIndex,
    silenceByRoundedInterval,
  };
}

function boundContext(index, occurrence, rawInterval) {
  const rawContext = {
    start: Math.max(occurrence.start, rawInterval.start - 1),
    end: Math.min(occurrence.end, rawInterval.end + 1),
  };
  let previous = null;
  let previousIndex = upperBoundBy(index.wordsByEnd, rawInterval.start, "end") - 1;
  while (previousIndex >= 0 && previous === null) {
    const targetEnd = index.wordsByEnd[previousIndex].end;
    const tied = [];
    while (previousIndex >= 0 && index.wordsByEnd[previousIndex].end === targetEnd) {
      const word = index.wordsByEnd[previousIndex--];
      if (word.start >= occurrence.start && word.end <= occurrence.end && word.end >= rawContext.start) tied.push(word);
    }
    previous = tied.sort((left, right) => left.segmentIndex - right.segmentIndex
      || left.wordIndex - right.wordIndex)[0] ?? null;
  }
  let next = null;
  let nextIndex = lowerBoundBy(index.words, rawInterval.end, "start");
  while (nextIndex < index.words.length && next === null) {
    const targetStart = index.words[nextIndex].start;
    if (targetStart >= occurrence.end || targetStart > rawContext.end) break;
    const tied = [];
    while (nextIndex < index.words.length && index.words[nextIndex].start === targetStart) {
      const word = index.words[nextIndex++];
      if (word.start >= occurrence.start && word.end <= occurrence.end) tied.push(word);
    }
    next = tied.sort((left, right) => left.segmentIndex - right.segmentIndex
      || left.wordIndex - right.wordIndex)[0] ?? null;
  }
  const chapters = index.chapters.slice(
    lowerBoundBy(index.chapters, rawContext.start, "t"),
    lowerBoundBy(index.chapters, rawContext.end, "t"),
  );
  const keyframes = index.keyframes.slice(
    lowerBoundBy(index.keyframes, rawContext.start, "t"),
    lowerBoundBy(index.keyframes, rawContext.end, "t"),
  );
  return { rawContext, previous, next, chapters, keyframes };
}

function expectedKeyframeIndexes(inputIndexByReceiptKey, context) {
  const indexes = new Set();
  for (const keyframe of context.keyframes) {
    const inputIndex = inputIndexByReceiptKey.get(keyframe.receiptKey);
    if (inputIndex === undefined) fail("REPORT_INVALID");
    indexes.add(inputIndex);
  }
  return [...indexes].sort((left, right) => left - right);
}

function validateCandidateContextBinding(candidate, occurrence, rawInterval, index, inputIndexByReceiptKey) {
  const context = boundContext(index, occurrence, rawInterval);
  const expected = {
    start: round6(context.rawContext.start),
    end: round6(context.rawContext.end),
    previous_word: wordReference(context.previous),
    next_word: wordReference(context.next),
    chapter_event_indexes: context.chapters.map((event) => event.eventIndex),
    keyframe_input_indexes: expectedKeyframeIndexes(inputIndexByReceiptKey, context),
  };
  if (!equalJson(candidate.context, expected)) fail("REPORT_INVALID");
  if (candidate.family !== "pause_shortening_review") return;
  let classification = "within_sentence";
  let basis = { kind: "default_within_sentence" };
  if (context.chapters.length > 0) {
    classification = "topic_transition";
    basis = { kind: "chapter_event", event_index: context.chapters[0].eventIndex };
  } else if (context.previous && context.next
    && context.previous.segmentIndex !== context.next.segmentIndex
    && context.previous.isOwnerTerminalWord) {
    const terminal = context.previous.owner.text.trim().match(/[。！？!?]$/u)?.[0];
    if (terminal) {
      classification = "sentence_end";
      basis = { kind: "sentence_terminal", segment_index: context.previous.segmentIndex, terminal };
    }
  }
  if (candidate.classification !== classification || !equalJson(candidate.classification_basis, basis)) {
    fail("REPORT_INVALID");
  }
}

/**
 * Generation-time binding check. This deliberately receives the held, parsed inputs
 * instead of copying their complete semantic payload into the public report.
 */
export function validateReportAgainstInputs(report, {
  plan,
  sources,
  expectedRowsSha256,
  expectedContractSchemas,
  root,
  resourceGuard = () => {},
}) {
  validateGeneratedRows(report, expectedRowsSha256);
  if (!equalJson(report.tool.contract_schemas, expectedContractSchemas)) fail("REPORT_INVALID");
  const keyframeIndex = buildReportKeyframeIndex(report.inputs.keyframes, resourceGuard);
  const bySource = new Map();
  const contextIndexes = new Map();
  if (sources.length !== report.inputs.processed_sources.length) fail("REPORT_INVALID");
  for (const [order, source] of sources.entries()) {
    const declaration = plan.sources[source.sourceIndex];
    const processed = report.inputs.processed_sources[order];
    const analysisReceipt = report.inputs.analyses[order];
    if (!declaration || source.sourceOrder !== order
      || !equalJson(declaration.id, source.src)
      || !equalJson(processed.id, declaration.id)
      || processed.path !== source.sourceFile.relative
      || analysisReceipt.path !== source.analysisSnapshot.relative) fail("REPORT_INVALID");
    const key = sourceKey(source.src);
    if (bySource.has(key)) fail("REPORT_INVALID");
    bySource.set(key, source);
    const contextIndex = buildContextIndex(source, resourceGuard, root);
    contextIndexes.set(key, contextIndex);
    for (const occurrence of source.occurrences) {
      const declaredOccurrence = plan.occurrences[occurrence.index];
      if (!declaredOccurrence || declaredOccurrence.source_index !== source.sourceIndex) fail("REPORT_INVALID");
    }
  }

  for (const { receipt, receiptKey } of keyframeIndex.indexedReceipts) {
    const contextIndex = contextIndexes.get(sourceKey(receipt.src));
    if (!contextIndex?.keyframeReceiptKeys.has(receiptKey)) fail("REPORT_INVALID");
  }

  const validateOccurrence = (entry, contextIndex) => {
    const occurrence = contextIndex.occurrenceByIndex.get(entry.occurrence_index);
    if (!occurrence || entry.occurrence_origin !== occurrence.origin
      || !equalJson(entry.occurrence_interval ?? entry.source_interval, roundedInterval(occurrence))) fail("REPORT_INVALID");
    return occurrence;
  };
  for (const candidate of report.candidates) {
    resourceGuard();
    const source = bySource.get(sourceKey(candidate.src));
    if (!source) fail("REPORT_INVALID");
    const contextIndex = contextIndexes.get(sourceKey(candidate.src));
    const occurrence = validateOccurrence(candidate, contextIndex);
    let rawInterval;
    if (candidate.family === "semantic_event_review") {
      const event = source.analysis.events[candidate.event.index];
      if (!event || event.type !== candidate.event.type
        || (event.type === "trouble" && event.note !== candidate.event.note)
        || !equalJson(candidate.event.event_original_interval, roundedInterval(event))) fail("REPORT_INVALID");
      const projected = { start: Math.max(event.start, occurrence.start), end: Math.min(event.end, occurrence.end) };
      rawInterval = projected;
      const partial = projected.start !== event.start || projected.end !== event.end;
      if (!equalJson(candidate.event.projected_interval, roundedInterval(projected))
        || candidate.event.partial_event_occurrence !== partial
        || partial !== candidate.risk_flags.includes("PARTIAL_EVENT_OCCURRENCE")) fail("REPORT_INVALID");
    } else {
      const matchingSilence = contextIndex.silenceByRoundedInterval.get(canonicalJson(candidate.source_interval));
      if (matchingSilence?.count !== 1) fail("REPORT_INVALID");
      rawInterval = matchingSilence.value;
    }
    validateCandidateContextBinding(
      candidate, occurrence, rawInterval, contextIndex, keyframeIndex.inputIndexByReceiptKey,
    );
  }

  for (const skipped of report.skipped) {
    const source = bySource.get(sourceKey(skipped.src));
    if (!source) fail("REPORT_INVALID");
    const contextIndex = contextIndexes.get(sourceKey(skipped.src));
    if (skipped.occurrence_index !== null) {
      const occurrence = contextIndex.occurrenceByIndex.get(skipped.occurrence_index);
      if (!occurrence || skipped.occurrence_origin !== occurrence.origin) fail("REPORT_INVALID");
      if (skipped.code === "WORD_TIMING_UNAVAILABLE"
        && !equalJson(skipped.source_interval, roundedInterval(occurrence))) fail("REPORT_INVALID");
    }
    if (skipped.code !== "WORD_TIMING_UNAVAILABLE"
      && !contextIndex.silenceByRoundedInterval.has(canonicalJson(skipped.source_interval))) fail("REPORT_INVALID");
  }
  return true;
}

export function generatedRowsSha256(candidates, skipped) {
  try {
    return sha256(canonicalBytesBounded({ candidates, skipped }, 64 * 1024 * 1024));
  } catch (error) {
    if (error instanceof RangeError) fail("REPORT_SIZE_LIMIT");
    throw error;
  }
}

export function validateGeneratedRows(report, expectedRowsSha256) {
  if (typeof expectedRowsSha256 !== "string"
    || expectedRowsSha256 !== generatedRowsSha256(report.candidates, report.skipped)) fail("REPORT_INVALID");
  return true;
}

export { RISK_ORDER, RESIDUAL_RISK_ORDER };
