import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, open, realpath, unlink, link } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { CutCandidateError } from "./errors.mjs";
import { canonicalBytesBounded, codePointCompare, sha256 } from "./canonical-json.mjs";

const CHILD_ENV = Object.freeze({ LC_ALL: "C", LANG: "C", AV_LOG_FORCE_NOCOLOR: "1" });
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

function fail(code) {
  throw new CutCandidateError(code);
}

function identity(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function snapshotPathChain(root, absolute, errorCode, resourceGuard) {
  if (!contained(root, absolute)) fail("PATH_ESCAPE");
  const directories = [];
  const relativeParent = path.relative(root, path.dirname(absolute));
  let resolvedRoot;
  try {
    const rootStat = await lstat(root, { bigint: true });
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail(errorCode);
    resolvedRoot = await realpath(root);
  } catch (error) {
    if (error instanceof CutCandidateError) throw error;
    fail(errorCode);
  }
  let cursor = root;
  for (const component of ["", ...relativeParent.split(path.sep).filter(Boolean)]) {
    resourceGuard();
    if (component) cursor = path.join(cursor, component);
    let stat;
    try {
      stat = await lstat(cursor, { bigint: true });
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail(errorCode);
      const resolved = await realpath(cursor);
      const expectedResolved = path.resolve(resolvedRoot, path.relative(root, cursor));
      if (resolved !== expectedResolved) fail(errorCode);
    } catch (error) {
      if (error instanceof CutCandidateError) throw error;
      fail(errorCode);
    }
    directories.push({ absolute: cursor, identity: directoryIdentity(stat) });
  }
  return directories;
}

function samePathChain(left, right) {
  return left.length === right.length
    && left.every((entry, index) => entry.absolute === right[index].absolute
      && entry.identity === right[index].identity);
}

export function normalizeProjectRelative(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")
    || value.includes("\0") || path.isAbsolute(value) || /^[a-z][a-z0-9+.-]*:/iu.test(value)) fail("PATH_ESCAPE");
  const normalized = path.posix.normalize(value);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) fail("PATH_ESCAPE");
  return normalized;
}

async function rejectSymlinkChain(root, absolute, expectedType) {
  if (!contained(root, absolute)) fail("PATH_ESCAPE");
  const relative = path.relative(root, absolute);
  let cursor = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let stat;
    try {
      stat = await lstat(cursor, { bigint: true });
    } catch {
      fail("NON_REGULAR_FILE");
    }
    if (stat.isSymbolicLink()) fail("SYMLINK_REJECTED");
  }
  const finalStat = await lstat(absolute, { bigint: true });
  if (expectedType === "file" && !finalStat.isFile()) fail("NON_REGULAR_FILE");
  if (expectedType === "directory" && !finalStat.isDirectory()) fail("PROJECT_CONTRACT_INVALID");
  const resolved = await realpath(absolute);
  if (!contained(root, resolved) || resolved !== absolute) fail("PATH_ESCAPE");
  return finalStat;
}

export async function resolveProject(projectArgument) {
  if (typeof projectArgument !== "string" || projectArgument.length === 0) fail("PROJECT_CONTRACT_INVALID");
  let root;
  try {
    root = await realpath(path.resolve(projectArgument));
    const stat = await lstat(root, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("PROJECT_CONTRACT_INVALID");
  } catch (error) {
    if (error instanceof CutCandidateError) throw error;
    fail("PROJECT_CONTRACT_INVALID");
  }
  try {
    await rejectSymlinkChain(root, path.join(root, ".akari"), "directory");
    await rejectSymlinkChain(root, path.join(root, ".akari", "connections.json"), "file");
  } catch {
    fail("PROJECT_CONTRACT_INVALID");
  }
  return root;
}

export async function resolveProjectFile(root, relativePath) {
  const relative = normalizeProjectRelative(relativePath);
  const absolute = path.resolve(root, relative);
  await rejectSymlinkChain(root, absolute, "file");
  return { absolute, relative: path.relative(root, absolute).split(path.sep).join("/") };
}

export async function resolveAnalysisRelativeFile(root, analysisDirectory, relativeValue) {
  if (typeof relativeValue !== "string" || relativeValue.length === 0 || relativeValue.includes("\\")
    || relativeValue.includes("\0") || path.isAbsolute(relativeValue)
    || /^[a-z][a-z0-9+.-]*:/iu.test(relativeValue)) fail("PATH_ESCAPE");
  const absolute = path.resolve(analysisDirectory, relativeValue);
  if (!contained(root, absolute)) fail("PATH_ESCAPE");
  await rejectSymlinkChain(root, absolute, "file");
  return { absolute, relative: path.relative(root, absolute).split(path.sep).join("/") };
}

async function readHandle(handle, sizeLimit, includeBytes, resourceGuard) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const chunks = includeBytes ? [] : null;
  let position = 0;
  while (true) {
    resourceGuard();
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    position += bytesRead;
    if (position > sizeLimit) fail("INPUT_BUDGET_EXCEEDED");
    const chunk = buffer.subarray(0, bytesRead);
    hash.update(chunk);
    if (chunks) chunks.push(Buffer.from(chunk));
    resourceGuard();
  }
  return {
    bytes: chunks ? Buffer.concat(chunks, position) : undefined,
    digest: hash.digest("hex"),
  };
}

