import { spawnSync } from "node:child_process";
import { closeSync, openSync, readSync, statSync } from "node:fs";

// Upper bound on how much of an audio tool's stderr this process keeps for reporting. It is a
// *retained tail* limit, not a pipe limit: exceeding it is normal for long loudnorm mixes (a
// 177s render emitted ~9,300 timestamp warnings / 1.33MB) and must never fail the measurement.
// The loudnorm JSON report is printed at the very end, so the tail is where it lives.
export const AUDIO_QC_CAPTURE_LIMIT_BYTES = 1024 * 1024;

/** Keep the last `limit` bytes of `text` without splitting a UTF-8 code point in a way that throws. */
export function tailText(text, limit = AUDIO_QC_CAPTURE_LIMIT_BYTES) {
  const value = String(text ?? "");
  if (Buffer.byteLength(value) <= limit) return value;
  return Buffer.from(value).subarray(-limit).toString("utf8");
}

/** Read at most the last `limit` bytes of a file. Returns "" when the file is missing. */
export function readTailText(path, limit = AUDIO_QC_CAPTURE_LIMIT_BYTES) {
  let size;
  try {
    size = statSync(path).size;
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
  if (size <= 0) return "";
  const start = Math.max(0, size - limit);
  const length = size - start;
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    let offset = 0;
    while (offset < length) {
      const read = readSync(fd, buffer, offset, length - offset, start + offset);
      if (read <= 0) break;
      offset += read;
    }
    return buffer.subarray(0, offset).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/**
 * Run a command with stderr redirected to a file and return only the file's tail as `stderr`.
 *
 * `spawnSync`'s `maxBuffer` truncates a pipe at an arbitrary byte count and reports ENOBUFS, which
 * made a merely noisy loudnorm mix look like a measurement failure. Sending stderr straight to a
 * file lets the child write any amount; only the tail is loaded back into memory. `options.stderr`
 * from an injected `spawnSyncImpl` is honored so unit tests can stay synchronous and file-free.
 */
export function runSyncCapturingStderrTail(
  command,
  args,
  {
    cwd,
    env,
    stderrPath,
    limit = AUDIO_QC_CAPTURE_LIMIT_BYTES,
    spawnSyncImpl = spawnSync,
  } = {},
) {
  if (!stderrPath) throw new Error("stderrPath is required");
  const fd = openSync(stderrPath, "w");
  let result;
  try {
    result = spawnSyncImpl(command, args, { cwd, env, stdio: ["ignore", "ignore", fd] });
  } finally {
    closeSync(fd);
  }
  const stderr = typeof result?.stderr === "string"
    ? tailText(result.stderr, limit)
    : readTailText(stderrPath, limit);
  return { ...result, stderr };
}
