import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

const FINAL_EVENT_TYPES = new Set(["final-acceptance", "final-acceptance-revoked"]);

export function readProjectEvents(projectRoot, { gateTypes = [] } = {}) {
  let realRoot;
  try {
    realRoot = realpathSync(resolve(projectRoot));
  } catch (error) {
    return { events: [], problems: [`project root could not be resolved: ${messageOf(error)}`] };
  }
  const eventsDirectory = join(realRoot, ".akari", "events");
  const problems = [];
  let actualEventsDirectory;
  try {
    const info = lstatSync(eventsDirectory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      return { events: [], problems: ["events directory is not a regular project directory"] };
    }
    actualEventsDirectory = realpathSync(eventsDirectory);
    if (!isWithin(realRoot, actualEventsDirectory)) {
      return { events: [], problems: ["events directory escapes the project root"] };
    }
  } catch (error) {
    if (error?.code === "ENOENT") return { events: [], problems };
    return { events: [], problems: [`events directory could not be inspected: ${messageOf(error)}`] };
  }
  let entries = [];
  try {
    entries = readdirSync(actualEventsDirectory, { withFileTypes: true })
      .filter((entry) => entry.name.endsWith(".json"))
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
  } catch (error) {
    if (error?.code === "ENOENT") return { events: [], problems };
    return { events: [], problems: [`events directory could not be read: ${messageOf(error)}`] };
  }

  const gateTypeSet = new Set(gateTypes);
  const unique = new Map();
  for (const entry of entries) {
    const filePath = join(actualEventsDirectory, entry.name);
    let info;
    let actualFile;
    try {
      info = lstatSync(filePath);
      actualFile = realpathSync(filePath);
    } catch (error) {
      problems.push(`event ${entry.name} could not be inspected: ${messageOf(error)}`);
      continue;
    }
    if (!info.isFile() || info.isSymbolicLink() || !isWithin(realRoot, actualFile)) {
      problems.push(`event ${entry.name} is not a regular contained project file`);
      continue;
    }
    let raw;
    let payload;
    try {
      raw = readFileSync(actualFile, "utf8");
      payload = JSON.parse(raw);
    } catch (error) {
      problems.push(`event ${entry.name} is not valid JSON: ${messageOf(error)}`);
      continue;
    }
    if (!isRecord(payload)) {
      problems.push(`event ${entry.name} must be an object`);
      continue;
    }
    const type = payload.type ?? payload.event;
    if (typeof type !== "string" || type.trim() === "") {
      problems.push(`event ${entry.name} has no type`);
      continue;
    }
    const stateBearing = FINAL_EVENT_TYPES.has(type) || gateTypeSet.has(type);
    const timestamp = resolveEventTimestamp(payload, entry.name);
    if (stateBearing && timestamp === null) {
      problems.push(`state event ${entry.name} has no deterministic timestamp`);
      continue;
    }
    if (FINAL_EVENT_TYPES.has(type) && payload.version !== 1) {
      problems.push(`state event ${entry.name} has unsupported version ${String(payload.version)}`);
      continue;
    }
    const shapeProblem = validateFinalEventShape(payload, type);
    if (shapeProblem) {
      problems.push(`state event ${entry.name} ${shapeProblem}`);
      continue;
    }
    const id = typeof payload.id === "string" && payload.id.trim() !== ""
      ? payload.id
      : `legacy:${entry.name}`;
    const normalized = { id, type, timestamp, payload, file: entry.name, raw };
    const previous = unique.get(id);
    if (previous) {
      if (canonicalPayload(previous.payload) !== canonicalPayload(payload)) {
        problems.push(`duplicate event id ${id} has conflicting payloads`);
      }
      continue;
    }
    unique.set(id, normalized);
  }

  const events = [...unique.values()].sort(compareEvents);
  const acceptanceTimes = new Map();
  for (const event of events) {
    if (event.type === "final-acceptance") acceptanceTimes.set(event.id, event.timestamp);
  }
  for (const event of events) {
    if (event.type !== "final-acceptance-revoked") continue;
    const target = event.payload.acceptance_id;
    if (typeof target === "string" && !acceptanceTimes.has(target)) {
      problems.push(`revocation ${event.id} targets unknown acceptance ${target}`);
      continue;
    }
    if (typeof target === "string" && event.timestamp <= acceptanceTimes.get(target)) {
      problems.push(`revocation ${event.id} must occur after acceptance ${target}`);
    }
  }

  return { events, problems: [...new Set(problems)].sort((a, b) => a.localeCompare(b, "en")) };
}