export async function snapshotFile(
  file,
  maxBytes,
  includeBytes = false,
  errorCode = "INPUT_HASH_DRIFT",
  resourceGuard = () => {},
  containmentRoot = path.dirname(file.absolute),
) {
  let handle;
  try {
    resourceGuard();
    const pathChainBefore = await snapshotPathChain(containmentRoot, file.absolute, errorCode, resourceGuard);
    handle = await open(file.absolute, fsConstants.O_RDONLY | O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) fail("NON_REGULAR_FILE");
    if (before.size > BigInt(maxBytes)) fail("INPUT_BUDGET_EXCEEDED");
    const read = await readHandle(handle, maxBytes, includeBytes, resourceGuard);
    const after = await handle.stat({ bigint: true });
    if (identity(before) !== identity(after)) fail(errorCode);
    const pathChainAfter = await snapshotPathChain(containmentRoot, file.absolute, errorCode, resourceGuard);
    if (!samePathChain(pathChainBefore, pathChainAfter)) fail(errorCode);
    return {
      absolute: file.absolute,
      relative: file.relative,
      bytes: Number(after.size),
      sha256: read.digest,
      identity: identity(after),
      data: read.bytes,
      errorCode,
      containmentRoot,
      pathChain: pathChainAfter,
    };
  } catch (error) {
    if (error instanceof CutCandidateError) throw error;
    if (error?.code === "ELOOP") fail("SYMLINK_REJECTED");
    fail(errorCode);
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function verifySnapshot(snapshot, overrideCode, resourceGuard = () => {}) {
  const code = overrideCode ?? snapshot.errorCode ?? "INPUT_HASH_DRIFT";
  const file = { absolute: snapshot.absolute, relative: snapshot.relative };
  let stat;
  try { stat = await lstat(snapshot.absolute, { bigint: true }); }
  catch { fail(code); }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== BigInt(snapshot.bytes)) fail(code);
  const current = await snapshotFile(
    file, snapshot.bytes, false, code, resourceGuard,
    snapshot.containmentRoot ?? path.parse(snapshot.absolute).root,
  );
  if (current.identity !== snapshot.identity || current.bytes !== snapshot.bytes || current.sha256 !== snapshot.sha256
    || (snapshot.pathChain && !samePathChain(current.pathChain, snapshot.pathChain))) fail(code);
}

export function decodeUtf8(buffer, code = "INPUT_HASH_DRIFT") {
  try {
    return STRICT_UTF8.decode(buffer);
  } catch {
    fail(code);
  }
}

export function parseJsonSnapshot(snapshot, invalidCode) {
  try {
    return JSON.parse(decodeUtf8(snapshot.data, invalidCode));
  } catch (error) {
    if (error instanceof CutCandidateError) throw error;
    fail(invalidCode);
  }
}

export async function discoverAnalysisCandidates(root, sourceRelative) {
  const sourceDir = path.posix.dirname(sourceRelative);
  const sidecarParentRelative = path.posix.join(".akari/sidecars", sourceDir === "." ? "" : sourceDir);
  const parentAbsolute = path.resolve(root, sidecarParentRelative);
  if (!contained(root, parentAbsolute)) fail("PATH_ESCAPE");
  let entries;
  try {
    await rejectSymlinkChain(root, parentAbsolute, "directory");
    const { readdir } = await import("node:fs/promises");
    entries = await readdir(parentAbsolute, { withFileTypes: true });
  } catch (error) {
    if (error instanceof CutCandidateError && error.code === "SYMLINK_REJECTED") throw error;
    return [];
  }
  const results = [];
  const sourceName = path.posix.basename(sourceRelative);
  const parsedSource = path.posix.parse(sourceName);
  const collisionName = `${parsedSource.name}-${parsedSource.ext.replace(/^\./u, "")}`;
  for (const entry of entries.sort((a, b) => codePointCompare(a.name, b.name))) {
    if (!entry.name.endsWith(".analysis")) continue;
    const stem = entry.name.slice(0, -".analysis".length);
    if (!(stem === sourceName || stem.startsWith(`${sourceName}-`)
      || stem === collisionName || stem.startsWith(`${collisionName}-`))) continue;
    if (entry.isSymbolicLink()) fail("SYMLINK_REJECTED");
    if (!entry.isDirectory()) continue;
    const absolute = path.join(parentAbsolute, entry.name, "analysis.json");
    try {
      await rejectSymlinkChain(root, absolute, "file");
      results.push({ absolute, relative: path.relative(root, absolute).split(path.sep).join("/") });
    } catch (error) {
      if (error instanceof CutCandidateError && error.code === "SYMLINK_REJECTED") throw error;
    }
  }
  return results;
}

async function executableCandidate(name, explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  else for (const directory of String(process.env.PATH ?? "").split(path.delimiter)) {
    if (directory) candidates.push(path.join(directory, name));
  }
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      const resolved = await realpath(candidate);
      const stat = await lstat(resolved, { bigint: true });
      if (stat.isFile() && !stat.isSymbolicLink()) return resolved;
    } catch {}
  }
  fail("TOOL_BINARY_INVALID");
}

