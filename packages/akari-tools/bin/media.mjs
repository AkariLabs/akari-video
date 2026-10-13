#!/usr/bin/env node

import { resolve } from "node:path";

import { isMainModule } from "../src/common/main-module.mjs";
import { stampSavedBy } from "../src/common/writer-stamp.mjs";
import { filmstripMedia } from "../src/media/filmstrip.mjs";
import { grabMedia } from "../src/media/grab.mjs";
import { parseTime } from "../src/media/common.mjs";
import { probeMedia } from "../src/media/probe.mjs";
import { transcribeDiffMedia } from "../src/media/transcribe-diff.mjs";
import { transcribeCutsMedia } from "../src/media/transcribe-cuts.mjs";
import { transcribeMedia } from "../src/media/transcribe.mjs";
import { waveformMedia } from "../src/media/waveform.mjs";
import { audioLevelProject, formatAudioLevelTable } from "../src/audio-level.mjs";
import { toolsText, toolsLanguage } from "../src/i18n.mjs";

const commands = ["probe", "grab", "filmstrip", "waveform", "transcribe", "transcribe-diff", "transcribe-cuts", "audio-level"];
const usage = (lang, extended = false) => [
  toolsText('tools.media.help.usage', {}, lang),
  "",
  toolsText('tools.media.help.commands', {}, lang),
  ...commands.map((command) => command === "transcribe" ? toolsText('tools.media.help.transcribe', {}, lang) : `  ${command}`),
  "  transcribe-diff <target> [--engines a,b,c]",
  "  transcribe-cuts <target> [--basis b] [--filler on] [--redo on] [--silence-min 1.5] [--silence-break 3.0] [--silence-keep 0.5]",
  ...(!extended && (lang ?? toolsLanguage()).startsWith('ja') ? [] : [...["in", "out", "backend", "lang"].map((name) => toolsText(`tools.media.help.${name}`, {}, lang)), toolsText('tools.media.help.prompt', {}, lang), toolsText('tools.media.help.fillers', {}, lang)]),
].join("\n");

export async function runMediaCli(argv, options = {}) {
  const text = (key, params) => toolsText(key, params);
  const stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = options.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    stdout(usage());
    return 0;
  }
  const [subcommand, target, ...rest] = argv;
  if (!commands.includes(subcommand)) {
    stderr(text('tools.media.error.unknownCommand', { command: subcommand }));
    stderr(usage());
    return 1;
  }
  // target 判定より前に見る（`akari media transcribe --help` が targetRequired で落ちないように）
  if (argv.includes('--help') || argv.includes('-h')) {
    stdout(usage(undefined, subcommand === 'transcribe'));
    return 0;
  }
  if (!target || target.startsWith("-")) {
    stderr(text('tools.media.error.targetRequired', { command: subcommand }));
    return 1;
  }
  try {
    const parsed = parseOptions(subcommand, rest);
    const commandOptions = { ...options, ...parsed };
    if (subcommand === "audio-level") {
      const result = await audioLevelProject(target, commandOptions);
      if (commandOptions.write && result.rows.some(row => row.written)) {
        await stampSavedBy(resolve(target));
      }
      for (const warning of result.warnings) stderr(warning);
      if (commandOptions.json) stdout(JSON.stringify(result.rows));
      else for (const line of formatAudioLevelTable(result)) stdout(line);
      return 0;
    }
    const result = await ({
      probe: probeMedia,
      grab: grabMedia,
      filmstrip: filmstripMedia,
      waveform: waveformMedia,
      transcribe: transcribeMedia,
      "transcribe-diff": transcribeDiffMedia,
      "transcribe-cuts": transcribeCutsMedia,
    })[subcommand](target, commandOptions);
    for (const item of Array.isArray(result) ? result : [result]) stdout(JSON.stringify(item));
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return error?.exitCode === 2 ? 2 : 1;
  }
}