export function resolveActiveAcceptance(events) {
  const acceptances = events.filter((event) => event.type === "final-acceptance");
  const acceptanceTimes = new Map(acceptances.map((event) => [event.id, event.timestamp]));
  const validRevokedIds = new Set();
  const problems = [];
  for (const event of events) {
    if (event.type !== "final-acceptance-revoked") continue;
    const target = event.payload.acceptance_id;
    if (!acceptanceTimes.has(target)) {
      problems.push(`revocation ${event.id} targets unknown acceptance ${String(target)}`);
    } else if (event.timestamp <= acceptanceTimes.get(target)) {
      problems.push(`revocation ${event.id} must occur after acceptance ${target}`);
    } else {
      validRevokedIds.add(target);
    }
  }
  let activeAcceptance = null;
  for (const acceptance of acceptances) {
    if (!validRevokedIds.has(acceptance.id)) activeAcceptance = acceptance;
  }
  return {
    activeAcceptance,
    revoked: validRevokedIds.size > 0 && activeAcceptance === null,
    problems: [...new Set(problems)].sort((a, b) => a.localeCompare(b, "en")),
  };
}

function validateFinalEventShape(payload, type) {
  if (!FINAL_EVENT_TYPES.has(type)) return null;
  if (!isNonEmptyString(payload.id)) return "has no id";
  if (!isNonEmptyString(payload.occurredAt) || !/(?:Z|[+-]\d{2}:?\d{2})$/u.test(payload.occurredAt)) {
    return "occurredAt must include an explicit offset";
  }
  if (type === "final-acceptance-revoked") {
    if (!isNonEmptyString(payload.acceptance_id)) return "has no acceptance_id";
    if (!isNonEmptyString(payload.reason)) return "has no reason";
    return null;
  }
  if (!isRecord(payload.actor) || payload.actor.kind !== "human" || !isNonEmptyString(payload.actor.id)) {
    return "actor must be {kind:human,id}";
  }
  if (!isRecord(payload.issuer) || payload.issuer.kind !== "akari-cli-tty" || payload.issuer.version !== 1) {
    return "issuer must be akari-cli-tty version 1";
  }
  if (!isSafeRelativePath(payload.artifact) || !isSafeRelativePath(payload.render_receipt)) {
    return "artifact/render_receipt must be safe project-relative paths";
  }
  for (const key of ["artifact_sha256", "render_receipt_sha256", "review_sha256"]) {
    if (typeof payload[key] !== "string" || !/^[a-f0-9]{64}$/u.test(payload[key])) return `${key} must be SHA-256`;
  }
  if (!isNonEmptyString(payload.verbatim)) return "verbatim must be non-empty";
  return null;
}

function isSafeRelativePath(value) {
  return isNonEmptyString(value)
    && !value.startsWith("/")
    && !value.split(/[\\/]/u).includes("..");
}

export function resolveEventTimestamp(payload, filename = "") {
  for (const key of ["occurredAt", "at", "recorded_at", "recorded_at_local"]) {
    if (!Object.hasOwn(payload, key)) continue;
    const parsed = parseOffsetTimestamp(payload[key]);
    if (parsed !== null) return parsed;
    return null;
  }
  return parseCompactFilenameTimestamp(filename);
}

function parseOffsetTimestamp(value) {
  if (typeof value !== "string") return null;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/u.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function parseCompactFilenameTimestamp(filename) {
  const match = basename(filename).match(
    /(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})[-T_]?(?<hour>\d{2})(?<minute>\d{2})(?<second>\d{2})(?<offset>Z|[+-]\d{4})/u,
  );
  if (!match?.groups) return null;
  const { year, month, day, hour, minute, second, offset } = match.groups;
  const normalizedOffset = offset === "Z" ? "Z" : `${offset.slice(0, 3)}:${offset.slice(3)}`;
  return parseOffsetTimestamp(`${year}-${month}-${day}T${hour}:${minute}:${second}${normalizedOffset}`);
}

function compareEvents(left, right) {
  if (left.timestamp === null && right.timestamp !== null) return 1;
  if (left.timestamp !== null && right.timestamp === null) return -1;
  return String(left.timestamp).localeCompare(String(right.timestamp), "en")
    || left.id.localeCompare(right.id, "en")
    || left.file.localeCompare(right.file, "en");
}

function canonicalPayload(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalPayload).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort((a, b) => a.localeCompare(b, "en"))
      .map((key) => `${JSON.stringify(key)}:${canonicalPayload(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isWithin(root, target) {
  const value = relative(root, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
