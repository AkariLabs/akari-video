#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  lstat,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

const HOST = "127.0.0.1";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function failUsage(message) {
  if (message) {
    console.error(message);
  }
  console.error(
    "Usage: node packages/decision-cards/report-helper.mjs <report.html> [--port N]",
  );
  process.exitCode = 1;
}

function parseArguments(argv) {
  let reportArgument = null;
  let port = 0;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--port") {
      if (index + 1 >= argv.length) {
        throw new Error("--port requires a value");
      }
      port = parsePort(argv[index + 1]);
      index += 1;
      continue;
    }

    if (argument.startsWith("--port=")) {
      port = parsePort(argument.slice("--port=".length));
      continue;
    }

    if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    }

    if (reportArgument !== null) {
      throw new Error("Only one report path may be provided");
    }
    reportArgument = argument;
  }

  if (reportArgument === null) {
    throw new Error("A report path is required");
  }

  return { reportArgument, port };
}

function parsePort(value) {
  if (!/^\d+$/.test(value)) {
    throw new Error("Port must be an integer from 0 through 65535");
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error("Port must be an integer from 0 through 65535");
  }
  return port;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateState(value) {
  if (!isRecord(value)) {
    return "body must be a JSON object";
  }
  if (typeof value.version !== "number") {
    return "version must be a number";
  }
  if (typeof value.report !== "string") {
    return "report must be a string";
  }
  if (!Array.isArray(value.decisions)) {
    return "decisions must be an array";
  }

  for (let index = 0; index < value.decisions.length; index += 1) {
    const decision = value.decisions[index];
    const prefix = `decisions[${index}]`;
    if (!isRecord(decision)) {
      return `${prefix} must be an object`;
    }
    if (!hasOwn(decision, "id") || typeof decision.id !== "string") {
      return `${prefix}.id must be a string`;
    }
    if (
      !hasOwn(decision, "answer") ||
      (decision.answer !== null && !isRecord(decision.answer))
    ) {
      return `${prefix}.answer must be an object or null`;
    }
    if (
      !hasOwn(decision, "byDefault") ||
      typeof decision.byDefault !== "boolean"
    ) {
      return `${prefix}.byDefault must be a boolean`;
    }
    if (
      !hasOwn(decision, "answeredAt") ||
      (decision.answeredAt !== null && typeof decision.answeredAt !== "string")
    ) {
      return `${prefix}.answeredAt must be a string or null`;
    }
  }

  return null;
}

function sendText(
  response,
  status,
  message,
  contentType = "text/plain; charset=utf-8",
) {
  const body = `${String(message).replace(/[\r\n]+/g, " ")}\n`;
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function sendJson(response, status, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function contentTypeFor(filePath) {
  const extension = extname(filePath).toLowerCase();
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".gif": "image/gif",
      ".htm": "text/html; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".ico": "image/x-icon",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".m4a": "audio/mp4",
      ".mjs": "text/javascript; charset=utf-8",
      ".mov": "video/quicktime",
      ".mp3": "audio/mpeg",
      ".mp4": "video/mp4",
      ".ogg": "audio/ogg",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".txt": "text/plain; charset=utf-8",
      ".wav": "audio/wav",
      ".webm": "video/webm",
      ".webp": "image/webp",
    }[extension] ?? "application/octet-stream"
  );
}

function isInside(basePath, candidatePath) {
  const difference = relative(basePath, candidatePath);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
}

function decodeRequestPath(rawPath) {
  let decoded = rawPath;

  for (let pass = 0; pass < 4; pass += 1) {
    if (decoded.includes("..")) {
      throw new HttpError(403, "path traversal is forbidden");
    }

    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new HttpError(400, "invalid URL encoding");
    }

    if (next === decoded) {
      break;
    }
    decoded = next;
  }

  if (decoded.includes("..")) {
    throw new HttpError(403, "path traversal is forbidden");
  }
  if (decoded.includes("\0")) {
    throw new HttpError(400, "invalid path");
  }

  return decoded.replaceAll("\\", "/");
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "body must be valid JSON");
  }
}

let parsedArguments;
try {
  parsedArguments = parseArguments(process.argv.slice(2));
} catch (error) {
  failUsage(error.message);
  process.exit();
}

const reportPath = resolve(parsedArguments.reportArgument);
const reportDirectory = dirname(reportPath);
const statePath = `${reportPath}.decisions.json`;

try {
  const reportStats = await stat(reportPath);
  if (!reportStats.isFile()) {
    throw new Error("Report path is not a file");
  }
  await access(reportPath);
} catch (error) {
  console.error(`Unable to read report: ${error.message}`);
  process.exit(1);
}

const realReportDirectory = await realpath(reportDirectory);

