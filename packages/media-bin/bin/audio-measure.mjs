#!/usr/bin/env node

import path from "node:path";
import { realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolveFfmpeg } from "../src/index.mjs";
import { measureAudioLevels } from "../src/audio-measure.mjs";

function defaultCacheDir(filePath) {
  const materialDirectory = path.dirname(path.resolve(filePath));
  let directory = materialDirectory;
  while (true) {
    try {
      if (statSync(path.join(directory, ".akari")).isDirectory()) {
        return path.join(directory, ".akari", "cache", "audio-measure");
      }
    } catch {
      // Keep walking until the filesystem root; a missing .akari is expected.
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return path.join(materialDirectory, ".akari", "cache", "audio-measure");
}

export function runAudioMeasureCli(argv, io = {}) {
  const stdout = io.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = io.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  try {
    const [filePath, ...rest] = argv;
    if (!filePath || filePath.startsWith("-")) throw new Error("使い方: akari-audio-measure <file> [--cache-dir <dir>] [--no-cache]");
    let cacheDir = defaultCacheDir(filePath);
    let useCache = true;
    for (let index = 0; index < rest.length; index += 1) {
      if (rest[index] === "--no-cache") {
        useCache = false;
      } else if (rest[index] === "--cache-dir") {
        if (!rest[index + 1] || rest[index + 1].startsWith("--")) throw new Error("--cache-dir の値が必要です");
        cacheDir = rest[++index];
      } else {
        throw new Error(`不明なオプションです: ${rest[index]}`);
      }
    }
    const output = measureAudioLevels({ ffmpegPath: resolveFfmpeg(), filePath, cacheDir, useCache });
    stdout(JSON.stringify(output));
    return 0;
  } catch (error) {
    stderr(`音声レベルを計測できませんでした: ${error instanceof Error ? error.message : String(error)}`.replace(/\s+/gu, " "));
    return 1;
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) process.exitCode = runAudioMeasureCli(process.argv.slice(2));
