import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { buildCandidates, finalizeCandidateKeyframes, finalizeSkipped } from "../candidate-core.mjs";
import { generatedRowsSha256, validateReportAgainstInputs } from "../contract-semantics.mjs";
import { summaryFor } from "../propose-cut-candidates.mjs";

const policy = {
  silence_detection_db: -35,
  minimum_silence_seconds: 0.45,
  retained_pause_seconds: { within_sentence: 0.1, sentence_end: 0.166667, topic_transition: 0.3 },
  surrounding_context_seconds: 1,
  speech_guard_seconds: 0.033333,
  frame_rate: 30,
};
const hash = "0".repeat(64);
const contractSchemas = [
  { id: "analysis-v0", canonical_source_path: "packages/schemas/analysis.schema.json", sha256: hash },
  { id: "semantic-keep-plan-v1", canonical_source_path: "packages/schemas/semantic-keep-plan.schema.json", sha256: hash },
  { id: "cut-candidates-v1", canonical_source_path: "packages/schemas/cut-candidates.schema.json", sha256: hash },
];

test("representative 10-source / 10k-occurrence / 100k-word scale stays bounded", (context) => {
  const sources = [];
  for (let sourceIndex = 0; sourceIndex < 10; sourceIndex += 1) {
    const words = [];
    for (let index = 0; index < 10_000; index += 1) {
      words.push({ start: index + 0.1, end: index + 0.2, text: `w${index}` });
    }
    const occurrences = [];
    const events = [];
    for (let index = 0; index < 1_000; index += 1) {
      occurrences.push({ index: sourceIndex * 1_000 + index, start: index * 10, end: index * 10 + 5, origin: "explicit_range" });
      events.push({ type: "filler", start: index * 10 + 2, end: index * 10 + 2.2 });
    }
    sources.push({
      src: `s${sourceIndex}`,
      sourceOrder: sourceIndex,
      occurrences,
      analysis: {
        version: 0,
        source: "fixture.mp4",
        transcript: [{ start: 0, end: 10_000, text: "fixture", words }],
        keyframes: [],
        events,
        tracks: {},
      },
      silences: [],
    });
  }
  const started = performance.now();
  const built = buildCandidates(sources, policy);
  const elapsed = performance.now() - started;
  assert.equal(built.candidates.length, 10_000);
  assert.equal(built.skipped.length, 0);
  assert.ok(elapsed < 15_000, `candidate construction took ${elapsed.toFixed(1)}ms`);
  assert.ok(process.memoryUsage().rss < 512 * 1024 * 1024, `RSS exceeded contract: ${process.memoryUsage().rss}`);
  const outputBytes = Buffer.byteLength(JSON.stringify({ candidates: built.candidates, skipped: built.skipped }));
  assert.ok(outputBytes < 64 * 1024 * 1024);
  context.diagnostic(JSON.stringify({
    sources: 10,
    occurrences: 10_000,
    words: 100_000,
    candidates: built.candidates.length,
    elapsed_ms: Math.round(elapsed),
    rss_bytes: process.memoryUsage().rss,
    candidate_bytes: outputBytes,
  }));
});

test("dense long occurrence uses indexed context lookup instead of occurrence-record Cartesian scans", (context) => {
  const words = [];
  for (let index = 0; index < 20_000; index += 1) {
    words.push({ start: index + 0.1, end: index + 0.2, text: `w${index}` });
  }
  const events = [];
  for (let index = 0; index < 2_000; index += 1) {
    events.push({ type: "filler", start: index * 5 + 2, end: index * 5 + 2.2 });
  }
  const value = {
    src: "dense",
    sourceOrder: 0,
    occurrences: [{ index: 0, start: 0, end: 20_000, origin: "explicit_range" }],
    analysis: {
      version: 0,
      source: "fixture.mp4",
      transcript: [{ start: 0, end: 20_000, text: "fixture", words }],
      keyframes: [],
      events,
      tracks: {},
    },
    silences: [],
  };
  const started = performance.now();
  const built = buildCandidates([value], policy);
  const elapsed = performance.now() - started;
  assert.equal(built.candidates.length, 2_000);
  assert.ok(elapsed < 5_000, `dense indexed construction took ${elapsed.toFixed(1)}ms`);
  assert.ok(process.memoryUsage().rss < 512 * 1024 * 1024);
  context.diagnostic(JSON.stringify({ dense_words: words.length, dense_events: events.length, elapsed_ms: Math.round(elapsed) }));
});

