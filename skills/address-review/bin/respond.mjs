#!/usr/bin/env node

import path from "node:path";

import { respondToAnnotation } from "./core/review-store.mjs";

const USAGE = [
  "使い方:",
  "  node skills/address-review/bin/respond.mjs <project-root> --id a-0002",
  "    --action edited|declined --summary \"...\" [--json]",
].join("\n");

class CliError extends Error {}

function parseArguments(argv) {
  const options = { projectRoot: null, id: null, action: null, summary: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--id" || argument === "--action" || argument === "--summary") {
      const value = argv[index + 1];
      if (value === undefined) throw new CliError(`${argument} の値がありません`);
      if (argument === "--id") options.id = value;
      else if (argument === "--action") options.action = value;
      else options.summary = value;
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new CliError(`不明なオプションです: ${argument}`);
    } else if (options.projectRoot === null) {
      options.projectRoot = path.resolve(argument);
    } else {
      throw new CliError("project-root は 1 つだけ指定してください");
    }
  }
  if (!options.projectRoot) throw new CliError(USAGE);
  if (!options.id) throw new CliError("--id は必須です");
  return options;
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${errorText(error)}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }

  const reviewPath = path.join(options.projectRoot, "review.json");
  let result;
  try {
    result = await respondToAnnotation(reviewPath, {
      id: options.id,
      action: options.action,
      summary: options.summary,
      respondedAt: new Date().toISOString(),
    });
  } catch (error) {
    process.stderr.write(`${errorText(error)}\n`);
    process.exitCode = 2;
    return;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (result.ok) {
    process.stdout.write(
      `${result.annotation.id}: open → addressed（action=${result.annotation.response.action}, `
      + `respondedAt=${result.annotation.response.respondedAt}）\n`,
    );
  } else {
    process.stdout.write(`拒否 [${result.code}]: ${result.reason}\n`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`${errorText(error)}\n`);
  process.exitCode = 2;
});
