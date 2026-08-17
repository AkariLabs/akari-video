import { spawnSync } from "node:child_process";

export const AUDIO_QC_CAPTURE_LIMIT_BYTES = 1024 * 1024;
// akari-audio-qc-decimal-v1: exact finite base-10 text only. Keep this grammar in parity with
// status-core/integrity.mjs because receipts must be interpreted exactly as they were generated.
const STRICT_FINITE_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

// Real AAC re-encode overshoots loudnorm's PCM-stage true peak target (measured +1.2 dB on real
// material; -1.73 dBTP landed from a -2.5 applied target in the same test — planning/
// notes-2026-08-17-mac-fresh-install-bug-reports.md #05). plan.mjs bakes this margin into the
// value it hands loudnorm whenever true_peak_dbtp is explicit (task
// 2026-08-17-render-cut-true-peak-guard 裁定 B); exported so both plan.mjs and this module derive
// the applied target from a single constant instead of duplicating the number.
export const AAC_TRUE_PEAK_OVERSHOOT_MARGIN_DBTP = 1.5;

// decoded_measurement is a second, independent ffmpeg pass (loudnorm re-analysis of the finished
// artifact) — its input_tp is never bit-identical to the configured target even when nothing is
// wrong, so exceeding must clear a small tolerance before it counts as a real overshoot (task
// 2026-08-17-render-cut-true-peak-guard 裁定 A).
export const TRUE_PEAK_EXCEEDED_TOLERANCE_DB = 0.1;

export function hasExplicitTruePeakDbtp(master) {
  return typeof master?.true_peak_dbtp === "number" && Number.isFinite(master.true_peak_dbtp);
}

// Rounded to 2 decimal places (loudnorm's own report precision) so float noise like
// -1.7 - 1.5 = -3.1999999999999997 never leaks into ffmpeg args or the receipt.
export function appliedTruePeakDbtp(configuredTruePeakDbtp) {
  return Math.round((configuredTruePeakDbtp - AAC_TRUE_PEAK_OVERSHOOT_MARGIN_DBTP) * 100) / 100;
}

export function configuredAudioQc(master) {
  return {
    integrated_lufs: typeof master?.loudnorm === "number" && Number.isFinite(master.loudnorm) ? master.loudnorm : -14,
    true_peak_dbtp: hasExplicitTruePeakDbtp(master) ? master.true_peak_dbtp : -1.5,
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
  const measuredTruePeak = decoded.normalized.input_tp;
  const truePeakExceeded = typeof measuredTruePeak === "number"
    && measuredTruePeak > configured.true_peak_dbtp + TRUE_PEAK_EXCEEDED_TOLERANCE_DB;
  return {
    configured,
    filter_report: filterReport,
    decoded_measurement: decoded,
    tool_version: toolVersion,
    // Deliberately stays "INCONCLUSIVE" even when truePeakExceeded is true: status-core/
    // integrity.mjs's validateAudioQc treats any other verdict string as a structural integrity
    // problem (closed-world check on the successful-measurement branch), so a new verdict value
    // would misreport a legitimate receipt as malformed rather than surfacing the overshoot. The
    // overshoot is instead an additive `warnings` entry below — readable from the receipt alone,
    // same as the task's decision-tree fallback requires.
    verdict: "INCONCLUSIVE",
    ...(hasExplicitTruePeakDbtp(master) ? {
      true_peak_margin: {
        overshoot_margin_dbtp: AAC_TRUE_PEAK_OVERSHOOT_MARGIN_DBTP,
        applied_true_peak_dbtp: appliedTruePeakDbtp(configured.true_peak_dbtp),
      },
    } : {}),
    ...(truePeakExceeded ? {
      warnings: [
        `TRUE_PEAK_EXCEEDED: decoded_measurement.normalized.input_tp (${measuredTruePeak}) exceeds ` +
        `configured.true_peak_dbtp (${configured.true_peak_dbtp}) by ${(measuredTruePeak - configured.true_peak_dbtp).toFixed(2)} dB`,
      ],
    } : {}),
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
