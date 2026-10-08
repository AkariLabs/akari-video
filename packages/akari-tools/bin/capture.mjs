#!/usr/bin/env node
import { dirname, isAbsolute, parse, resolve } from "node:path";

import { hasProjectAkariDirectory } from "../../asset-resolver/src/project-root.mjs";
import { isMainModule } from "../src/common/main-module.mjs";
import { CAPTURE_USAGE } from "../src/capture/arguments.mjs";
import { runCapture } from "../src/capture/run.mjs";

export async function main(argv = process.argv.slice(2), io = console) {
  try {
    const result = await runCapture(normalizeCaptureArgs(argv));
    if (result.help) {
      io.log(CAPTURE_USAGE);
      io.log("Relative paths in edit.json resolve from the nearest ancestor containing .akari/ (or the edit file directory).");
      return 0;
    }
    for (const record of result.records) io.log(JSON.stringify(record));
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function normalizeCaptureArgs(argv, cwd = process.cwd()) {
  const editIndex = argv.indexOf('--edit');
  if (editIndex < 0 || !argv[editIndex + 1]) return argv;
  const projectIndex = argv.indexOf('-p');
  const base = projectIndex >= 0 && argv[projectIndex + 1]
    ? resolve(cwd, argv[projectIndex + 1])
    : nearestProjectRoot(cwd) ?? cwd;
  const editPath = isAbsolute(argv[editIndex + 1])
    ? resolve(argv[editIndex + 1]) : resolve(base, argv[editIndex + 1]);
  const projectRoot = nearestProjectRoot(dirname(editPath)) ?? dirname(editPath);
  const normalized = [...argv];
  normalized[editIndex + 1] = editPath;
  if (projectIndex >= 0) normalized[projectIndex + 1] = projectRoot;
  else normalized.unshift('-p', projectRoot);
  return normalized;
}

function nearestProjectRoot(start) {
  for (let current = resolve(start); ; current = dirname(current)) {
    if (hasProjectAkariDirectory(current)) return current;
    if (current === parse(current).root) return null;
  }
}

if (isMainModule(import.meta.url)) process.exitCode = await main();
