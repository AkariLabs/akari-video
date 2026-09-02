#!/usr/bin/env node

import { readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { resolveFfmpeg } from "../../media-bin/src/index.mjs";
import { readRenderEdit } from "../src/internal-render.mjs";
import { predictedDuration } from "../src/plan.mjs";
import { extractThumbnailStrip, planThumbnailStrip } from "../src/thumbnail-strip.mjs";
import { isMainModule } from "./is-main-module.mjs";

export async function runCli(args, io = console) {
  try {
    const options = parseArguments(args);
    const projectRoot = resolve(options.projectRoot);
    const outDir = resolve(options.out);
    const source = await readFile(join(projectRoot, "edit.json"), "utf8");
    const { edit } = readRenderEdit(source, join(projectRoot, ".akari", "render-tmp"), { projectRoot });
    const fps = edit.output.fps ?? 30;
    const durationSeconds = predictedDuration(edit.cuts);
    const plan = planThumbnailStrip({ edit, durationSeconds, fps, count: options.count });
    const frames = await extractThumbnailStrip({
      plan,
      projectRoot,
      outDir,
      width: options.width,
      ffmpegCommand: resolveFfmpeg(),
    });
    await pruneOldRuns(outDir);
    const result = { durationSeconds, fps, width: options.width, frames };
    if (options.json) {
      io.log(JSON.stringify(result));
    } else {
      io.log(`サムネイル ${frames.filter((frame) => frame.path !== null).length}/${frames.length} 枚を生成しました`);
    }
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message.replace(/\s+/gu, " ") : String(error));
    return 1;
  }
}

function parseArguments(args) {
  const options = { projectRoot: "", out: "", count: 12, width: 160, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--") && options.projectRoot === "") {
      options.projectRoot = argument;
    } else if (argument === "--out" || argument === "--count" || argument === "--width") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} に値を指定してください`);
      if (argument === "--out") options.out = value;
      if (argument === "--count") options.count = Number(value);
      if (argument === "--width") options.width = Number(value);
      index += 1;
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new Error(`不明な引数です: ${argument}`);
    }
  }
  if (!options.projectRoot || !options.out) {
    throw new Error("使い方: thumbnail-strip <projectRoot> --out <dir> [--count 12] [--width 160] --json");
  }
  if (!Number.isInteger(options.count) || options.count <= 0) throw new Error("--count は正の整数で指定してください");
  if (!Number.isInteger(options.width) || options.width <= 0) throw new Error("--width は正の整数で指定してください");
  return options;
}

async function pruneOldRuns(outDir) {
  const parent = resolve(outDir, "..");
  if (basename(parent) !== "export-strip") return;
  const names = await readdir(parent);
  const directories = (await Promise.all(names.map(async (name) => {
    const path = join(parent, name);
    try {
      const details = await stat(path);
      return details.isDirectory() ? { path, mtimeMs: details.mtimeMs } : null;
    } catch {
      return null;
    }
  }))).filter(Boolean).sort((left, right) =>
    right.mtimeMs - left.mtimeMs
    || (left.path === outDir ? -1 : right.path === outDir ? 1 : left.path.localeCompare(right.path))
  );
  await Promise.all(directories.slice(3).map((entry) => rm(entry.path, { recursive: true, force: true })));
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await runCli(process.argv.slice(2));
}
