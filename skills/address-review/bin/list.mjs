#!/usr/bin/env node

import path from "node:path";

import { locateAnnotations, needsConfirmation, readReviewSource } from "./core/review-store.mjs";

const USAGE = [
  "使い方:",
  "  node skills/address-review/bin/list.mjs <project-root> --ids a-0002,a-0003 [--json]",
  "  node skills/address-review/bin/list.mjs <project-root> --all-open [--json]",
].join("\n");

class CliError extends Error {}

function parseArguments(argv) {
  const options = { projectRoot: null, ids: null, allOpen: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (argument === "--all-open") {
      options.allOpen = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--ids") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new CliError("--ids の値がありません");
      options.ids = value.split(",").map((id) => id.trim()).filter(Boolean);
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
  if (options.allOpen && options.ids) throw new CliError("--ids と --all-open は同時に指定できません");
  if (!options.allOpen && !options.ids) throw new CliError("--ids または --all-open のどちらかが必要です");
  if (options.ids) {
    for (const id of options.ids) {
      if (!/^a-\d{4,}$/.test(id)) throw new CliError(`--ids の形式が不正です: ${id}`);
    }
  }
  return options;
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function number(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "—";
}

function describeSession(session) {
  if (!session) return null;
  const range = Array.isArray(session.recRange)
    ? `${number(session.recRange[0])}–${number(session.recRange[1])}`
    : "—";
  return `session ${session.id ?? "?"} recRange=${range} confidence=${session.confidence ?? "?"}`;
}

function describeStrokes(strokes) {
  if (!Array.isArray(strokes) || strokes.length === 0) return null;
  const refs = strokes.map((stroke) => stroke?.sessionRef).filter(Boolean);
  return `strokes ${strokes.length} 件${refs.length ? ` (${refs.join(", ")})` : ""}`;
}

function describeStrokeRefs(strokeRefs) {
  if (!Array.isArray(strokeRefs) || strokeRefs.length === 0) return null;
  const refs = strokeRefs.map((reference) => reference?.sessionRef
    ?? (reference?.sessionId && reference?.strokeId
      ? `${reference.sessionId}/${reference.strokeId}` : null)).filter(Boolean);
  return refs.length > 0
    ? `stroke replay: ${refs.map((reference) => `review/sessions/${reference.split('/')[0]}/strokes.json#${reference.split('/')[1]}`).join(', ')}`
    : null;
}

function formatAnnotation(value) {
  const target = value.target ?? value.targetKind ?? "(なし)";
  const lines = [
    `- ${value.id} [${value.status}] sourceT=${number(value.sourceT)}`
    + `${Array.isArray(value.sourceRange) ? ` sourceRange=${number(value.sourceRange[0])}-${number(value.sourceRange[1])}` : ""}`
    + ` target=${target}`,
    `  text: ${value.text}`,
    `  input: ${value.input}`,
  ];
  const sessionLine = describeSession(value.session);
  if (sessionLine) lines.push(`  ${sessionLine}`);
  const strokesLine = describeStrokes(value.strokes);
  if (strokesLine) lines.push(`  ${strokesLine}`);
  const strokeRefsLine = describeStrokeRefs(value.strokeRefs);
  if (strokeRefsLine) lines.push(`  ${strokeRefsLine}`);
  if (value.audio) lines.push(`  audio: ${value.audio}`);
  if (value.response) {
    lines.push(
      `  response: action=${value.response.action} respondedAt=${value.response.respondedAt}`,
      `  response.summary: ${value.response.summary}`,
    );
  }
  return lines;
}

function buildResult(options, source) {
  if (source === null) {
    return {
      projectRoot: options.projectRoot,
      mode: options.allOpen ? "all-open" : "ids",
      targets: [],
      skipped: [],
      notFound: options.ids ?? [],
      note: "review.json がありません（annotation ゼロ扱い）",
    };
  }
  const annotations = locateAnnotations(source).map((entry) => entry.value);
  if (options.allOpen) {
    const openAnnotations = annotations.filter((value) => value.status === "open");
    const skipped = openAnnotations.filter((value) => needsConfirmation(value));
    const targets = openAnnotations.filter((value) => !needsConfirmation(value));
    return {
      projectRoot: options.projectRoot,
      mode: "all-open",
      targets,
      skipped,
      notFound: [],
    };
  }
  const byId = new Map(annotations.map((value) => [value.id, value]));
  const targets = [];
  const notFound = [];
  for (const id of options.ids) {
    const value = byId.get(id);
    if (value) targets.push(value);
    else notFound.push(id);
  }
  return { projectRoot: options.projectRoot, mode: "ids", targets, skipped: [], notFound };
}

function printHuman(result) {
  const lines = [];
  if (result.note) {
    lines.push(result.note, "");
  }
  lines.push(
    result.mode === "all-open"
      ? `対象 ${result.targets.length} 件（--all-open）`
      : `対象 ${result.targets.length} 件（--ids）`,
  );
  if (result.targets.length === 0) {
    lines.push("- なし");
  } else {
    for (const value of result.targets) lines.push(...formatAnnotation(value));
  }
  if (result.mode === "all-open") {
    lines.push(
      "",
      `要確認スキップ ${result.skipped.length} 件（[要確認] は --all-open では対象外。--ids で明示指定すれば対象にできます）`,
    );
    if (result.skipped.length === 0) {
      lines.push("- なし");
    } else {
      for (const value of result.skipped) lines.push(`- ${value.id}: ${value.text}`);
    }
  }
  if (result.notFound.length > 0) {
    lines.push("", `未検出の id: ${result.notFound.join(", ")}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
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
  let source;
  try {
    source = await readReviewSource(reviewPath);
  } catch (error) {
    process.stderr.write(`${errorText(error)}\n`);
    process.exitCode = 2;
    return;
  }
  let result;
  try {
    result = buildResult(options, source);
  } catch (error) {
    process.stderr.write(`${errorText(error)}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    printHuman(result);
  }
}

main().catch((error) => {
  process.stderr.write(`${errorText(error)}\n`);
  process.exitCode = 2;
});
