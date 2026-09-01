#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { filmstripMedia } from "../src/media/filmstrip.mjs";
import { grabMedia } from "../src/media/grab.mjs";
import { parseTime } from "../src/media/common.mjs";
import { probeMedia } from "../src/media/probe.mjs";
import { transcribeMedia } from "../src/media/transcribe.mjs";
import { waveformMedia } from "../src/media/waveform.mjs";

const commands = ["probe", "grab", "filmstrip", "waveform", "transcribe"];
const usage = [
  "使い方: akari media <subcommand> <target> [options]",
  "",
  "サブコマンド:",
  ...commands.map((command) => `  ${command}`),
].join("\n");

export async function runMediaCli(argv, options = {}) {
  const stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = options.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    stdout(usage);
    return 0;
  }
  const [subcommand, target, ...rest] = argv;
  if (!commands.includes(subcommand)) {
    stderr(`不明な media サブコマンドです: ${subcommand}`);
    stderr(usage);
    return 1;
  }
  if (!target || target.startsWith("-")) {
    stderr(`${subcommand}: target が必要です`);
    return 1;
  }
  try {
    const parsed = parseOptions(subcommand, rest);
    const commandOptions = { ...options, ...parsed };
    const result = await ({
      probe: probeMedia,
      grab: grabMedia,
      filmstrip: filmstripMedia,
      waveform: waveformMedia,
      transcribe: transcribeMedia,
    })[subcommand](target, commandOptions);
    for (const item of Array.isArray(result) ? result : [result]) stdout(JSON.stringify(item));
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parseOptions(subcommand, argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--no-record") {
      options.noRecord = true;
      continue;
    }
    if (subcommand === "transcribe" && argument === "--no-unrecognized") {
      options.unrecognized = false;
      continue;
    }
    if (subcommand === "grab" && argument === "-t") {
      options.times ??= [];
      let consumed = 0;
      while (argv[index + 1] && !argv[index + 1].startsWith("-")) {
        options.times.push(parseTime(argv[index + 1]));
        index += 1;
        consumed += 1;
      }
      if (consumed === 0) throw new Error("-t の値が必要です");
      continue;
    }
    if (subcommand === "grab" && argument === "--separate") {
      options.separate = true;
      continue;
    }
    if (subcommand === "filmstrip" && argument === "--scenes") {
      const next = argv[index + 1];
      options.scenes = next && !next.startsWith("-") ? numberValue(next, "--scenes") : 0.3;
      if (next && !next.startsWith("-")) index += 1;
      continue;
    }
    const valueOptions = allowedValueOptions(subcommand);
    if (Object.hasOwn(valueOptions, argument)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${argument} の値が必要です`);
      const [key, parser] = valueOptions[argument];
      options[key] = parser(value, argument);
      index += 1;
      continue;
    }
    throw new Error(`${subcommand}: 不明なオプションです: ${argument}`);
  }
  validateOptionCombinations(subcommand, options);
  return options;
}

function allowedValueOptions(subcommand) {
  const commonOutput = { "--out": ["out", String] };
  if (subcommand === "grab") return { ...commonOutput, "--per-sheet": ["perSheet", integerValue] };
  if (subcommand === "filmstrip") return {
    ...commonOutput,
    "--count": ["count", integerValue],
    "--every": ["every", numberValue],
    "--per-sheet": ["perSheet", integerValue],
  };
  if (subcommand === "waveform") return {
    ...commonOutput,
    "--silence-db": ["silenceDb", numberValue],
    "--min-silence": ["minSilence", numberValue],
  };
  if (subcommand === "transcribe") return {
    "--in": ["in", parseTime],
    "--out": ["out", parseTime],
    "--backend": ["backend", String],
    "--lang": ["lang", String],
    "--unrecognized-min-gap": ["unrecognizedMinGap", numberValue],
    "--unrecognized-min-voiced": ["unrecognizedMinVoiced", numberValue],
  };
  return {};
}

function integerValue(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${label} は整数で指定してください`);
  return parsed;
}

function numberValue(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} は数値で指定してください`);
  return parsed;
}

function validateOptionCombinations(subcommand, options) {
  if (subcommand === "filmstrip" && options.every !== undefined && (options.count !== undefined || options.scenes !== undefined)) {
    throw new Error("--every は --count / --scenes と併用できません");
  }
  if (options.perSheet !== undefined && (options.perSheet < 1 || options.perSheet > 12)) {
    throw new Error("--per-sheet は 1〜12 で指定してください");
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

if (isMainModule()) {
  process.exitCode = await runMediaCli(process.argv.slice(2));
}

