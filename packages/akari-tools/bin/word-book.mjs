#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCreatorRoot } from "../../creator-root/src/index.mjs";
import {
  addEntry,
  applyWordBook,
  buildMatcher,
  layerPathFor,
  resolveWordBook,
  scanRecord,
} from "../../word-book/src/index.mjs";
import { runValidateWordBookCli } from "../../schemas/bin/validate-word-book.mjs";
import { updateAnalysisTranscript } from "../src/media/record.mjs";

const usage = [
  "使い方: akari-word-book <subcommand> [options]",
  "",
  "サブコマンド:",
  "  resolve [--project <dir>] [--word-book <path>] [--json]",
  "  validate <file>",
  "  add --surface <s> [--variant <v>]... --scope project|channel|workspace [options]",
  "  apply [--project <dir>] [--word-book <path>] [--dry-run] [--json]",
].join("\n");

export async function runWordBookCli(argv, options = {}) {
  const stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = options.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  const env = options.env ?? process.env;
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    stdout(usage);
    return 0;
  }
  const [command, ...rest] = argv;
  try {
    if (command === "validate") {
      return runValidateWordBookCli(rest, { stdout, stderr });
    }
    if (command === "resolve") return await runResolve(rest, { stdout, env });
    if (command === "add") return await runAdd(rest, { stdout, stderr, env });
    if (command === "apply") return await runApply(rest, { stdout, env });
    stderr(`不明な word-book サブコマンドです: ${command}`);
    stderr(usage);
    return 1;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  }
}

async function runResolve(argv, { stdout, env }) {
  const parsed = parseOptions(argv, {
    values: new Map([["--project", "project"], ["--word-book", "wordBook"]]),
    booleans: new Map([["--json", "json"]]),
  });
  const projectRoot = path.resolve(parsed.project ?? process.cwd());
  const resolved = await resolveWordBook({ projectRoot, extraPath: parsed.wordBook, env });
  if (parsed.json) {
    stdout(JSON.stringify(resolved));
    return 0;
  }
  stdout("scope\texists\tpath\terror");
  for (const layer of resolved.layers) {
    stdout(`${layer.scope}\t${layer.exists ? "yes" : "no"}\t${layer.path}\t${layer.error?.message ?? ""}`);
  }
  stdout("");
  stdout("surface\tkind\tvariants\tscope");
  for (const entry of resolved.entries) {
    stdout(`${entry.surface}\t${entry.kind}\t${entry.variants?.length ?? 0}\t${entry.scope}`);
  }
  return 0;
}

async function runAdd(argv, { stdout, env }) {
  const parsed = parseOptions(argv, {
    values: new Map([
      ["--surface", "surface"], ["--variant", "variants"], ["--kind", "kind"],
      ["--reading", "reading"], ["--source", "source"], ["--scope", "scope"], ["--project", "project"],
    ]),
    booleans: new Map([["--protect-break", "protectBreak"]]),
    repeat: new Set(["variants"]),
  });
  if (!parsed.surface) throw new Error("add: --surface が必要です");
  if (!parsed.scope) throw new Error("add: --scope が必要です");
  if (!new Set(["project", "channel", "workspace"]).has(parsed.scope)) throw new Error("add: --scope は project / channel / workspace のいずれかです");
  const kind = parsed.kind ?? "term";
  if (!new Set(["term", "notation", "ng", "reading-only"]).has(kind)) throw new Error("add: --kind が不正です");
  const projectRoot = path.resolve(parsed.project ?? process.cwd());
  let creatorRoot = null;
  if (parsed.scope !== "project") {
    const resolved = await resolveCreatorRoot({ cwd: projectRoot, env });
    if (resolved?.manifest && !resolved.error) creatorRoot = resolved;
  }
  const filePath = layerPathFor({ scope: parsed.scope, projectRoot, creatorRoot });
  if (!filePath) {
    const error = new Error("作業場がありません（お試しモード）。`--scope project` を使うか作業場を作ってください");
    error.exitCode = 2;
    throw error;
  }
  const entry = {
    surface: parsed.surface,
    ...(parsed.variants?.length ? { variants: parsed.variants } : {}),
    kind,
    ...(parsed.reading ? { reading: parsed.reading } : {}),
    ...(parsed.protectBreak ? { protect_break: true } : {}),
    source: parsed.source ?? "manual",
  };
  const result = await addEntry(filePath, entry);
  stdout(`${result.replaced ? "置換" : "追加"}: ${entry.surface} -> ${filePath}`);
  return 0;
}

