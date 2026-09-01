import { existsSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";

import { CONTACT_SHEET_MAX_FRAMES } from "../../../render-cut/src/contact-sheet.mjs";

export const CAPTURE_USAGE = `Usage: akari capture [-p <project>] (-t <time...> | --auto)
  [--engine auto|gpu|osr] [--separate] [--full]
  [--per-sheet <1-12>] [--out <dir>] [--edit <path>]

Times are timeline seconds or MM:SS(.fff).`;

export function parseCaptureArguments(argv, { cwd = process.cwd() } = {}) {
  const result = {
    projectRoot: null,
    times: [],
    auto: false,
    engine: "auto",
    separate: false,
    full: false,
    perSheet: CONTACT_SHEET_MAX_FRAMES,
    out: null,
    edit: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") {
      result.help = true;
    } else if (argument === "--auto") {
      result.auto = true;
    } else if (argument === "--separate") {
      result.separate = true;
    } else if (argument === "--full") {
      result.full = true;
    } else if (argument === "-p" || argument === "--out" || argument === "--edit" || argument === "--per-sheet" || argument === "--engine") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === "-p") result.projectRoot = resolve(cwd, value);
      else if (argument === "--out") result.out = value;
      else if (argument === "--edit") result.edit = value;
      else if (argument === "--engine") result.engine = parseEngine(value);
      else result.perSheet = parsePerSheet(value);
    } else if (argument.startsWith("--engine=")) {
      result.engine = parseEngine(argument.slice("--engine=".length));
    } else if (argument === "-t") {
      const start = result.times.length;
      while (index + 1 < argv.length && !argv[index + 1].startsWith("-")) {
        result.times.push(parseTimelineTime(argv[index + 1]));
        index += 1;
      }
      if (result.times.length === start) throw new Error("-t requires at least one time");
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (result.help) return result;
  result.projectRoot ??= findProjectRoot(cwd);
  if (!result.projectRoot) throw new Error("AKARI Video project not found; pass -p <project>");
  if (!result.auto && result.times.length === 0) throw new Error("-t <time...> or --auto is required");
  result.out = result.out ? resolve(result.projectRoot, result.out) : null;
  result.edit = result.edit ? resolve(result.projectRoot, result.edit) : resolve(result.projectRoot, "edit.json");
  return result;
}

export function parseTimelineTime(value) {
  const match = String(value).match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/u);
  if (!match) throw new Error(`invalid timeline time: ${value}`);
  const minutes = match[1] === undefined ? 0 : Number(match[1]);
  const seconds = Number(match[2]);
  if (match[1] !== undefined && seconds >= 60) throw new Error(`invalid MM:SS time: ${value}`);
  const total = minutes * 60 + seconds;
  if (!Number.isFinite(total) || total < 0) throw new Error(`invalid timeline time: ${value}`);
  return total;
}

function parsePerSheet(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > CONTACT_SHEET_MAX_FRAMES) {
    throw new Error(`--per-sheet must be an integer from 1 to ${CONTACT_SHEET_MAX_FRAMES}`);
  }
  return parsed;
}

function parseEngine(value) {
  if (!["auto", "gpu", "osr"].includes(value)) {
    throw new Error(`--engine must be auto|gpu|osr, got: ${value}`);
  }
  return value;
}

function findProjectRoot(cwd) {
  let current = resolve(cwd);
  const root = parse(current).root;
  while (true) {
    if (existsSync(resolve(current, ".akari"))) return current;
    if (current === root) return null;
    current = dirname(current);
  }
}
