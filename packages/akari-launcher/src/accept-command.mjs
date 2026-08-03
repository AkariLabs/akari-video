import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { inspectFullIntegrity } from "./status-core/integrity.mjs";
import { resolveFullProjectStatus } from "./status-core/status.mjs";

export async function runAcceptCommand(argv, options = {}) {
  const log = options.log ?? ((line) => process.stdout.write(line));
  const error = options.error ?? ((line) => process.stderr.write(`${line}\n`));
  let parsed;
  try {
    parsed = parseAcceptArguments(argv, options.cwd ?? process.cwd());
  } catch (cause) {
    error(messageOf(cause));
    return { exitCode: 2 };
  }

  const isTTY = options.isTTY ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
  if (!isTTY) {
    error("akari accept requires an interactive input and output TTY; pipes, flags, and environment confirmation are not accepted");
    return { exitCode: 2 };
  }

  const status = await resolveFullProjectStatus(parsed.projectRoot);
  if (status.release.accepted) {
    error("the current verified artifact already has an active human acceptance record");
    return { exitCode: 1, status };
  }
  if (status.workflow_stage !== "acceptance_pending" || status.state_health !== "valid") {
    error(`the project is not ready for human acceptance: ${status.workflow_stage} (${status.state_health})`);
    return { exitCode: 1, status };
  }

  const before = await inspectFullIntegrity(parsed.projectRoot);
  if (!before.ok || !before.candidate || before.activeAcceptance) {
    error(`the verified artifact cannot be accepted: ${before.problems.join("; ") || "no current acceptance candidate"}`);
    return { exitCode: 1, status };
  }
  const candidate = before.candidate;
  const phrase = `ACCEPT ${candidate.artifact_sha256}`;
  log(`Artifact: ${candidate.artifact}\nArtifact SHA-256: ${candidate.artifact_sha256}\nReceipt: ${candidate.receipt}\nReceipt SHA-256: ${candidate.receipt_sha256}\n`);
  if (candidate.audio_qc?.verdict === "INCONCLUSIVE") {
    log(`WARNING: audio_qc is INCONCLUSIVE; this is not an audio conformance PASS.\nConfigured: ${JSON.stringify(candidate.audio_qc.configured)}\nFilter report: ${JSON.stringify(candidate.audio_qc.filter_report)}\nDecoded artifact measurement: ${JSON.stringify(candidate.audio_qc.decoded_measurement)}\n`);
  }

  const prompt = options.prompt ?? promptFromTTY;
  let actorId;
  let acceptanceStatement;
  let checksumConfirmation;
  try {
    actorId = (await prompt("Human identity for this cooperative local record: ")).trim();
    if (actorId === "") throw new Error("human identity must not be empty");
    acceptanceStatement = await prompt("Your final acceptance statement for this artifact: ");
    if (acceptanceStatement.trim() === "") throw new Error("final acceptance statement must not be empty");
    checksumConfirmation = await prompt(`Type exactly “${phrase}” to confirm this artifact checksum: `);
  } catch (cause) {
    error(`acceptance was not recorded: ${messageOf(cause)}`);
    return { exitCode: 1, status };
  }
  if (checksumConfirmation !== phrase) {
    error("artifact checksum confirmation did not match exactly; nothing was recorded");
    return { exitCode: 1, status };
  }

  const after = await inspectFullIntegrity(parsed.projectRoot);
  if (!after.ok || !after.candidate || after.activeAcceptance || !sameCandidate(candidate, after.candidate)) {
    error("project integrity or acceptance state changed during confirmation; nothing was recorded");
    return { exitCode: 1, status };
  }

  try {
    const written = await writeAcceptanceEvent({
      projectRoot: parsed.projectRoot,
      actorId,
      verbatim: acceptanceStatement,
      candidate,
      now: options.now,
      id: options.id,
    });
    log(`Recorded cooperative local acceptance event ${written.event.id} at ${written.path}. This record is not a cryptographic human-identity proof.\n`);
    return { exitCode: 0, event: written.event, path: written.path };
  } catch (cause) {
    error(`acceptance was not recorded: ${messageOf(cause)}`);
    return { exitCode: 1, status };
  }
}

