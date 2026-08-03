import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCandidates,
  calculatePauseFrameProposal,
  createSilenceOutputParser,
  finalizeCandidateKeyframes,
  finalizeSkipped,
  normalizeProbe,
  parseSilenceOutput,
} from "../candidate-core.mjs";
import { canonicalJson, codePointCompare, round6 } from "../canonical-json.mjs";
import {
  generatedRowsSha256,
  validateGeneratedRows,
  validateReportAgainstInputs,
} from "../contract-semantics.mjs";

const policy = {
  silence_detection_db: -35,
  minimum_silence_seconds: 0.45,
  retained_pause_seconds: { within_sentence: 0.1, sentence_end: 0.166667, topic_transition: 0.3 },
  surrounding_context_seconds: 1,
  speech_guard_seconds: 0.033333,
  frame_rate: 30,
};

function source(overrides = {}) {
  return {
    src: "desk",
    sourceOrder: 0,
    occurrences: [{ index: 0, start: 0, end: 12, origin: "explicit_range" }],
    analysis: {
      version: 0,
      source: "../../../../assets/desk.mp4",
      transcript: [
        { start: 8, end: 9.9, text: "話します", words: [{ start: 9.7, end: 9.9, text: "前" }] },
        { start: 10.9, end: 11.5, text: "続き", words: [{ start: 10.9, end: 11.1, text: "次" }] },
      ],
      keyframes: [], events: [], tracks: {},
    },
    silences: [{ start: 10, end: 10.8 }],
    ...overrides,
  };
}

test("A4 micro-oracle keeps exact 30fps pause math", () => {
  const built = buildCandidates([source()], policy);
  assert.equal(built.candidates.length, 1);
  const candidate = built.candidates[0];
  assert.equal(candidate.id, "pause-0001");
  assert.deepEqual(candidate.proposal, {
    fps: 30,
    target_retained_seconds: 0.1,
    raw_remove_start: 10.05,
    raw_remove_end: 10.75,
    remove_start_frame: 302,
    remove_end_frame: 322,
    remove_start: 10.066667,
    remove_end: 10.733333,
    actual_retained_seconds: 0.133334,
  });
});

test("chapter evidence wins classification and repeated occurrences stay separate", () => {
  const value = source();
  value.occurrences.push({ index: 1, start: 9, end: 12, origin: "explicit_range" });
  value.analysis.events.push({ type: "chapter", t: 10.4, title: "Next" });
  const built = buildCandidates([value], policy);
  assert.equal(built.candidates.length, 2);
  assert.ok(built.candidates.every((candidate) => candidate.classification === "topic_transition"));
  assert.deepEqual(built.candidates.map((candidate) => candidate.occurrence_index), [0, 1]);
});

test("semantic event projection preserves partial occurrence evidence", () => {
  const value = source({ silences: [] });
  value.occurrences = [{ index: 0, start: 4.2, end: 5, origin: "explicit_range" }];
  value.analysis.events.push({ type: "trouble", start: 4, end: 4.4, note: "retry" });
  const built = buildCandidates([value], policy);
  assert.equal(built.candidates.length, 1);
  assert.deepEqual(built.candidates[0].event.projected_interval, { start: 4.2, end: 4.4 });
  assert.equal(built.candidates[0].event.partial_event_occurrence, true);
  assert.ok(built.candidates[0].risk_flags.includes("PARTIAL_EVENT_OCCURRENCE"));
});

test("word timing unavailability disables detector family per occurrence", () => {
  const value = source();
  delete value.analysis.transcript[1].words;
  const built = buildCandidates([value], policy);
  assert.equal(built.candidates.length, 0);
  assert.equal(built.skipped.length, 1);
  assert.equal(built.skipped[0].code, "WORD_TIMING_UNAVAILABLE");
  assert.deepEqual(built.skipped[0].detail.missing_segment_indexes, [1]);
});

test("silence parser closes EOF silence and rejects overlap", () => {
  const parsed = parseSilenceOutput(Buffer.from("[silencedetect] silence_start: 10\n"), 10.8, policy);
  assert.deepEqual(parsed, [{ start: 10, end: 10.8 }]);
  assert.throws(() => parseSilenceOutput(Buffer.from([
    "silence_start: 1", "silence_end: 2", "silence_start: 1.5", "silence_end: 2.5",
  ].join("\n")), 3, policy), { code: "DETECTOR_PARSE_INVALID" });
  assert.throws(() => parseSilenceOutput(Buffer.from([
    "silence_start: 0", "silence_end: 0.5", "silence_start: 1",
  ].join("\n")), 1.5, policy, 1), { code: "DETECTOR_OUTPUT_LIMIT" });
  assert.throws(() => parseSilenceOutput(Buffer.from(
    "silence_start: 1 silence_end:\n",
  ), 2, policy), { code: "DETECTOR_PARSE_INVALID" });
});