test("10k candidate / 10k keyframe input binding stays linear", (context) => {
  const count = 10_000;
  const events = [];
  const keyframes = [];
  const keyframeReceipts = [];
  const analysisDirectory = "/project/.akari/sidecars/assets/dense.mp4.analysis";
  for (let index = 0; index < count; index += 1) {
    const start = index * 3 + 1;
    const keyframePath = `keyframes/k-${String(index).padStart(5, "0")}.jpg`;
    const note = `screen-${index}`;
    events.push({ type: "filler", start, end: start + 0.1 });
    keyframes.push({ t: start + 0.05, path: keyframePath, note });
    keyframeReceipts.push({
      input_index: index,
      src: "dense",
      t: start + 0.05,
      path: `.akari/sidecars/assets/dense.mp4.analysis/${keyframePath}`,
      note,
    });
  }
  const value = {
    src: "dense",
    sourceIndex: 0,
    sourceOrder: 0,
    sourceFile: { relative: "assets/dense.mp4" },
    analysisSnapshot: { relative: ".akari/sidecars/assets/dense.mp4.analysis/analysis.json" },
    analysisDirectory,
    occurrences: [{ index: 0, start: 0, end: count * 3 + 2, origin: "explicit_range" }],
    analysis: {
      version: 0,
      source: "../../../../assets/dense.mp4",
      transcript: [],
      keyframes,
      events,
      tracks: {},
    },
    silences: [],
  };
  const built = buildCandidates([value], policy);
  finalizeCandidateKeyframes(built.candidates, (_src, keyframe) => keyframe.originalIndex);
  finalizeSkipped(built.skipped);
  let keyframeReceiptReads = 0;
  const observedReceipts = new Proxy(keyframeReceipts, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^(?:0|[1-9][0-9]*)$/u.test(property)) keyframeReceiptReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const report = {
    tool: { contract_schemas: contractSchemas },
    inputs: {
      processed_sources: [{ id: "dense", path: "assets/dense.mp4" }],
      analyses: [{ src: "dense", path: value.analysisSnapshot.relative }],
      keyframes: observedReceipts,
    },
    candidates: built.candidates,
    skipped: built.skipped,
  };
  const inputContext = {
    plan: {
      sources: [{ id: "dense", path: "assets/dense.mp4" }],
      occurrences: [{ source_index: 0 }],
    },
    sources: [value],
    expectedRowsSha256: generatedRowsSha256(report.candidates, report.skipped),
    expectedContractSchemas: contractSchemas,
    root: "/project",
  };
  const started = performance.now();
  assert.equal(validateReportAgainstInputs(report, inputContext), true);
  const elapsed = performance.now() - started;
  assert.equal(built.candidates.length, count);
  assert.ok(keyframeReceiptReads <= count + 1,
    `keyframe receipts were rescanned: ${keyframeReceiptReads} reads for ${count} receipts`);
  assert.ok(elapsed < 15_000, `input binding took ${elapsed.toFixed(1)}ms`);
  assert.ok(process.memoryUsage().rss < 512 * 1024 * 1024, `RSS exceeded contract: ${process.memoryUsage().rss}`);
  const ambiguousReceipts = [
    ...keyframeReceipts,
    { ...keyframeReceipts[0], input_index: count, note: "ambiguous duplicate" },
  ];
  assert.throws(() => validateReportAgainstInputs({
    ...report,
    inputs: { ...report.inputs, keyframes: ambiguousReceipts },
  }, inputContext), { code: "REPORT_INVALID" });
  context.diagnostic(JSON.stringify({
    candidates: built.candidates.length,
    keyframes: keyframeReceipts.length,
    keyframe_receipt_reads: keyframeReceiptReads,
    elapsed_ms: Math.round(elapsed),
    rss_bytes: process.memoryUsage().rss,
  }));
});

test("256-source summary aggregation is linear in report rows", (context) => {
  const sources = Array.from({ length: 256 }, (_, index) => ({ src: `s${index}` }));
  const candidates = [];
  const skipped = [];
  for (let index = 0; index < 100_000; index += 1) {
    const src = `s${index % sources.length}`;
    candidates.push({ src, family: index % 2 === 0 ? "semantic_event_review" : "pause_shortening_review" });
    skipped.push({ src, code: "NO_EFFECTIVE_CHANGE" });
  }
  const started = performance.now();
  const summary = summaryFor(sources, candidates, skipped);
  const elapsed = performance.now() - started;
  assert.equal(summary.candidate_count, 100_000);
  assert.equal(summary.skipped_count, 100_000);
  assert.equal(summary.by_source.length, 256);
  assert.equal(summary.by_source.reduce((total, value) => total + value.candidate_count, 0), 100_000);
  assert.ok(elapsed < 5_000, `linear summary took ${elapsed.toFixed(1)}ms`);
  context.diagnostic(JSON.stringify({ summary_sources: 256, summary_rows: 200_000, elapsed_ms: Math.round(elapsed) }));
});
