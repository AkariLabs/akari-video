import assert from "node:assert/strict";
import test from "node:test";

import { AAC_TRUE_PEAK_OVERSHOOT_MARGIN_DBTP, appliedTruePeakDbtp, buildAudioQc, parseLoudnormReport } from "../src/audio-qc.mjs";

const filterJson = `noise\n{\n "output_i" : "-14.52",\n "output_tp" : "-1.70"\n}\n`;

test("filter and decoded reports preserve raw strings without mixing fields", () => {
  const qc = buildAudioQc({
    master: { loudnorm: -14, true_peak_dbtp: -1.7 },
    filterStderr: filterJson,
    outputPath: "/fixture/final.mp4",
    ffmpegCommand: "ffmpeg",
    toolVersion: "ffmpeg fixture",
    spawnSyncImpl: () => ({
      status: 0,
      stderr: `{ "input_i":"-14.89", "input_tp":"-1.51", "output_i":"-14.01", "output_tp":"-1.70" }`,
    }),
  });
  assert.equal(qc.verdict, "INCONCLUSIVE");
  assert.deepEqual(qc.filter_report, {
    normalized: { output_i: -14.52, output_tp: -1.7 },
    raw: { output_i: "-14.52", output_tp: "-1.70" },
  });
  assert.deepEqual(qc.decoded_measurement.normalized, { input_i: -14.89, input_tp: -1.51 });
});

// task 2026-08-17-render-cut-true-peak-guard 裁定A: decoded_measurement exceeding
// configured.true_peak_dbtp by more than the tolerance must be machine-detectable from the
// receipt alone, without changing verdict away from "INCONCLUSIVE" (status-core/integrity.mjs's
// validateAudioQc treats any other verdict string as a structural integrity problem).
function buildWithDecodedInputTp(inputTp, master = { loudnorm: -14, true_peak_dbtp: -1 }) {
  return buildAudioQc({
    master,
    filterStderr: filterJson,
    outputPath: "/fixture/final.mp4",
    ffmpegCommand: "ffmpeg",
    toolVersion: "ffmpeg fixture",
    spawnSyncImpl: () => ({
      status: 0,
      stderr: `{ "input_i":"-14.20", "input_tp":"${inputTp}", "output_i":"-14.01", "output_tp":"-1.70" }`,
    }),
  });
}

test("decoded true peak exceeding configured true_peak_dbtp by more than the tolerance adds a TRUE_PEAK_EXCEEDED warning, verdict stays INCONCLUSIVE", () => {
  const exceeded = buildWithDecodedInputTp("0.23");
  assert.equal(exceeded.verdict, "INCONCLUSIVE");
  assert.deepEqual(exceeded.warnings, [
    "TRUE_PEAK_EXCEEDED: decoded_measurement.normalized.input_tp (0.23) exceeds configured.true_peak_dbtp (-1) by 1.23 dB",
  ]);
});

test("decoded true peak within tolerance of configured true_peak_dbtp adds no warnings field", () => {
  const withinTolerance = buildWithDecodedInputTp("-0.95"); // exactly -1 + 0.05, under the 0.1 tolerance
  assert.equal(withinTolerance.verdict, "INCONCLUSIVE");
  assert.equal(withinTolerance.warnings, undefined);
  const quieter = buildWithDecodedInputTp("-3");
  assert.equal(quieter.warnings, undefined);
});

test("decoded true peak exactly at the 0.1 dB tolerance boundary does not count as exceeded", () => {
  const atBoundary = buildWithDecodedInputTp("-0.9"); // exactly configured (-1) + tolerance (0.1)
  assert.equal(atBoundary.warnings, undefined);
});

test("true_peak_margin is recorded only when true_peak_dbtp is explicit, using the shared margin constant", () => {
  const explicit = buildWithDecodedInputTp("-3", { loudnorm: -14, true_peak_dbtp: -1.7 });
  assert.deepEqual(explicit.true_peak_margin, {
    overshoot_margin_dbtp: AAC_TRUE_PEAK_OVERSHOOT_MARGIN_DBTP,
    applied_true_peak_dbtp: appliedTruePeakDbtp(-1.7),
  });
  assert.equal(explicit.true_peak_margin.applied_true_peak_dbtp, -3.2);

  const defaulted = buildWithDecodedInputTp("-3", { loudnorm: -14 });
  assert.equal(defaulted.true_peak_margin, undefined);
  assert.equal(defaulted.configured.true_peak_dbtp, -1.5, "unspecified true_peak_dbtp keeps today's -1.5 dBTP default, unmargined");
});

test("-inf is retained and missing/invalid/parse/capture failures are discriminated", () => {
  assert.deepEqual(parseLoudnormReport('{"input_i":"-inf","input_tp":"-inf"}', "decoded_measurement", "input_i", "input_tp").normalized, {
    input_i: "-inf", input_tp: "-inf",
  });
  const missing = buildAudioQc({
    master: {}, filterStderr: '{"output_i":"-14"}', outputPath: "x", ffmpegCommand: "x", toolVersion: "x",
  });
  assert.equal(missing.error.code, "MISSING_FIELD");
  const parse = buildAudioQc({ master: {}, filterStderr: "not-json", outputPath: "x", ffmpegCommand: "x", toolVersion: "x" });
  assert.equal(parse.error.code, "JSON_NOT_FOUND");
  const capture = buildAudioQc({
    master: {}, filterStderr: filterJson, outputPath: "x", ffmpegCommand: "x", toolVersion: "x",
    spawnSyncImpl: () => ({ error: { code: "ENOBUFS" }, status: null, stderr: "" }),
  });
  assert.deepEqual(capture.error, {
    phase: "decoded_measurement", code: "CAPTURE_LIMIT", message: "decoded measurement exceeded bounded capture",
  });
});

test("raw QC metrics accept only strict finite decimal text or exact -inf", () => {
  const valid = [
    ["+1", 1],
    ["1.", 1],
    [".5", 0.5],
    ["-1.25e+2", -125],
    ["1E-2", 0.01],
  ];
  for (const [raw, expected] of valid) {
    const report = parseLoudnormReport(`{"input_i":"${raw}","input_tp":"-0"}`, "decoded_measurement", "input_i", "input_tp");
    assert.equal(report.normalized.input_i, expected, raw);
    assert.ok(Object.is(report.normalized.input_tp, -0), `${raw}: negative zero must remain numeric -0 before JSON serialization`);
  }
  for (const raw of ["", " ", "0x10", "Infinity", "NaN", "+", "1_0", "1,0", "--1", "1e", "-inf "]) {
    assert.throws(
      () => parseLoudnormReport(JSON.stringify({ input_i: raw, input_tp: "0" }), "decoded_measurement", "input_i", "input_tp"),
      error => error?.code === "INVALID_VALUE",
      raw,
    );
  }
});