test("incremental silence parser preserves UTF-8 and line boundaries with small-output parity", () => {
  const complete = Buffer.from("日本語の診断\nsilence_start: 1\nsilence_end: 1.5\n", "utf8");
  const expected = parseSilenceOutput(complete, 2, policy);
  const parser = createSilenceOutputParser(2, policy);
  for (const [start, end] of [[0, 1], [1, 4], [4, 19], [19, 31], [31, complete.length]]) {
    parser.push(complete.subarray(start, end));
  }
  assert.deepEqual(parser.finish(), expected);
});

test("incremental silence parser rejects invalid UTF-8 and parses a trailing non-newline EOF record", () => {
  const invalid = createSilenceOutputParser(2, policy);
  assert.throws(() => invalid.push(Buffer.from([0xc3, 0x28])), { code: "DETECTOR_PARSE_INVALID" });

  const trailing = createSilenceOutputParser(2, policy);
  trailing.push(Buffer.from("silence_start: 1"));
  assert.deepEqual(trailing.finish(), [{ start: 1, end: 2 }]);
});

test("incremental EOF closure applies the production 100,000-pair cap", () => {
  const parser = createSilenceOutputParser(100_000.5, policy);
  for (let index = 0; index < 100_000; index += 1) {
    parser.push(Buffer.from(`silence_start: ${index}\nsilence_end: ${index + 0.5}\n`));
  }
  parser.push(Buffer.from("silence_start: 100000"));
  assert.throws(() => parser.finish(), { code: "DETECTOR_OUTPUT_LIMIT" });
});

test("candidate and skip cap is checked before the next report object is emitted", () => {
  const value = source({ silences: [] });
  value.analysis.events.push(
    { type: "filler", start: 1, end: 1.2 },
    { type: "filler", start: 2, end: 2.2 },
  );
  assert.throws(() => buildCandidates([value], policy, { maximumEmitted: 1 }), {
    code: "INPUT_BUDGET_EXCEEDED",
  });
});

test("semantic partial flag preserves raw event/occurrence intersection before display rounding", () => {
  const value = source({ silences: [] });
  value.occurrences = [{ index: 0, start: 1.0000004, end: 3, origin: "explicit_range" }];
  value.analysis.events.push({ type: "filler", start: 1, end: 2 });
  const candidate = buildCandidates([value], policy).candidates[0];
  assert.deepEqual(candidate.event.event_original_interval, { start: 1, end: 2 });
  assert.deepEqual(candidate.event.projected_interval, { start: 1, end: 2 });
  assert.equal(candidate.event.partial_event_occurrence, true);
  assert.equal(candidate.risk_flags.includes("PARTIAL_EVENT_OCCURRENCE"), true);
});

test("semantic projection fails closed when distinct raw bounds collapse after display rounding", () => {
  const value = source({ silences: [] });
  value.occurrences = [{ index: 0, start: 1.0000004, end: 3, origin: "explicit_range" }];
  value.analysis.events.push({ type: "filler", start: 1, end: 1.00000049 });
  assert.throws(() => buildCandidates([value], policy), { code: "REPORT_INVALID" });
});

