import assert from "node:assert/strict";
import test from "node:test";

import { buildAudioQc, parseLoudnormReport } from "../src/audio-qc.mjs";

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