function childErrorCode(kind, reason) {
  if (reason === "global_deadline") return "INPUT_BUDGET_EXCEEDED";
  if (kind === "version") return "TOOL_VERSION_INVALID";
  if (kind === "probe") return "FFPROBE_FAILED";
  if (reason === "timeout") return "DETECTOR_TIMEOUT";
  if (reason === "limit") return "DETECTOR_OUTPUT_LIMIT";
  return "FFMPEG_FAILED";
}

export async function runChild(binary, argv, {
  kind, timeoutMs, stdoutLimit, stderrLimit, deadlineAt = Number.POSITIVE_INFINITY,
  stderrConsumer = null,
}) {
  const remainingGlobalMs = deadlineAt - Date.now();
  if (!(remainingGlobalMs > 0)) fail("INPUT_BUDGET_EXCEEDED");
  const effectiveTimeoutMs = Math.min(timeoutMs, remainingGlobalMs);
  const deadlineLimited = Number.isFinite(deadlineAt) && remainingGlobalMs <= timeoutMs;
  return new Promise((resolve, reject) => {
    let stdoutLength = 0;
    let stderrLength = 0;
    const stdout = [];
    const stderr = [];
    let stderrTail = Buffer.alloc(0);
    let consumerError = null;
    let settled = false;
    let reason = null;
    let timer;
    const child = spawn(binary, argv, { env: CHILD_ENV, stdio: ["ignore", "pipe", "pipe"], shell: false });
    const failure = (code, original = null) => {
      const error = original instanceof CutCandidateError ? original : new CutCandidateError(code);
      Object.defineProperty(error, "stderrTail", { value: stderrTail, enumerable: false });
      return error;
    };
    const stop = (why) => {
      if (reason) return;
      reason = why;
      child.kill("SIGTERM");
      setTimeout(() => { if (!settled) child.kill("SIGKILL"); }, 2_000).unref();
    };
    timer = setTimeout(() => stop(deadlineLimited ? "global_deadline" : "timeout"), effectiveTimeoutMs);
    child.stdout.on("data", (chunk) => {
      stdoutLength += chunk.length;
      if (stdoutLength > stdoutLimit) stop("limit");
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrLength += chunk.length;
      if (stderrLength > stderrLimit) stop("limit");
      else if (stderrConsumer && !reason) {
        try { stderrConsumer(chunk); }
        catch (error) {
          consumerError = error instanceof CutCandidateError ? error : new CutCandidateError("DETECTOR_PARSE_INVALID");
          stop("consumer_error");
        }
      } else stderr.push(chunk);
      if (chunk.length >= 65_536) stderrTail = Buffer.from(chunk.subarray(chunk.length - 65_536));
      else if (stderrTail.length + chunk.length <= 65_536) stderrTail = Buffer.concat([stderrTail, chunk]);
      else {
        const combined = Buffer.concat([stderrTail, chunk]);
        stderrTail = Buffer.from(combined.subarray(combined.length - 65_536));
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      settled = true;
      reject(failure(childErrorCode(kind, reason), consumerError));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      settled = true;
      if (consumerError || reason || code !== 0 || signal) reject(failure(childErrorCode(kind, reason), consumerError));
      else resolve({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        stderrBytes: stderrLength,
        stderrTail,
      });
    });
  });
}

function validVersionLine(buffer) {
  const text = decodeUtf8(buffer, "TOOL_VERSION_INVALID");
  const line = text.split(/\r?\n/u).find((value) => value.length > 0);
  if (!line || Buffer.byteLength(line, "utf8") > 512
    || /[\u0000-\u001f\u007f-\u009f]/u.test(line)
    || /(?:^|\s)\/(?:[^\s]|$)/u.test(line)) fail("TOOL_VERSION_INVALID");
  return line;
}

export async function resolveTool(name, explicit, {
  deadlineAt = Number.POSITIVE_INFINITY,
  resourceGuard = () => {},
} = {}) {
  const absolute = await executableCandidate(name, explicit);
  const file = { absolute, relative: absolute };
  const snapshot = await snapshotFile(
    file, Number.MAX_SAFE_INTEGER, false, "TOOL_BINARY_INVALID", resourceGuard, path.parse(absolute).root,
  );
  const versionRun = await runChild(absolute, ["-version"], {
    kind: "version", timeoutMs: 10_000, stdoutLimit: 65_536, stderrLimit: 65_536, deadlineAt,
  });
  return {
    absolute,
    snapshot,
    receipt: { version: validVersionLine(versionRun.stdout), binary_bytes: snapshot.bytes, binary_sha256: snapshot.sha256 },
  };
}

export async function nodeReceipt({ resourceGuard = () => {} } = {}) {
  const absolute = await realpath(process.execPath).catch(() => fail("TOOL_BINARY_INVALID"));
  const snapshot = await snapshotFile(
    { absolute, relative: absolute }, Number.MAX_SAFE_INTEGER, false, "TOOL_BINARY_INVALID", resourceGuard,
    path.parse(absolute).root,
  );
  return {
    snapshot,
    receipt: {
      platform: process.platform,
      arch: process.arch,
      node_version: process.version,
      v8_version: process.versions.v8,
      node_binary_bytes: snapshot.bytes,
      node_binary_sha256: snapshot.sha256,
    },
  };
}

function directoryIdentity(stat) {
  return `${stat.dev}:${stat.ino}`;
}

async function outputDirectoryReceipt(root, directory) {
  const stat = await lstat(directory, { bigint: true }).catch(() => fail("OUTPUT_PATH_UNSAFE"));
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("OUTPUT_PATH_UNSAFE");
  const resolved = await realpath(directory).catch(() => fail("OUTPUT_PATH_UNSAFE"));
  if (!contained(root, resolved) || resolved !== directory) fail("OUTPUT_PATH_UNSAFE");
  return { directory, identity: directoryIdentity(stat) };
}

async function ensureOutputDirectory(root, resourceGuard) {
  let cursor = root;
  const ancestors = [await outputDirectoryReceipt(root, root)];
  for (const component of [".akari", "reports", "cut-candidates"]) {
    resourceGuard();
    cursor = path.join(cursor, component);
    try {
      const stat = await lstat(cursor, { bigint: true });
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("OUTPUT_PATH_UNSAFE");
    } catch (error) {
      if (error instanceof CutCandidateError) throw error;
      try { await mkdir(cursor, { mode: 0o700 }); } catch (mkdirError) { if (mkdirError?.code !== "EEXIST") fail("OUTPUT_WRITE_FAILED"); }
      const stat = await lstat(cursor, { bigint: true }).catch(() => fail("OUTPUT_PATH_UNSAFE"));
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("OUTPUT_PATH_UNSAFE");
    }
    ancestors.push(await outputDirectoryReceipt(root, cursor));
  }
  return { directory: cursor, ancestors };
}

async function verifyOutputDirectoryReceipts(root, ancestors, resourceGuard) {
  for (const expected of ancestors) {
    resourceGuard();
    const current = await outputDirectoryReceipt(root, expected.directory);
    if (current.identity !== expected.identity) fail("OUTPUT_PATH_UNSAFE");
  }
}

function assertFinalTargetPathChain(snapshot, ancestors) {
  if (!Array.isArray(snapshot.pathChain) || snapshot.pathChain.length !== ancestors.length) {
    fail("OUTPUT_PATH_UNSAFE");
  }
  for (let index = 0; index < ancestors.length; index += 1) {
    if (snapshot.pathChain[index].absolute !== ancestors[index].directory
      || snapshot.pathChain[index].identity !== ancestors[index].identity) fail("OUTPUT_PATH_UNSAFE");
  }
}

export async function writeContentAddressed(root, reportBytes, {
  resourceGuard = () => {},
  beforePublish = null,
  beforeReuse = null,
  beforeFinalTargetVerify = null,
} = {}) {
  const output = await ensureOutputDirectory(root, resourceGuard);
  const { directory, ancestors } = output;
  const digest = sha256(reportBytes);
  const target = path.join(directory, `${digest}.json`);
  const temporary = path.join(directory, `.${digest}.${randomBytes(12).toString("hex")}.tmp`);
  let handle;
  let temporaryCreated = false;
  const verifyTargetContent = async () => {
    const existing = await lstat(target, { bigint: true });
    if (existing.isSymbolicLink() || !existing.isFile() || existing.size !== BigInt(reportBytes.length)) {
      fail("CONTENT_ADDRESS_COLLISION");
    }
    const snapshot = await snapshotFile(
      { absolute: target, relative: path.relative(root, target) },
      reportBytes.length, true, "CONTENT_ADDRESS_COLLISION", resourceGuard, root,
    );
    if (!snapshot.data.equals(reportBytes)) fail("CONTENT_ADDRESS_COLLISION");
    return snapshot;
  };
  try {
    const existingSnapshot = await verifyTargetContent();
    if (beforeReuse) await beforeReuse({ directory, target });
    await verifyOutputDirectoryReceipts(root, ancestors, resourceGuard);
    if (beforeFinalTargetVerify) await beforeFinalTargetVerify({ directory, target });
    const finalSnapshot = await verifyTargetContent();
    assertFinalTargetPathChain(finalSnapshot, ancestors);
    if (finalSnapshot.identity !== existingSnapshot.identity
      || finalSnapshot.sha256 !== existingSnapshot.sha256) fail("CONTENT_ADDRESS_COLLISION");
    return target;
  } catch (error) {
    if (error instanceof CutCandidateError) throw error;
    if (error?.code !== "ENOENT") fail("OUTPUT_PATH_UNSAFE");
  }
  try {
    handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | O_NOFOLLOW, 0o600);
    temporaryCreated = true;
    await handle.writeFile(reportBytes);
    await handle.sync();
    await handle.close();
    handle = null;
    if (beforePublish) await beforePublish({ directory, target, temporary });
    await verifyOutputDirectoryReceipts(root, ancestors, resourceGuard);
    try { await link(temporary, target); }
    catch (error) {
      if (error?.code !== "EEXIST") fail("OUTPUT_WRITE_FAILED");
    }
    await unlink(temporary);
    temporaryCreated = false;
    const targetResolved = await realpath(target).catch(() => fail("OUTPUT_PATH_UNSAFE"));
    if (!contained(root, targetResolved) || path.dirname(targetResolved) !== directory) fail("OUTPUT_PATH_UNSAFE");
    await verifyOutputDirectoryReceipts(root, ancestors, resourceGuard);
    if (beforeFinalTargetVerify) await beforeFinalTargetVerify({ directory, target });
    const finalSnapshot = await verifyTargetContent();
    assertFinalTargetPathChain(finalSnapshot, ancestors);
    return target;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (temporaryCreated) await unlink(temporary).catch(() => {});
    if (error instanceof CutCandidateError) throw error;
    fail("OUTPUT_WRITE_FAILED");
  }
}

export function detectorArgv(sourceAbsolute, audioIndex, policy) {
  return [
    "-nostdin", "-hide_banner", "-nostats", "-loglevel", "info",
    "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm",
    "-i", sourceAbsolute, "-map", `0:${audioIndex}`, "-vn", "-sn", "-dn",
    "-af", `silencedetect=noise=${policy.silence_detection_db}dB:d=${policy.minimum_silence_seconds}`,
    "-f", "null", "-",
  ];
}

export function detectorArgvTemplate(policy) {
  return detectorArgv("<SOURCE>", "<AUDIO_STREAM_INDEX>", policy);
}

export function probeArgv(sourceAbsolute) {
  return [
    "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm",
    "-show_entries", "stream=index,codec_type,duration:format=duration,format_name", "-of", "json", sourceAbsolute,
  ];
}

export function reportBytes(report) {
  try {
    return canonicalBytesBounded(report, 64 * 1024 * 1024);
  } catch (error) {
    if (error instanceof RangeError) fail("REPORT_SIZE_LIMIT");
    throw error;
  }
}

export { CHILD_ENV };
