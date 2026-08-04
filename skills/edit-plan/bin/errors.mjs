import { canonicalJson } from "./canonical-json.mjs";

const DEFINITIONS = Object.freeze({
  USAGE_ERROR: ["USAGE", 2, "Command arguments do not match the cut candidate contract."],
  PROJECT_CONTRACT_INVALID: ["PROJECT_CONTRACT", 2, "The project does not satisfy the AKARI project contract."],
  KEEP_PLAN_INVALID: ["SCHEMA_VALIDATION", 2, "The semantic keep plan is invalid."],
  DECISION_LOG_INVALID: ["PROJECT_CONTRACT", 2, "The decision log input is invalid."],
  APPROVAL_REF_INVALID: ["PROJECT_CONTRACT", 2, "The approval reference is invalid."],
  ANALYSIS_MISSING: ["SEMANTIC_VALIDATION", 2, "A required source analysis is missing."],
  ANALYSIS_AMBIGUOUS: ["SEMANTIC_VALIDATION", 2, "More than one source analysis matches the active source."],
  ANALYSIS_SCHEMA_INVALID: ["SCHEMA_VALIDATION", 2, "A source analysis fails schema validation."],
  ANALYSIS_SEMANTIC_INVALID: ["SEMANTIC_VALIDATION", 2, "A source analysis fails semantic validation."],
  KEYFRAME_METADATA_AMBIGUOUS: ["SEMANTIC_VALIDATION", 2, "Keyframe evidence metadata is ambiguous."],
  PATH_ESCAPE: ["INPUT_INTEGRITY", 3, "A path escapes its declared containment boundary."],
  SYMLINK_REJECTED: ["INPUT_INTEGRITY", 3, "A symbolic link is not allowed at this boundary."],
  NON_REGULAR_FILE: ["INPUT_INTEGRITY", 3, "A required input is not a regular file."],
  INPUT_HASH_DRIFT: ["INPUT_INTEGRITY", 3, "An input identity changed while the report was built."],
  INPUT_BUDGET_EXCEEDED: ["INPUT_INTEGRITY", 3, "An input or memory budget was exceeded."],
  TOOL_BINARY_INVALID: ["TOOL_IDENTITY", 3, "A required tool binary cannot be strongly identified."],
  TOOL_VERSION_INVALID: ["TOOL_IDENTITY", 3, "A tool version receipt is invalid."],
  TOOL_IDENTITY_DRIFT: ["TOOL_IDENTITY", 3, "A tool or module identity changed during execution."],
  MEDIA_CONTAINER_UNSUPPORTED: ["MEDIA_PROBE", 4, "The active source container is not supported."],
  MEDIA_DURATION_INVALID: ["MEDIA_PROBE", 4, "The active source duration is invalid."],
  AUDIO_STREAM_MISSING: ["MEDIA_PROBE", 4, "The active source has no audio stream."],
  MULTIPLE_AUDIO_STREAMS_REQUIRES_SELECTION: ["MEDIA_PROBE", 4, "The active source has multiple audio streams and requires selection."],
  AUDIO_STREAM_DURATION_DIVERGENCE: ["MEDIA_PROBE", 4, "The selected audio duration diverges from the container duration."],
  FFPROBE_FAILED: ["MEDIA_PROBE", 4, "The media probe failed within the closed execution boundary."],
  FFMPEG_FAILED: ["SILENCE_DETECTION", 5, "The silence detector failed within the closed execution boundary."],
  DETECTOR_TIMEOUT: ["SILENCE_DETECTION", 5, "The silence detector exceeded its execution budget."],
  DETECTOR_OUTPUT_LIMIT: ["SILENCE_DETECTION", 5, "The silence detector exceeded its output budget."],
  DETECTOR_PARSE_INVALID: ["SILENCE_DETECTION", 5, "The silence detector output is invalid."],
  REPORT_INVALID: ["REPORT_VALIDATION", 6, "The generated report fails its closed contract."],
  REPORT_SIZE_LIMIT: ["REPORT_VALIDATION", 6, "The canonical report exceeds its size budget."],
  CONTENT_ADDRESS_COLLISION: ["CONTENT_ADDRESS_WRITE", 6, "The content-addressed target contains different bytes."],
  OUTPUT_PATH_UNSAFE: ["CONTENT_ADDRESS_WRITE", 6, "The report output path is not a contained regular directory chain."],
  OUTPUT_WRITE_FAILED: ["CONTENT_ADDRESS_WRITE", 6, "The content-addressed report could not be written safely."],
});

export class CutCandidateError extends Error {
  constructor(code) {
    const definition = DEFINITIONS[code] ?? DEFINITIONS.REPORT_INVALID;
    super(definition[2]);
    this.name = "CutCandidateError";
    this.code = DEFINITIONS[code] ? code : "REPORT_INVALID";
    this.phase = definition[0];
    this.exitCode = definition[1];
  }
}

export function failureBytes(error) {
  const failure = error instanceof CutCandidateError ? error : new CutCandidateError("REPORT_INVALID");
  const payload = {
    version: 1,
    kind: "akari-cut-candidate-error-v1",
    code: failure.code,
    phase: failure.phase,
    message: failure.message,
  };
  return { bytes: Buffer.from(`${canonicalJson(payload)}\n`, "utf8"), exitCode: failure.exitCode };
}

export function assertErrorDefinitions() {
  for (const [code, [phase, exitCode, message]] of Object.entries(DEFINITIONS)) {
    if (!/^[A-Z0-9_]+$/u.test(code) || !/^[A-Z0-9_]+$/u.test(phase)) throw new Error("invalid error table");
    if (![2, 3, 4, 5, 6].includes(exitCode)) throw new Error("invalid error exit");
    const bytes = Buffer.from(message, "utf8");
    if (bytes.length > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(message) || /(?:^|\s)\/(?:[^\s]|$)/u.test(message)) {
      throw new Error("invalid fixed error message");
    }
  }
}

export const ERROR_CODES = Object.freeze(Object.keys(DEFINITIONS));
