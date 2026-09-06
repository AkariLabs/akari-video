#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildCaptionsFromTranscript } from "../src/captions/build.mjs";
import { analysisPathForTarget } from "../src/media/record.mjs";
import { toPosix } from "../src/media/common.mjs";

const { writeProjectFilesGuarded } = createRequire(import.meta.url)("../../edit-store/lib/write-gate.js");
const usage = [
  "使い方: akari captions <project-dir> [options]", "",
  "  --source <sources[].id|媒体パス>",
  "  --readout <秒>       読み切り猶予（既定 0.3）",
  "  --min-duration <秒>  表示時間の床（既定 1.0）",
  "  --max-chars <N>      語境界で分割する文字数",
  "  --force             手直し済みの字幕も上書き",
  "  --dry-run           書き込まず結果 JSON を表示",
  "  --json", "  --help",
].join("\n");

export async function runCaptionsCli(argv, options = {}) {
  const stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = options.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    stdout(usage);
    return 0;
  }
  try {
    const [directory, ...rest] = argv;
    if (directory.startsWith("-")) throw new Error("project-dir が必要です");
    const parsed = parseOptions(rest);
    const projectRoot = path.resolve(options.cwd ?? process.cwd(), directory);
    const edit = JSON.parse(await readFile(path.join(projectRoot, "edit.json"), "utf8"));
    if (edit.version !== 2 || !Array.isArray(edit.sources)) throw new Error("edit.json v2 の sources[] が必要です");
    let source;
    if (parsed.source === undefined) {
      if (edit.sources.length !== 1) throw new Error(`--source を指定してください: ${edit.sources.map((item) => item.id).join(", ")}`);
      source = edit.sources[0];
    } else {
      source = edit.sources.find((item) => item.id === parsed.source)
        ?? edit.sources.find((item) => path.resolve(projectRoot, item.path) === path.resolve(projectRoot, parsed.source));
    }
    if (!source) throw new Error(`素材が見つかりません: ${parsed.source}`);
    const projectRelative = toPosix(path.relative(projectRoot, path.resolve(projectRoot, source.path)));
    if (projectRelative === ".." || projectRelative.startsWith("../") || path.isAbsolute(projectRelative)) {
      throw new Error("素材はプロジェクト内のパスで指定してください");
    }
    const analysisPath = analysisPathForTarget({ projectRoot, projectRelative });
    let analysis;
    try {
      analysis = JSON.parse(await readFile(analysisPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      throw new Error("文字起こしがありません。先に `akari media transcribe <path>` を実行してください");
    }
    if (!Array.isArray(analysis.transcript) || !analysis.transcript.length) throw new Error("発話がありません（transcript: []）");
    const captionsPath = path.join(projectRoot, "captions.json");
    let existing;
    try {
      existing = JSON.parse(await readFile(captionsPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const records = Array.isArray(existing) ? existing : existing?.captions ?? [];
    if (records.some((record) => record.edited === true) && !parsed.force) {
      throw new Error("手直し済みの字幕があります。上書きするには --force");
    }
    const result = buildCaptionsFromTranscript(analysis.transcript, { ...parsed, src: source.id });
    const root = {};
    for (const field of ["default_text_style", "display_policy", "emphasis_words"]) {
      if (existing && !Array.isArray(existing) && Object.hasOwn(existing, field)) root[field] = existing[field];
    }
    root.captions = result.captions;
    const content = `${JSON.stringify(root, null, 2)}\n`;
    if (parsed.dryRun) stdout(content.trimEnd());
    else await writeProjectFilesGuarded(projectRoot, { "captions.json": content });
    if (!edit.tracks?.some((track) => track.items?.some((item) => item.source?.kind === "captions"))) {
      stderr("edit.json の visual トラックに字幕トラックを宣言してください（edit-lint v2.captions-track-undeclared の案内どおり）");
    }
    stdout(JSON.stringify({ captions: result.captions.length, warnings: result.warnings, path: captionsPath }));
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parseOptions(argv) {
  const parsed = {};
  const values = { "--source": "source", "--readout": "readoutSeconds", "--min-duration": "minDurationSeconds", "--max-chars": "maxCharacters" };
  const booleans = { "--force": "force", "--dry-run": "dryRun", "--json": "json" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (Object.hasOwn(booleans, argument)) parsed[booleans[argument]] = true;
    else if (Object.hasOwn(values, argument)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--") || !value.trim()) throw new Error(`${argument} の値が必要です`);
      parsed[values[argument]] = argument === "--source" ? value : Number(value);
    } else throw new Error(`不明なオプションです: ${argument}`);
  }
  return parsed;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) process.exitCode = await runCaptionsCli(process.argv.slice(2));