async function runApply(argv, { stdout, env }) {
  const parsed = parseOptions(argv, {
    values: new Map([["--project", "project"], ["--word-book", "wordBook"]]),
    booleans: new Map([["--dry-run", "dryRun"], ["--json", "json"]]),
  });
  const projectRoot = path.resolve(parsed.project ?? process.cwd());
  const resolved = await resolveWordBook({ projectRoot, extraPath: parsed.wordBook, env });
  const matcher = buildMatcher(resolved.entries);
  const analysisPaths = await findAnalysisFiles(projectRoot);
  const total = emptyStats();
  let changedFiles = 0;
  for (const analysisPath of analysisPaths) {
    if (parsed.dryRun) {
      const analysis = JSON.parse(await readFile(analysisPath, "utf8"));
      const applied = applyWordBook(analysis.transcript ?? [], matcher, { mode: "transcript" });
      mergeStats(total, applied.stats);
      if (applied.stats.replaced > 0) changedFiles += 1;
      continue;
    }
    const target = targetForAnalysisPath(projectRoot, analysisPath);
    await updateAnalysisTranscript(target, (transcript) => {
      const applied = applyWordBook(transcript, matcher, { mode: "transcript" });
      mergeStats(total, applied.stats);
      if (applied.stats.replaced > 0) changedFiles += 1;
      return applied.records;
    });
  }

  const captions = await inspectCaptions(projectRoot, matcher);
  const result = {
    dry_run: parsed.dryRun === true,
    analysis: { files: analysisPaths.length, changed_files: changedFiles, stats: total },
    captions,
  };
  if (parsed.json) {
    stdout(JSON.stringify(result));
  } else {
    stdout(`analysis.json: ${total.replaced} 語を置換（${changedFiles}/${analysisPaths.length} ファイル${parsed.dryRun ? "・dry-run" : ""}）`);
    if (captions.exists) {
      stdout(`captions.json: 非 edited ${captions.unedited_matches} 行 / edited ${captions.edited_matches} 行に一致（本票では書かない。WB-b で apply）`);
    }
  }
  return 0;
}

function parseOptions(argv, { values, booleans, repeat = new Set() }) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (booleans.has(argument)) {
      result[booleans.get(argument)] = true;
      continue;
    }
    if (values.has(argument)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${argument} の値が必要です`);
      const key = values.get(argument);
      if (repeat.has(key)) (result[key] ??= []).push(value);
      else result[key] = value;
      index += 1;
      continue;
    }
    throw new Error(`不明なオプションです: ${argument}`);
  }
  return result;
}

async function findAnalysisFiles(projectRoot) {
  const sidecars = path.join(projectRoot, ".akari", "sidecars");
  const output = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name === "analysis.json" && path.basename(directory).endsWith(".analysis")) output.push(absolute);
    }
  }
  await walk(sidecars);
  return output.sort();
}

function targetForAnalysisPath(projectRoot, analysisPath) {
  const sidecars = path.join(projectRoot, ".akari", "sidecars");
  const relativeDirectory = path.relative(sidecars, path.dirname(analysisPath));
  const projectRelative = relativeDirectory.slice(0, -".analysis".length);
  return { projectRoot, projectRelative };
}

async function inspectCaptions(projectRoot, matcher) {
  const captionsPath = path.join(projectRoot, "captions.json");
  let root;
  try {
    root = JSON.parse(await readFile(captionsPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, unedited_matches: 0, edited_matches: 0 };
    throw error;
  }
  const records = Array.isArray(root) ? root : Array.isArray(root?.captions) ? root.captions : [];
  let uneditedMatches = 0;
  let editedMatches = 0;
  for (const record of records) {
    const matches = scanRecord(record, matcher).filter((match) => match.kind === "term" && match.matched !== match.surface);
    if (matches.length === 0) continue;
    if (record.edited === true) editedMatches += 1;
    else uneditedMatches += 1;
  }
  return { exists: true, unedited_matches: uneditedMatches, edited_matches: editedMatches };
}

function emptyStats() {
  return { replaced: 0, skipped_text_mismatch: 0, skipped_fragment_boundary: 0, skipped_edited: 0, by_surface: {} };
}

function mergeStats(target, source) {
  for (const field of ["replaced", "skipped_text_mismatch", "skipped_fragment_boundary", "skipped_edited"]) target[field] += source[field];
  for (const [surface, count] of Object.entries(source.by_surface)) target.by_surface[surface] = (target.by_surface[surface] ?? 0) + count;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) process.exitCode = await runWordBookCli(process.argv.slice(2));
