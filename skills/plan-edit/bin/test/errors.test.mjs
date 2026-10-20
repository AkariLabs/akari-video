import assert from "node:assert/strict";
import test from "node:test";

import { canonicalBytes } from "../canonical-json.mjs";
import { CutCandidateError, ERROR_CODES, assertErrorDefinitions, failureBytes } from "../errors.mjs";

const groups = {
  USAGE: [2, ["USAGE_ERROR"]],
  PROJECT_CONTRACT: [2, ["PROJECT_CONTRACT_INVALID", "DECISION_LOG_INVALID", "APPROVAL_REF_INVALID"]],
  SCHEMA_VALIDATION: [2, ["KEEP_PLAN_INVALID", "ANALYSIS_SCHEMA_INVALID"]],
  SEMANTIC_VALIDATION: [2, ["ANALYSIS_MISSING", "ANALYSIS_AMBIGUOUS", "ANALYSIS_SEMANTIC_INVALID", "KEYFRAME_METADATA_AMBIGUOUS"]],
  INPUT_INTEGRITY: [3, ["PATH_ESCAPE", "SYMLINK_REJECTED", "NON_REGULAR_FILE", "INPUT_HASH_DRIFT", "INPUT_BUDGET_EXCEEDED"]],
  TOOL_IDENTITY: [3, ["TOOL_BINARY_INVALID", "TOOL_VERSION_INVALID", "TOOL_IDENTITY_DRIFT"]],
  MEDIA_PROBE: [4, ["MEDIA_CONTAINER_UNSUPPORTED", "MEDIA_DURATION_INVALID", "AUDIO_STREAM_MISSING", "MULTIPLE_AUDIO_STREAMS_REQUIRES_SELECTION", "AUDIO_STREAM_DURATION_DIVERGENCE", "FFPROBE_FAILED"]],
  SILENCE_DETECTION: [5, ["FFMPEG_FAILED", "DETECTOR_TIMEOUT", "DETECTOR_OUTPUT_LIMIT", "DETECTOR_PARSE_INVALID"]],
  REPORT_VALIDATION: [6, ["REPORT_INVALID", "REPORT_SIZE_LIMIT"]],
  CONTENT_ADDRESS_WRITE: [6, ["CONTENT_ADDRESS_COLLISION", "OUTPUT_PATH_UNSAFE", "OUTPUT_WRITE_FAILED"]],
};

test("all closed error codes produce one canonical bounded path-free line", () => {
  assert.doesNotThrow(assertErrorDefinitions);
  const expectedCodes = Object.values(groups).flatMap(([, codes]) => codes).sort();
  assert.deepEqual([...ERROR_CODES].sort(), expectedCodes);
  for (const [phase, [exitCode, codes]] of Object.entries(groups)) {
    for (const code of codes) {
      const failure = failureBytes(new CutCandidateError(code));
      const value = JSON.parse(failure.bytes);
      assert.equal(failure.exitCode, exitCode);
      assert.equal(value.code, code);
      assert.equal(value.phase, phase);
      assert.equal(value.kind, "akari-cut-candidate-error-v1");
      assert.equal(value.version, 1);
      assert.equal(Buffer.byteLength(value.message) <= 512, true);
      assert.doesNotMatch(value.message, /(?:^|\s)\/(?:[^\s]|$)/u);
      assert.equal(failure.bytes.equals(canonicalBytes(value)), true);
      assert.equal(failure.bytes.toString().split("\n").length, 2);
    }
  }
});

test("unknown internal errors collapse to the closed report error", () => {
  const failure = failureBytes(new Error("secret /absolute/path source speech"));
  assert.equal(failure.exitCode, 6);
  assert.equal(JSON.parse(failure.bytes).code, "REPORT_INVALID");
  assert.doesNotMatch(failure.bytes.toString(), /absolute|source speech/u);
});