async function assertSafeStateTarget() {
  if (!isInside(reportDirectory, statePath)) {
    throw new HttpError(403, "state path is outside the report directory");
  }

  try {
    const stateStats = await lstat(statePath);
    if (stateStats.isSymbolicLink()) {
      throw new HttpError(403, "state path must not be a symbolic link");
    }
    if (!stateStats.isFile()) {
      throw new HttpError(403, "state path must be a regular file");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function loadState({ required }) {
  await assertSafeStateTarget();

  let source;
  try {
    source = await readFile(statePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      if (required) {
        throw new HttpError(404, "decisions file not found");
      }
      return null;
    }
    throw error;
  }

  try {
    return JSON.parse(source);
  } catch {
    throw new HttpError(500, "decisions file is not valid JSON");
  }
}

async function writeState(state) {
  await assertSafeStateTarget();
  const temporaryPath = resolve(
    reportDirectory,
    `.${basename(statePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  if (!isInside(reportDirectory, temporaryPath)) {
    throw new HttpError(
      403,
      "temporary state path is outside the report directory",
    );
  }

  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, statePath);
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

const SINGLE_RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

// 単一バイトレンジだけを解釈する。複数レンジ・未知の単位・壊れた指定は null を返し、
// 呼び出し側は 200 全体配信へフォールバックする（RFC 9110 が許す挙動）。
// レンジが範囲外のときだけ { unsatisfiable: true } を返して 416 にする。
function parseRange(rangeHeader, size) {
  if (typeof rangeHeader !== "string") {
    return null;
  }

  const match = SINGLE_RANGE_PATTERN.exec(rangeHeader.trim());
  if (match === null) {
    return null;
  }

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") {
    return null;
  }

  let start;
  let end;

  if (rawStart === "") {
    // bytes=-N — 末尾 N バイト
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      return null;
    }
    if (end > size - 1) {
      end = size - 1;
    }
  }

  if (start >= size || start > end) {
    return { unsatisfiable: true };
  }

  return { start, end };
}

// iOS Safari は <video> に対してまず `Range: bytes=0-1` を投げ、206 が返らないと再生を諦める。
// レンジ対応は動画・音声をレポート内で再生させるための必須要件。
async function serveFile(response, filePath, contentType, rangeHeader) {
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      throw new HttpError(404, "file not found");
    }
    throw error;
  }

  if (!fileStats.isFile()) {
    throw new HttpError(404, "file not found");
  }

  const baseHeaders = {
    "Content-Type": contentType ?? contentTypeFor(filePath),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };

  if (fileStats.size === 0) {
    response.writeHead(200, { ...baseHeaders, "Content-Length": 0 });
    response.end();
    return;
  }

  const range = parseRange(rangeHeader, fileStats.size);

  if (range !== null && range.unsatisfiable === true) {
    response.writeHead(416, {
      ...baseHeaders,
      "Content-Length": 0,
      "Content-Range": `bytes */${fileStats.size}`,
    });
    response.end();
    return;
  }

  const start = range === null ? 0 : range.start;
  const end = range === null ? fileStats.size - 1 : range.end;

  response.writeHead(range === null ? 200 : 206, {
    ...baseHeaders,
    "Content-Length": end - start + 1,
    ...(range === null
      ? {}
      : { "Content-Range": `bytes ${start}-${end}/${fileStats.size}` }),
  });

  await new Promise((resolveStream, rejectStream) => {
    const stream = createReadStream(filePath, { start, end });
    stream.on("error", rejectStream);
    stream.on("end", resolveStream);
    stream.pipe(response);
  });
}

async function resolveStaticPath(rawPath) {
  const decodedPath = decodeRequestPath(rawPath);
  const relativePath = decodedPath.replace(/^\/+/, "");
  const candidatePath = resolve(reportDirectory, relativePath);

  if (!isInside(reportDirectory, candidatePath)) {
    throw new HttpError(403, "path is outside the report directory");
  }

  let realCandidate;
  try {
    realCandidate = await realpath(candidatePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      throw new HttpError(404, "file not found");
    }
    throw error;
  }

  if (!isInside(realReportDirectory, realCandidate)) {
    throw new HttpError(403, "path is outside the report directory");
  }
  return realCandidate;
}

let mutationQueue = Promise.resolve();
function mutate(operation) {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.catch(() => {});
  return result;
}

const server = createServer(async (request, response) => {
  const rawPath = (request.url ?? "/").split("?", 1)[0];

  try {
    if (request.method === "GET" && rawPath === "/") {
      await serveFile(
        response,
        reportPath,
        "text/html; charset=utf-8",
        request.headers.range,
      );
      return;
    }

    if (request.method === "GET" && rawPath === "/api/state") {
      const state = await loadState({ required: true });
      sendJson(response, 200, state);
      return;
    }

    if (request.method === "POST" && rawPath === "/api/state") {
      const body = parseJsonBody(await readRequestBody(request));
      const validationError = validateState(body);
      if (validationError !== null) {
        throw new HttpError(400, validationError);
      }

      const savedState = await mutate(async () => {
        const existingState = await loadState({ required: false });
        const state = JSON.parse(JSON.stringify(body));
        state.createdAt =
          existingState !== null && hasOwn(existingState, "createdAt")
            ? existingState.createdAt
            : new Date().toISOString();
        state.completedAt =
          existingState !== null && hasOwn(existingState, "completedAt")
            ? existingState.completedAt
            : null;
        await writeState(state);
        return state;
      });

      sendJson(response, 200, savedState);
      return;
    }

    if (request.method === "POST" && rawPath === "/api/commit") {
      const savedState = await mutate(async () => {
        const state = await loadState({ required: true });
        if (!isRecord(state)) {
          throw new HttpError(500, "decisions file must contain a JSON object");
        }
        if (hasOwn(state, "completedAt") && state.completedAt !== null) {
          throw new HttpError(409, "decisions have already been committed");
        }
        state.completedAt = new Date().toISOString();
        await writeState(state);
        return state;
      });

      sendJson(response, 200, savedState);
      return;
    }

    if (request.method === "GET") {
      const staticPath = await resolveStaticPath(rawPath);
      await serveFile(response, staticPath, undefined, request.headers.range);
      return;
    }

    throw new HttpError(404, "route not found");
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }

    if (error instanceof HttpError) {
      sendText(response, error.status, error.message);
      return;
    }

    console.error(error);
    sendText(response, 500, "internal server error");
  }
});

server.on("clientError", (_error, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

try {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(parsedArguments.port, HOST, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
} catch (error) {
  console.error(`Unable to start helper: ${error.message}`);
  process.exit(1);
}

const address = server.address();
console.log(`HELPER: http://localhost:${address.port}/`);