export function parseAcceptArguments(argv, cwd = process.cwd()) {
  let projectRoot = cwd;
  let pathSeen = false;
  for (const argument of argv) {
    if (argument.startsWith("-")) throw new Error(`Unknown accept option: ${argument}`);
    if (pathSeen) throw new Error("accept accepts only one project path");
    projectRoot = argument;
    pathSeen = true;
  }
  return { projectRoot };
}

export async function writeAcceptanceEvent({ projectRoot, actorId, verbatim, candidate, now, id }) {
  const root = realpathSync(resolve(projectRoot));
  if (typeof actorId !== "string" || actorId.trim() === "") throw new Error("human actor identity is required");
  if (typeof verbatim !== "string" || verbatim.trim() === "") throw new Error("verbatim confirmation is required");
  assertCandidate(candidate);
  const eventId = id ?? randomUUID();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(eventId)) throw new Error("event id contains unsafe characters");
  const occurredAt = now instanceof Date ? now.toISOString() : typeof now === "string" ? now : new Date().toISOString();
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/u.test(occurredAt) || !Number.isFinite(Date.parse(occurredAt))) {
    throw new Error("acceptance timestamp must include an explicit UTC offset");
  }
  const event = {
    version: 1,
    id: eventId,
    type: "final-acceptance",
    occurredAt,
    actor: { kind: "human", id: actorId.trim() },
    issuer: { kind: "akari-cli-tty", version: 1 },
    artifact: candidate.artifact,
    artifact_sha256: candidate.artifact_sha256,
    render_receipt: candidate.receipt,
    render_receipt_sha256: candidate.receipt_sha256,
    review_sha256: candidate.review_sha256,
    verbatim,
  };
  const eventsDirectory = await prepareEventsDirectory(root);
  const compactTime = occurredAt.replace(/[-:.]/gu, "");
  const eventPath = join(eventsDirectory, `${compactTime}-${eventId}-final-acceptance.json`);
  await writeFile(eventPath, `${JSON.stringify(event, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return { event, path: relative(root, eventPath) };
}

async function prepareEventsDirectory(root) {
  const akariDirectory = join(root, ".akari");
  const actualAkari = realpathSync(akariDirectory);
  if (!isWithin(root, actualAkari) || !lstatSync(akariDirectory).isDirectory()) {
    throw new Error(".akari is not a regular project directory");
  }
  const eventsDirectory = join(akariDirectory, "events");
  await mkdir(eventsDirectory, { recursive: true });
  const actualEvents = realpathSync(eventsDirectory);
  if (!isWithin(root, actualEvents) || !lstatSync(eventsDirectory).isDirectory()) {
    throw new Error(".akari/events is not a regular project directory");
  }
  return actualEvents;
}

async function promptFromTTY(question) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}

function sameCandidate(left, right) {
  return left.receipt === right.receipt
    && left.receipt_sha256 === right.receipt_sha256
    && left.artifact === right.artifact
    && left.artifact_sha256 === right.artifact_sha256
    && left.review_sha256 === right.review_sha256;
}

function assertCandidate(value) {
  if (!isSafeRelativePath(value?.artifact) || !isSafeRelativePath(value?.receipt)) throw new Error("acceptance candidate paths are invalid");
  for (const key of ["artifact_sha256", "receipt_sha256", "review_sha256"]) {
    if (!/^[a-f0-9]{64}$/u.test(value?.[key] ?? "")) throw new Error(`acceptance candidate ${key} is invalid`);
  }
}

function isSafeRelativePath(value) {
  return typeof value === "string" && value !== "" && !isAbsolute(value) && !value.split(/[\\/]/u).includes("..");
}

function isWithin(root, target) {
  const value = relative(root, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
