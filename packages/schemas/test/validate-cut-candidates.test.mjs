import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { createRequire } from "node:module";
import { validateContractSchemaReceipts } from "../../../skills/edit-plan/bin/contract-semantics.mjs";

const schema = JSON.parse(await readFile(new URL("../cut-candidates.schema.json", import.meta.url), "utf8"));
const validateCanonical = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
const require = createRequire(import.meta.url);
const generated = require(path.resolve(import.meta.dirname, "../../../skills/edit-plan/bin/generated/contract-validators.cjs"));
const hash = "0".repeat(64);

function validReport() {
  const module = (role, skill_relative_path) => ({ role, skill_relative_path, bytes: 1, sha256: hash });
  return {
    version: 1,
    kind: "akari-cut-candidates-v1",
    policy: {
      id: "a4-conversation-v1", origin: "EDIT_PLAN_SKILL",
      skill_relative_path: "references/cut-candidate-policy.a4-conversation-v1.json", bytes: 1, sha256: hash,
      values: {
        silence_detection_db: -35, minimum_silence_seconds: 0.45,
        retained_pause_seconds: { within_sentence: 0.1, sentence_end: 0.166667, topic_transition: 0.3 },
        surrounding_context_seconds: 1, speech_guard_seconds: 0.033333, frame_rate: 30,
      },
    },
    inputs: {
      semantic_keep_plan: { path: ".akari/work/semantic-keep-plan.json", bytes: 1, sha256: hash, claim: "CALLER_SUPPLIED_SEMANTIC_KEEP_DRAFT" },
      decision_log: {
        path: "edit-plan/decision-log.md", bytes: 1, sha256: hash,
        approval_ref: "checkpoint-1/cut-direction/2026-08-03", verification: "CALLER_ASSERTED_NOT_MACHINE_VERIFIED",
      },
      processed_sources: [], analyses: [], keyframes: [],
    },
    tool: {
      module_source_set: [
        module("entrypoint", "bin/propose-cut-candidates.mjs"),
        module("helper", "bin/canonical-json.mjs"),
        module("schema_validator", "bin/generated/contract-validators.cjs"),
        module("semantic_validator", "bin/contract-semantics.mjs"),
      ],
      module_source_set_sha256: hash,
      contract_schemas: [
        { id: "analysis-v0", canonical_source_path: "packages/schemas/analysis.schema.json", sha256: hash },
        { id: "semantic-keep-plan-v1", canonical_source_path: "packages/schemas/semantic-keep-plan.schema.json", sha256: hash },
        { id: "cut-candidates-v1", canonical_source_path: "packages/schemas/cut-candidates.schema.json", sha256: hash },
      ],
      ffmpeg: { version: "ffmpeg version fixture", binary_bytes: 1, binary_sha256: hash },
      ffprobe: { version: "ffprobe version fixture", binary_bytes: 1, binary_sha256: hash },
      node: {
        platform: "darwin", arch: "arm64", node_version: "v22", v8_version: "12",
        node_binary_bytes: 1, node_binary_sha256: hash,
      },
      detector_argv_template_sha256: hash,
    },
    candidates: [], skipped: [],
    summary: {
      candidate_count: 0, semantic_event_review_count: 0, pause_shortening_review_count: 0,
      skipped_count: 0, skipped_by_code: {}, by_source: [],
    },
    residual_risks: [
      "ANALYSIS_FRESHNESS_UNVERIFIED", "CONCURRENT_RETARGET_NOT_PROVEN", "DYNAMIC_LIBRARY_CLOSURE_UNVERIFIED",
    ],
    approved_to_apply: false,
    edit_json_modified: false,
  };
}

test("canonical and generated validators accept the minimum closed report", () => {
  const report = validReport();
  assert.equal(validateCanonical(report), true, JSON.stringify(validateCanonical.errors));
  assert.equal(generated.validateCutCandidates(report), true, JSON.stringify(generated.validateCutCandidates.errors));
});

test("report schema requires Node identity and rejects application authority", () => {
  const noNode = validReport();
  delete noNode.tool.node;
  assert.equal(validateCanonical(noNode), false);
  assert.equal(generated.validateCutCandidates(noNode), false);

  const applied = validReport();
  applied.approved_to_apply = true;
  assert.equal(validateCanonical(applied), false);
  assert.equal(generated.validateCutCandidates(applied), false);
});

test("candidate and module vocabularies are closed", () => {
  const report = validReport();
  report.tool.module_source_set[0].role = "other";
  assert.equal(validateCanonical(report), false);
  assert.equal(generated.validateCutCandidates(report), false);
});

test("contract schema receipts bind each id to its canonical source path", () => {
  const receipts = structuredClone(validReport().tool.contract_schemas);
  assert.equal(validateContractSchemaReceipts(receipts), true);
  receipts[0].sha256 = "1".repeat(64);
  receipts[1].sha256 = "2".repeat(64);
  const first = { ...receipts[0] };
  receipts[0].canonical_source_path = receipts[1].canonical_source_path;
  receipts[0].sha256 = receipts[1].sha256;
  receipts[1].canonical_source_path = first.canonical_source_path;
  receipts[1].sha256 = first.sha256;
  assert.throws(() => validateContractSchemaReceipts(receipts), { code: "REPORT_INVALID" });
});

test("report path receipts reject absolute, URL, parent, and backslash forms", () => {
  for (const invalid of ["/absolute/file", "https://example.test/file", "../outside", "a\\b"]) {
    const report = validReport();
    report.inputs.decision_log.path = invalid;
    assert.equal(validateCanonical(report), false);
    assert.equal(generated.validateCutCandidates(report), false);
  }
});
