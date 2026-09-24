import { spawnSync } from "node:child_process";

export const AUDIO_QC_CAPTURE_LIMIT_BYTES = 1024 * 1024;
// akari-audio-qc-decimal-v1: exact finite base-10 text only. Keep this grammar in parity with
// status-core/integrity.mjs because receipts must be interpreted exactly as they were generated.
const STRICT_FINITE_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

export function parseAudioToolVersion(output) {
  const firstLine = String(output ?? '').split(/\r?\n/u)[0].trim();
  return /^(?:ffmpeg|ffprobe) version\s+\S+(?:\s|$)/u.test(firstLine) ? firstLine : null;
}

export function probeToolVersion(command, args, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl(command, args, { encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (result.error) return { version: null, error: `version probe failed: ${result.error.message}` };
  if (result.status !== 0) return { version: null, error: `version probe exited with status ${result.status}${result.signal ? ` (${result.signal})` : ''}` };
  const output = result.stdout || result.stderr || '';
  const version = parseAudioToolVersion(output);
  return version ? { version, error: null } : {
    version: null,
    error: `version probe returned a non-version first line: ${String(output).split(/\r?\n/u)[0].trim().slice(0, 120) || '(empty)'}`,
  };
}

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
// Keep in parity with status-core/integrity.mjs's self-contained receipt validation.
export const INTEGRATED_LOUDNESS_TOLERANCE_LU = 1.0;

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

export function measurementErrorAudioQc({ master, phase, code, message, filterReport = null, toolVersion, toolVersionError }) {
  return {
    configured: configuredAudioQc(master),
    filter_report: phase === "filter_report" ? null : filterReport,
    decoded_measurement: null,
    tool_version: toolVersion,
    ...(toolVersion ? {} : { tool_version_error: boundedMessage(toolVersionError ?? 'ffmpeg version was unavailable') }),
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
  toolVersionError,
  spawnSyncImpl = spawnSync,
}) {
  const versionError = toolVersion ? undefined : toolVersionError ?? 'ffmpeg version was unavailable';
  const measurementFailure = values => measurementErrorAudioQc({ ...values, master, toolVersion, toolVersionError: versionError });
  let filterReport;
  try {
    filterReport = parseLoudnormReport(filterStderr, "filter_report", "output_i", "output_tp");
  } catch (error) {
    return measurementFailure({ phase: "filter_report", code: error.code, message: error.message });
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
    return measurementFailure({
      phase: "decoded_measurement",
      code: result.error.code === "ENOBUFS" ? "CAPTURE_LIMIT" : "PROCESS_FAILED",
      message: result.error.code === "ENOBUFS" ? "decoded measurement exceeded bounded capture" : `decoded measurement process failed: ${result.error.message}; ${boundedMessage(result.stderr ?? '')}`,
      filterReport,
    });
  }
  if (result.status !== 0) {
    return measurementFailure({ phase: "decoded_measurement", code: "PROCESS_FAILED", message: `decoded measurement process exited unsuccessfully: ${boundedMessage(result.stderr ?? '')}`, filterReport });
  }
  let decoded;
  try {
    const parsed = parseLoudnormReport(result.stderr, "decoded_measurement", "input_i", "input_tp");
    decoded = { metric: "ffmpeg-loudnorm-input-v1", ...parsed };
  } catch (error) {
    return measurementFailure({ phase: "decoded_measurement", code: error.code, message: error.message, filterReport });
  }
  const measuredTruePeak = decoded.normalized.input_tp;
  const truePeakExceeded = typeof measuredTruePeak === "number"
    && measuredTruePeak > configured.true_peak_dbtp + TRUE_PEAK_EXCEEDED_TOLERANCE_DB;
  const loudnessInRange = typeof decoded.normalized.input_i === "number"
    && Math.abs(decoded.normalized.input_i - configured.integrated_lufs) <= INTEGRATED_LOUDNESS_TOLERANCE_LU;
  return {
    configured,
    filter_report: filterReport,
    decoded_measurement: decoded,
    tool_version: toolVersion,
    ...(versionError ? { tool_version_error: boundedMessage(versionError) } : {}),
    verdict: loudnessInRange && typeof measuredTruePeak === "number" && !truePeakExceeded
      && typeof toolVersion === "string" && toolVersion.trim() !== ""
      ? "PASS" : "INCONCLUSIVE",
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
