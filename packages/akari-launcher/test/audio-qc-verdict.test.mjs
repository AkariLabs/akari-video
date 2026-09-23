import assert from "node:assert/strict";
import test from "node:test";

import { validateAudioQc } from "../src/status-core/integrity.mjs";
import { formatAudioQcAcceptance } from "../src/accept-command.mjs";

const base = {
  configured: { integrated_lufs: -14, true_peak_dbtp: -1.5 },
  filter_report: { raw: { output_i: "-14.2", output_tp: "-2.0" }, normalized: { output_i: -14.2, output_tp: -2 } },
  decoded_measurement: {
    metric: "ffmpeg-loudnorm-input-v1",
    raw: { input_i: "-14.3", input_tp: "-2.2" },
    normalized: { input_i: -14.3, input_tp: -2.2 },
  },
  tool_version: "ffmpeg fixture",
  verdict: "PASS",
};

function inspect(qc) {
  const problems = [], warnings = [];
  validateAudioQc(qc, problems, warnings);
  return { problems, warnings };
}

test("PASS is recalculated from receipt fields and has no human review warning", () => {
  assert.deepEqual(inspect(base), { problems: [], warnings: [] });
  assert.equal(formatAudioQcAcceptance(base), "Audio QC: PASS.\n");
  assert.doesNotMatch(formatAudioQcAcceptance(base), /WARNING/u);
  for (const qc of [
    { ...base, decoded_measurement: { ...base.decoded_measurement, raw: { ...base.decoded_measurement.raw, input_i: "-12.9" }, normalized: { ...base.decoded_measurement.normalized, input_i: -12.9 } } },
    { ...base, decoded_measurement: { ...base.decoded_measurement, raw: { ...base.decoded_measurement.raw, input_tp: "-1.3" }, normalized: { ...base.decoded_measurement.normalized, input_tp: -1.3 } } },
    { ...base, decoded_measurement: { ...base.decoded_measurement, raw: { ...base.decoded_measurement.raw, input_i: "-inf" }, normalized: { ...base.decoded_measurement.normalized, input_i: "-inf" } } },
  ]) {
    assert.ok(inspect(qc).problems.some(problem => problem.includes("PASS does not match")));
  }
  assert.deepEqual(inspect({ ...base, tool_version: null }).problems, ["audio_qc configured target or tool version is invalid"]);
});

test("legacy INCONCLUSIVE receipt remains valid and prompts review", () => {
  const qc = { ...base, verdict: "INCONCLUSIVE" };
  assert.deepEqual(inspect(qc).problems, []);
  assert.ok(inspect(qc).warnings.some(warning => warning.includes("require human review")));
  assert.match(formatAudioQcAcceptance(qc), /^WARNING:/u);
  assert.deepEqual(inspect({ ...qc, tool_version: null }).problems, ["audio_qc configured target or tool version is invalid"]);
  assert.ok(inspect({ ...base, verdict: "UNKNOWN" }).problems.includes("audio_qc verdict is invalid"));
});
