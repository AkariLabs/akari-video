#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VALIDATOR = path.resolve(HERE, "../../schemas/bin/validate-world-map.mjs");
const usage = "使い方: akari world <check|build|preview|overview|move-stop> [project-root] [--strict] [--migrate] [--json] [--measure] [--stop <id>] [--c x,y[,scale]]";

export async function runWorldCommand(args, options = {}) {
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") { log(usage); return { exitCode: 0 }; }
  const rest = args.slice(1);
  if (subcommand === "move-stop") {
    const parsed = parseMoveStopArgs(rest);
    if (!parsed.ok) { logError(usage); return { exitCode: 2 }; }
    const project = path.resolve(parsed.project ?? ".");
    const run = options.moveStop ?? (await import("../src/world/edit.mjs")).moveWorldStop;
    let result;
    try { result = await run(project, { stopId: parsed.stopId, c: parsed.c }); }
    catch (error) { result = { ok: false, code: "IO", reason: error instanceof Error ? error.message : String(error), file: path.join(project, "planning", "world-map.json") }; }
    if (parsed.json) log(JSON.stringify(result));
    else if (result.ok) log(`停留所 ${result.stopId}: ${result.before.join(",")} → ${result.after.join(",")}`);
    else logError(result.reason);
    return { exitCode: result.ok ? 0 : 1 };
  }
  if (subcommand === "check") {
    const positions = rest.filter((arg) => !arg.startsWith("-"));
    const project = positions[0] ?? ".";
    const flags = rest.filter((arg) => arg.startsWith("-"));
    const spawn = options.spawn ?? spawnSync;
    const result = spawn(process.execPath, [VALIDATOR, path.resolve(project), ...flags], { stdio: "inherit" });
    return { exitCode: typeof result?.status === "number" ? result.status : 1 };
  }
  const positions = rest.filter((arg) => !arg.startsWith("-"));
  if (positions.length > 1) { logError(usage); return { exitCode: 2 }; }
  const project = path.resolve(positions[0] ?? ".");
  try {
    if (subcommand === "build") {
      if (rest.some((arg) => arg.startsWith("-"))) { logError(usage); return { exitCode: 2 }; }
      const run = options.build ?? (await import("../src/world/build.mjs")).buildWorld;
      await run(project);
    } else if (subcommand === "preview") {
      if (rest.some((arg) => arg.startsWith("-") && arg !== "--measure")) { logError(usage); return { exitCode: 2 }; }
      const run = options.preview ?? (await import("../src/world/preview.mjs")).previewWorld;
      await run(project, { measure: rest.includes("--measure") });
    } else if (subcommand === "overview") {
      if (rest.some((arg) => arg.startsWith("-"))) { logError(usage); return { exitCode: 2 }; }
      const run = options.overview ?? (await import("../src/world/overview.mjs")).buildWorldOverview;
      await run(project);
    }
    else { logError(`不明な world サブコマンドです: ${subcommand}`); log(usage); return { exitCode: 1 }; }
    return { exitCode: 0 };
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    return { exitCode: error?.exitCode ?? 1 };
  }
}

function parseMoveStopArgs(args) {
  let project, stopId, coordinate, json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--stop" || arg === "--c") {
      const value = args[++index];
      if (!value || value.startsWith("--")) return { ok: false };
      if (arg === "--stop") stopId = value; else coordinate = value;
    } else if (arg.startsWith("--stop=")) stopId = arg.slice(7);
    else if (arg.startsWith("--c=")) coordinate = arg.slice(4);
    else if (arg.startsWith("-")) return { ok: false };
    else if (project === undefined) project = arg;
    else return { ok: false };
  }
  const parts = coordinate?.split(",");
  const c = parts?.map(Number);
  if (!stopId || !coordinate || !Array.isArray(c) || parts.some((part) => part.trim() === "") || c.length < 2 || c.length > 3 || !c.every(Number.isFinite)) return { ok: false };
  return { ok: true, project, stopId, c, json };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const result = await runWorldCommand(process.argv.slice(2));
  process.exitCode = result.exitCode;
}