function parseOptions(subcommand, argv, language) {
  const options = {};
  const text = (key, params) => toolsText(key, params, language);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--no-record") {
      options.noRecord = true;
      continue;
    }
    if (subcommand === "audio-level" && argument === "--write") {
      options.write = true;
      continue;
    }
    if (subcommand === "audio-level" && argument === "--json") {
      options.json = true;
      continue;
    }
    if (subcommand === "audio-level" && argument === "--no-cache") {
      options.useCache = false;
      continue;
    }
    if (subcommand === "transcribe" && argument === "--no-unrecognized") {
      options.unrecognized = false;
      continue;
    }
    if (subcommand === "transcribe" && argument === "--no-word-book") {
      options.wordBook = false;
      continue;
    }
    if (subcommand === "transcribe" && argument === "--no-snap") {
      options.snap = false;
      continue;
    }
    if (subcommand === "transcribe" && argument === "--keep-fillers") {
      options.whisperPrompt = true;
      continue;
    }
    if (subcommand === "transcribe" && argument === "--diarize") {
      options.diarize = true;
      continue;
    }
    if (subcommand === "transcribe" && argument === "--identify") {
      options.identify = true;
      options.diarize = true;
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
      if (consumed === 0) throw new Error(text('tools.media.error.valueRequired', { option: '-t' }));
      continue;
    }
    if (subcommand === "grab" && argument === "--separate") {
      options.separate = true;
      continue;
    }
    if (subcommand === "filmstrip" && argument === "--scenes") {
      const next = argv[index + 1];
      options.scenes = next && !next.startsWith("-") ? numberValue(next, "--scenes", language) : 0.3;
      if (next && !next.startsWith("-")) index += 1;
      continue;
    }
    const valueOptions = allowedValueOptions(subcommand);
    if (Object.hasOwn(valueOptions, argument)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(text('tools.media.error.valueRequired', { option: argument }));
      const [key, parser] = valueOptions[argument];
      options[key] = parser(value, argument, language);
      index += 1;
      continue;
    }
    throw new Error(text('tools.media.error.unknownOption', { command: subcommand, option: argument }));
  }
  validateOptionCombinations(subcommand, options, language);
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
    "--whisper-prompt": ["whisperPrompt", String],
    "--word-book": ["wordBookPath", String],
    "--speakers": ["speakers", speakerCountValue],
    "--people": ["people", String],
    "--unrecognized-min-gap": ["unrecognizedMinGap", numberValue],
    "--unrecognized-min-voiced": ["unrecognizedMinVoiced", numberValue],
  };
  if (subcommand === "transcribe-diff") return { "--engines": ["engines", String] };
  if (subcommand === "transcribe-cuts") return {
    "--basis": ["basis", String],
    "--filler": ["filler", String],
    "--redo": ["redo", String],
    "--silence-min": ["silenceMin", numberValue],
    "--silence-break": ["silenceBreak", numberValue],
    "--silence-keep": ["silenceKeep", numberValue],
  };
  if (subcommand === "audio-level") return {
    "--targets": ["targets", jsonObjectValue],
    "--ceiling": ["ceilingDbtp", numberValue],
  };
  return {};
}

function jsonObjectValue(value, label, language) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(toolsText('tools.media.error.jsonObject', { option: label }, language));
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(toolsText('tools.media.error.jsonObject', { option: label }, language));
  }
  return parsed;
}

function integerValue(value, label, language) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(toolsText('tools.media.error.integer', { option: label }, language));
  return parsed;
}

function speakerCountValue(value, label, language) {
  if (value === "auto") return value;
  if (/^[1-4]$/.test(value)) return Number(value);
  throw new Error(toolsText('tools.media.error.speakerCount', {}, language));
}

function numberValue(value, label, language) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(toolsText('tools.media.error.number', { option: label }, language));
  return parsed;
}

function validateOptionCombinations(subcommand, options, language) {
  if (subcommand === "transcribe") {
    if (options.speakers !== undefined) options.diarize = true;
    if (options.people !== undefined) { options.identify = true; options.diarize = true; }
  }
  if (subcommand === "filmstrip" && options.every !== undefined && (options.count !== undefined || options.scenes !== undefined)) {
    throw new Error(toolsText('tools.media.error.everyConflict', {}, language));
  }
  if (options.perSheet !== undefined && (options.perSheet < 1 || options.perSheet > 12)) {
    throw new Error(toolsText('tools.media.error.perSheetRange', {}, language));
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await runMediaCli(process.argv.slice(2));
}
