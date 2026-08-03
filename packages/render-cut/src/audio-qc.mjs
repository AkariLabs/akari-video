import { spawnSync } from "node:child_process";

export const AUDIO_QC_CAPTURE_LIMIT_BYTES = 1024 * 1024;
// akari-audio-qc-decimal-v1: exact finite base-10 text only. Keep this grammar in parity with
// status-core/integrity.mjs because receipts must be interpreted exactly as they were generated.
const STRICT_FINITE_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

export function configuredAudioQc(master) {
  return {
    integrated_lufs: typeof master?.loudnorm === "number" && Number.isFinite(master.loudnorm) ? master.loudnorm : -14,
    true_peak_dbtp: typeof master?.true_peak_dbtp === "number" && Number.isFinite(master.true_peak_dbtp) ? master.true_peak_dbtp : -1.5,
  };
}

export function measurementErrorAudioQc({ master, phase, code, message, filterReport = null, toolVersion }) {
  return {
    configured: configuredAudioQc(master),
    filter_report: phase === "filter_report" ? null : filterReport,
    decoded_measurement: null,
    tool_version: toolVersion,
    verdict: "MEASUREMENT_ERROR",
    error: { phase, code, message: boundedMessage(message) },
  };
}

export function buildAudioQc({
  master,
  filterStderr,
  outputPath,
  ffmpegCommand,
  toolVersion,
  spawnSyncImpl = spawnSync,
}) {
  let filterReport;
  try {
    filterReport = parseLoudnormReport(filterStderr, "filter_report", "output_i", "output_tp");
  } catch (error) {
    return measurementErrorAudioQc({ master, phase: "filter_report", code: error.code, message: error.message, toolVersion });
  }
  const configured = configuredAudioQc(master);
  const result = spawnSyncImpl(ffmpegCommand, [
    "-hide_banner",
    "-nostats",
    "-i",
    outputPath,
    "-af",
    `loudnorm=I=${configured.integrated_lufs}:TP=${configured.true_peak_dbtp}:LRA=11:print_format=json`,
    "-f",
    "null",
    "-",
  ], { encoding: "utf8", maxBuffer: AUDIO_QC_CAPTURE_LIMIT_BYTES });
  if (result.error) {
    return measurementErrorAudioQc({
      master,
      phase: "decoded_measurement",
      code: result.error.code === "ENOBUFS" ? "CAPTURE_LIMIT" : "PROCESS_FAILED",
      message: result.error.code === "ENOBUFS" ? "decoded measurement exceeded bounded capture" : "decoded measurement process failed",
      filterReport,
      toolVersion,
    });
  }
  if (result.status !== 0) {
    return measurementErrorAudioQc({ master, phase: "decoded_measurement", code: "PROCESS_FAILED", message: "decoded measurement process exited unsuccessfully", filterReport, toolVersion });
  }
  let decoded;
  try {
    const parsed = parseLoudnormReport(result.stderr, "decoded_measurement", "input_i", "input_tp");
    decoded = { metric: "ffmpeg-loudnorm-input-v1", ...parsed };
  } catch (error) {
    return measurementErrorAudioQc({ master, phase: "decoded_measurement", code: error.code, message: error.message, filterReport, toolVersion });
  }
  return {
    configured,
    filter_report: filterReport,
    decoded_measurement: decoded,
    tool_version: toolVersion,
    verdict: "INCONCLUSIVE",
  };
}

export function parseLoudnormReport(stderr, phase, firstField, secondField) {
  if (typeof stderr !== "string") throw qcError("JSON_NOT_FOUND", `${phase} JSON was not found`);
  const candidates = stderr.match(/\{[^{}]*\}/gs) ?? [];
  let value;
  for (let index = candidates.length - 1; index >= 0; index--) {
    try {
      const candidate = JSON.parse(candidates[index]);
      if (candidate && typeof candidate === "object" && (firstField in candidate || secondField in candidate)) {
        value = candidate;
        break;
      }
    } catch {
      // Continue to an earlier object; ffmpeg may print unrelated braces.
    }
  }
  if (!value) throw qcError("JSON_NOT_FOUND", `${phase} JSON was not found`);
  const first = normalizeRawMetric(value[firstField], firstField);
  const second = normalizeRawMetric(value[secondField], secondField);
  return {
    normalized: { [firstField]: first.normalized, [secondField]: second.normalized },
    raw: { [firstField]: first.raw, [secondField]: second.raw },
  };
}

function normalizeRawMetric(value, field) {
  if (value === undefined) throw qcError("MISSING_FIELD", `${field} is missing from loudnorm report`);
  if (typeof value !== "string") throw qcError("INVALID_VALUE", `${field} is not a raw string`);
  if (value === "-inf") return { raw: value, normalized: "-inf" };
  if (!STRICT_FINITE_DECIMAL.test(value)) throw qcError("INVALID_VALUE", `${field} is not a finite decimal or -inf`);
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw qcError("INVALID_VALUE", `${field} is not finite or -inf`);
  return { raw: value, normalized };
}

function qcError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function boundedMessage(value) {
  return String(value).replace(/[\r\n]+/gu, " ").slice(0, 240);
}