test("probe normalization requires exactly one audio stream", () => {
  const normalized = normalizeProbe({
    format: { duration: "12", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
    streams: [{ index: 0, codec_type: "video", duration: "12" }, { index: 2, codec_type: "audio", duration: "12" }],
  });
  assert.equal(normalized.selected_audio_stream_index, 2);
  assert.equal(normalized.audio_format_delta_seconds, 0);
  assert.throws(() => normalizeProbe({
    format: { duration: "12", format_name: "mov" }, streams: [{ index: 0, codec_type: "video" }],
  }), { code: "AUDIO_STREAM_MISSING" });
});

test("keyframe finalization deduplicates context references and removes internal fields", () => {
  const value = source();
  value.analysis.keyframes.push({ t: 10.4, path: "keyframes/a.jpg", note: "screen" });
  const built = buildCandidates([value], policy);
  finalizeCandidateKeyframes(built.candidates, () => 0);
  finalizeSkipped(built.skipped);
  assert.deepEqual(built.candidates[0].context.keyframe_input_indexes, [0]);
  assert.equal(Object.keys(built.candidates[0]).some((key) => key.startsWith("_")), false);
});

test("chapter basis follows time/event order and segment-internal punctuation does not promote", () => {
  const value = source();
  value.analysis.events.push(
    { type: "chapter", t: 10.6, title: "later" },
    { type: "chapter", t: 10.2, title: "earlier" },
  );
  let built = buildCandidates([value], policy);
  assert.equal(built.candidates[0].classification, "topic_transition");
  assert.deepEqual(built.candidates[0].classification_basis, { kind: "chapter_event", event_index: 1 });
  assert.deepEqual(built.candidates[0].context.chapter_event_indexes, [1, 0]);

  const internal = source();
  internal.analysis.transcript = [{
    start: 9.5,
    end: 11.2,
    text: "全体は句点で終わる。",
    words: [
      { start: 9.7, end: 9.9, text: "前" },
      { start: 10.9, end: 11.1, text: "後" },
    ],
  }];
  built = buildCandidates([internal], policy);
  assert.equal(built.candidates[0].classification, "within_sentence");
});

test("sentence terminal classification follows chronological final word, not input array order", () => {
  const value = source();
  value.analysis.transcript[0] = {
    start: 8,
    end: 9.9,
    text: "文が終わる。",
    words: [
      { start: 9.7, end: 9.9, text: "終わる" },
      { start: 8.5, end: 8.8, text: "文が" },
    ],
  };
  assert.equal(buildCandidates([value], policy).candidates[0].classification, "sentence_end");
});

test("frame-cell epsilon is limited to ceil/floor conversion at integer, half, and ±1e-9 boundaries", () => {
  const starts = [
    [1 / 30, 1],
    [1 / 60, 1],
    [1 / 30 - 1e-9, 1],
    [1 / 30 + 1e-9, 1],
    [1 / 30 + 1.0001e-9, 2],
  ];
  for (const [start, expected] of starts) {
    assert.equal(calculatePauseFrameProposal({ start, end: 1 }, 0).startFrame, expected);
  }
  const ends = [
    [29 / 30, 29],
    [59 / 60, 29],
    [29 / 30 - 1e-9, 29],
    [29 / 30 + 1e-9, 29],
    [29 / 30 - 1.0001e-9, 28],
  ];
  for (const [end, expected] of ends) {
    assert.equal(calculatePauseFrameProposal({ start: 0, end }, 0).endFrame, expected);
  }
});

test("context availability comparisons do not inherit the frame conversion epsilon", () => {
  const exact = source();
  exact.analysis.transcript[0] = {
    start: 8,
    end: 9,
    text: "前",
    words: [{ start: 8.8, end: 9, text: "前" }],
  };
  assert.equal(buildCandidates([exact], policy).candidates.length, 1);

  const outside = source();
  outside.analysis.transcript[0] = {
    start: 8,
    end: 8.9999999995,
    text: "前",
    words: [{ start: 8.8, end: 8.9999999995, text: "前" }],
  };
  assert.equal(buildCandidates([outside], policy).skipped[0].code, "MISSING_SPEECH_CONTEXT");
});

test("canonical ordering compares Unicode scalar values instead of UTF-16 code units", () => {
  assert.equal(codePointCompare("\ue000", "😀"), -1);
  assert.equal(canonicalJson({ "😀": 2, "\ue000": 1 }), "{\"\":1,\"😀\":2}");
});

test("generation row postcondition rejects removal, classification, and skip-detail mutation", () => {
  const baseline = {
    candidates: [{ id: "pause-0001", classification: "within_sentence" }],
    skipped: [{ id: "skip-0001", detail: { detector_pair_index: 0 } }],
  };
  const expected = generatedRowsSha256(baseline.candidates, baseline.skipped);
  assert.equal(validateGeneratedRows(baseline, expected), true);
  assert.throws(() => validateGeneratedRows({ ...baseline, candidates: [] }, expected), { code: "REPORT_INVALID" });
  assert.throws(() => validateGeneratedRows({ ...baseline, candidates: [{ ...baseline.candidates[0], classification: "sentence_end" }] }, expected), { code: "REPORT_INVALID" });
  assert.throws(() => validateGeneratedRows({ ...baseline, skipped: [{ ...baseline.skipped[0], detail: {} }] }, expected), { code: "REPORT_INVALID" });
});

test("input binding rejects context-outside chapter evidence despite a matching attacker digest", () => {
  const value = source();
  value.analysis.events.push({ type: "chapter", t: 2, title: "outside context" });
  value.sourceIndex = 0;
  value.sourceFile = { relative: "assets/desk.mp4" };
  value.analysisSnapshot = { relative: ".akari/sidecars/assets/desk.mp4.analysis/analysis.json" };
  value.analysisDirectory = "/project/.akari/sidecars/assets/desk.mp4.analysis";
  const built = buildCandidates([value], policy);
  finalizeCandidateKeyframes(built.candidates, () => {
    throw new Error("unexpected keyframe");
  });
  finalizeSkipped(built.skipped);
  const contractSchemas = [
    { id: "analysis-v0", canonical_source_path: "packages/schemas/analysis.schema.json", sha256: "0".repeat(64) },
    { id: "semantic-keep-plan-v1", canonical_source_path: "packages/schemas/semantic-keep-plan.schema.json", sha256: "0".repeat(64) },
    { id: "cut-candidates-v1", canonical_source_path: "packages/schemas/cut-candidates.schema.json", sha256: "0".repeat(64) },
  ];
  const report = {
    tool: { contract_schemas: contractSchemas },
    inputs: {
      processed_sources: [{ id: "desk", path: "assets/desk.mp4" }],
      analyses: [{ src: "desk", path: value.analysisSnapshot.relative }],
      keyframes: [],
    },
    candidates: built.candidates,
    skipped: built.skipped,
  };
  const inputContext = {
    plan: {
      sources: [{ id: "desk", path: "assets/desk.mp4" }],
      occurrences: [{ source_index: 0 }],
    },
    sources: [value],
    expectedContractSchemas: contractSchemas,
    expectedRowsSha256: generatedRowsSha256(report.candidates, report.skipped),
    root: "/project",
  };
  assert.equal(validateReportAgainstInputs(report, inputContext), true);

  const mutated = structuredClone(report);
  const candidate = mutated.candidates[0];
  candidate.classification = "topic_transition";
  candidate.classification_basis = { kind: "chapter_event", event_index: 0 };
  const proposal = calculatePauseFrameProposal(candidate.source_interval, 0.3);
  candidate.proposal = {
    fps: 30,
    target_retained_seconds: 0.3,
    raw_remove_start: round6(proposal.rawStart),
    raw_remove_end: round6(proposal.rawEnd),
    remove_start_frame: proposal.startFrame,
    remove_end_frame: proposal.endFrame,
    remove_start: proposal.removeStart,
    remove_end: proposal.removeEnd,
    actual_retained_seconds: proposal.retainedAfter,
  };
  assert.throws(() => validateReportAgainstInputs(mutated, {
    ...inputContext,
    expectedRowsSha256: generatedRowsSha256(mutated.candidates, mutated.skipped),
  }), { code: "REPORT_INVALID" });
});

test("crossing, outside, missing context, and protected speech remain closed skips", () => {
  const crossing = source();
  crossing.occurrences = [{ index: 0, start: 9, end: 10.4, origin: "explicit_range" }];
  assert.equal(buildCandidates([crossing], policy).skipped[0].code, "CROSSES_OCCURRENCE_BOUNDARY");

  const outside = source();
  outside.occurrences = [{ index: 0, start: 0, end: 5, origin: "explicit_range" }];
  const outsideResult = buildCandidates([outside], policy).skipped[0];
  assert.equal(outsideResult.code, "OUTSIDE_KEEP_OCCURRENCE");
  assert.equal(outsideResult.occurrence_index, null);

  const missing = source();
  missing.analysis.transcript[0].words[0].end = 8;
  const missingResult = buildCandidates([missing], policy).skipped[0];
  assert.equal(missingResult.code, "MISSING_SPEECH_CONTEXT");
  assert.equal(missingResult.detail.previous_word_available, false);

  const protectedSource = source();
  protectedSource.analysis.transcript.push({
    start: 10.1,
    end: 10.6,
    text: "protected",
    words: [
      { start: 10.2, end: 10.3, text: "a" },
      { start: 10.4, end: 10.5, text: "b" },
    ],
  });
  const protectedResult = buildCandidates([protectedSource], policy).skipped[0];
  assert.equal(protectedResult.code, "PROTECTED_WORD_OVERLAP");
  assert.deepEqual(protectedResult.detail.protected_words.map((word) => word.text), ["a", "b"]);
});
