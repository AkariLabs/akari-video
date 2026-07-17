#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const helperSource = path.join(scriptDir, "speechanalyzer-helper.swift");
const defaultHelperBin = path.join(scriptDir, "speechanalyzer-helper");

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function summarize(value, fallback) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 500) : fallback;
}

function spawn(command, args) {
  try {
    return spawnSync(command, args, { encoding: "utf8" });
  } catch (error) {
    return { error };
  }
}

function checkAvailability() {
  if (os.platform() !== "darwin") {
    return { available: false, reason: `macOS ではありません（${os.platform()}）` };
  }

  const versionResult = spawn("sw_vers", ["-productVersion"]);
  if (versionResult.error?.code === "ENOENT") {
    return { available: false, reason: "sw_vers が PATH 上にありません" };
  }
  if (versionResult.error || versionResult.status !== 0) {
    return { available: false, reason: "macOS バージョンを取得できません" };
  }
  const version = String(versionResult.stdout ?? "").trim();
  const major = Number.parseInt(version.split(".")[0], 10);
  if (!Number.isInteger(major)) {
    return { available: false, reason: `macOS バージョンを判定できません（${version || "空"}）` };
  }
  if (major < 26) {
    return { available: false, reason: `macOS ${version} は 26 未満です` };
  }

  const swiftResult = spawn("swiftc", ["-version"]);
  if (swiftResult.error?.code === "ENOENT") {
    return { available: false, reason: "swiftc が PATH 上にありません" };
  }
  if (swiftResult.error || swiftResult.status !== 0) {
    return { available: false, reason: "swiftc を起動できません" };
  }
  return { available: true };
}

function parseArguments(argv) {
  const result = { check: false, input: null, helperBin: defaultHelperBin };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      result.check = true;
    } else if (argument === "--input" || argument === "--helper-bin") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} の値がありません`);
      if (argument === "--input") result.input = path.resolve(value);
      else result.helperBin = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`不明な引数です: ${argument}`);
    }
  }
  return result;
}

function needsBuild(helperBin) {
  const sourceStat = fs.statSync(helperSource);
  try {
    return fs.statSync(helperBin).mtimeMs < sourceStat.mtimeMs;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

function buildHelper(helperBin) {
  if (!needsBuild(helperBin)) return null;
  const result = spawn("swiftc", ["-O", "-parse-as-library", helperSource, "-o", helperBin]);
  if (result.error || result.status !== 0) {
    return summarize(result.stderr, result.error?.code === "ENOENT" ? "swiftc が PATH 上にありません" : "終了コードが 0 ではありません");
  }
  return null;
}

function validTimedItem(value) {
  return value && Number.isFinite(value.start) && Number.isFinite(value.end) && value.end > value.start;
}

function normalizeHelperOutput(value) {
  let droppedSegments = 0;
  let droppedWords = 0;
  const segments = [];
  for (const segment of Array.isArray(value?.segments) ? value.segments : []) {
    if (!validTimedItem(segment)) {
      droppedSegments += 1;
      droppedWords += Array.isArray(segment?.words) ? segment.words.length : 0;
      continue;
    }
    const words = [];
    for (const word of Array.isArray(segment.words) ? segment.words : []) {
      if (!validTimedItem(word)) {
        droppedWords += 1;
        continue;
      }
      words.push({ start: word.start, end: word.end, text: String(word.text ?? "") });
    }
    segments.push({ start: segment.start, end: segment.end, text: String(segment.text ?? ""), words });
  }
  segments.sort((left, right) => left.start - right.start);
  return { segments, droppedSegments, droppedWords };
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    printJson({ backend: "speechanalyzer", available: false, reason: summarize(error?.message, "引数が不正です") });
    process.exitCode = 2;
    return;
  }

  const availability = checkAvailability();
  if (options.check) {
    printJson(availability);
    return;
  }
  if (!options.input) {
    printJson({ backend: "speechanalyzer", available: false, reason: "--input が必要です" });
    process.exitCode = 2;
    return;
  }
  if (!availability.available) {
    printJson({ backend: "speechanalyzer", ...availability });
    process.exitCode = 1;
    return;
  }

  try {
    const buildError = buildHelper(options.helperBin);
    if (buildError) {
      printJson({ backend: "speechanalyzer", available: false, reason: `swiftc build failed: ${buildError}` });
      process.exitCode = 1;
      return;
    }
  } catch (error) {
    printJson({ backend: "speechanalyzer", available: false, reason: `swiftc build failed: ${summarize(error?.message, "ビルド準備に失敗しました")}` });
    process.exitCode = 1;
    return;
  }

  const helperResult = spawn(options.helperBin, [options.input]);
  let helperJson = null;
  try {
    helperJson = JSON.parse(String(helperResult.stdout ?? ""));
  } catch {
    // 非 JSON の stdout は採用しない。
  }
  if (helperResult.error || helperResult.status !== 0 || helperJson === null) {
    const detail = typeof helperJson?.error === "string"
      ? helperJson.error
      : summarize(helperResult.stderr, helperResult.error?.message ?? "stdout が有効な JSON ではありません");
    printJson({ backend: "speechanalyzer", available: false, reason: `helper failed: ${detail}` });
    process.exitCode = 1;
    return;
  }

  const normalized = normalizeHelperOutput(helperJson);
  if (normalized.droppedSegments > 0 || normalized.droppedWords > 0) {
    process.stderr.write(`SpeechAnalyzer の無効時刻を除外: segments=${normalized.droppedSegments}, words=${normalized.droppedWords}\n`);
  }
  printJson({ backend: "speechanalyzer", available: true, segments: normalized.segments });
}

main();
