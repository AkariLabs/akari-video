#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { isMainModule } from "../src/common/main-module.mjs";

import { resolveWordBook, buildMatcher, applyWordBook } from "../../word-book/src/index.mjs";

import { buildCaptionsFromTranscript } from "../src/captions/build.mjs";
import { mergeCaptionsForApply } from "../src/captions/apply-diff.mjs";
import { buildCaptionsFromNarration, NarrationAlignmentError } from "../src/captions/narration.mjs";
import { retimeCaptionsToSpeech } from "../src/captions/retime.mjs";
import { analysisPathForTarget, transcriptsDirForTarget } from "../src/media/record.mjs";
import { probeRaw, resolveTools, sha256File, toPosix } from "../src/media/common.mjs";
import { runSilenceDetect } from "../src/media/transcribe.mjs";
import { UNRECOGNIZED_DEFAULTS } from "../src/media/unrecognized-spans.mjs";
import { toolsText } from '../src/i18n.mjs';
import { readContentLanguage } from "../../content-language/src/node.mjs";
import { captionLanguageDefaults, normalizeLanguage } from "../../content-language/src/index.mjs";

const { writeProjectFilesGuarded } = createRequire(import.meta.url)("../../edit-store/lib/write-gate.js");
const { applyCaptionLookMigration } = createRequire(import.meta.url)("../../edit-store/lib/caption-style-write.js");
const usage = () => [
  toolsText('tools.captions.help.usage'), "",
  toolsText('tools.captions.help.migrateLook'),
  ...['source', 'narration', 'retime', 'readout', 'minDuration', 'split', 'maxChars', 'maxSeconds', 'pause', 'wordBook', 'noWordBook', 'force', 'dryRun'].map((name) => toolsText(`tools.captions.help.${name}`)),
  "  --json", "  --help",
].join("\n");

export async function runCaptionsCli(argv, options = {}) {
  const stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = options.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    stdout(usage());
    return 0;
  }
  try {
    if (argv[0] === 'migrate-look') {
      const [command, directory, ...rest] = argv;
      void command;
      if (!directory || directory.startsWith('-')) throw new Error(toolsText('tools.captions.error.projectRequired'));
      for (const flag of rest) if (flag !== '--dry-run' && flag !== '--json')
        throw new Error(toolsText('tools.captions.error.unknownOption', { option: flag }));
      const dryRun = rest.includes('--dry-run');
      const project = path.resolve(options.cwd ?? process.cwd(), directory);
      const names = (await readdir(project)).filter(name => name === 'captions.json'
        || /^captions\.([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/.test(name)).sort();
      const files = [];
      const diff = [], notices = [], written = new Set();
      for (const captions of names) {
        const slug = captions === 'captions.json' ? '' : captions.slice('captions.'.length, -'.json'.length);
        const edit = slug ? `edit.${slug}.json` : 'edit.json';
        const result = await applyCaptionLookMigration(project, { dryRun, files: { captions, edit } });
        files.push({ captions, changed: result.diff.length, written: result.written, notices: [...new Set(result.notices)] });
        diff.push(...result.diff.map(item => ({ ...item, path: `${captions}:${item.path}` })));
        notices.push(...result.notices);
        for (const name of result.written) written.add(name);
      }
      const summary = { dry_run: dryRun, changed: diff.length, diff, notices: [...new Set(notices)],
        written: [...written], files };
      if (rest.includes('--json')) stdout(JSON.stringify(summary));
      else { stdout(toolsText('tools.captions.result.migrateLook', { count: diff.length }));
        for (const item of diff) stdout(`${item.path}: ${JSON.stringify(item.before)} → ${JSON.stringify(item.after)}`);
        for (const notice of summary.notices) stdout(notice); }
      return 0;
    }
    const [directory, ...rest] = (() => {
      // `akari captions --narration <dir>` is accepted in addition to
      // `akari captions <dir> --narration`.
      if (argv[0] !== "--narration") return argv;
      const [, project, ...tail] = argv;
      if (!project || project.startsWith("-")) return argv;
      return [project, "--narration", ...tail];
    })();
    if (directory.startsWith("-")) throw new Error(toolsText('tools.captions.error.projectRequired'));
    const parsed = parseOptions(rest);
    const projectRoot = path.resolve(options.cwd ?? process.cwd(), directory);
    const edit = JSON.parse(await readFile(path.join(projectRoot, "edit.json"), "utf8"));
    if (parsed.narration && parsed.source !== undefined) {
      throw new Error(toolsText('tools.captions.error.sourceNarrationConflict'));
    }
    if (parsed.narration && parsed.retime) throw new Error(toolsText('tools.captions.error.retimeNarrationConflict'));
    if (edit.version !== 2) throw new Error(toolsText('tools.captions.error.sourcesRequired'));
    if (parsed.narration) {
      return await runNarrationCaptions({ projectRoot, edit, parsed, stdout, stderr });
    }
    if (!Array.isArray(edit.sources)) throw new Error(toolsText('tools.captions.error.sourcesMissing'));
    if (!edit.sources.length) throw new Error(toolsText('tools.captions.error.sourcesMissing'));
    let source;
    if (parsed.source === undefined) {
      if (edit.sources.length !== 1) throw new Error(toolsText('tools.captions.error.sourceRequired', { sources: edit.sources.map((item) => item.id).join(", ") }));
      source = edit.sources[0];
    } else {
      source = edit.sources.find((item) => item.id === parsed.source)
        ?? edit.sources.find((item) => path.resolve(projectRoot, item.path) === path.resolve(projectRoot, parsed.source));
    }
    if (!source) throw new Error(toolsText('tools.captions.error.sourceMissing', { source: parsed.source }));
    const projectRelative = toPosix(path.relative(projectRoot, path.resolve(projectRoot, source.path)));
    if (projectRelative === ".." || projectRelative.startsWith("../") || path.isAbsolute(projectRelative)) {
      throw new Error(toolsText('tools.captions.error.sourceOutside'));
    }
    const analysisPath = analysisPathForTarget({ projectRoot, projectRelative });
    let analysis;
    try {
      analysis = JSON.parse(await readFile(analysisPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (parsed.retime) analysis = {};
      else throw new Error(toolsText('tools.captions.error.transcriptMissing'));
    }
    const captionsPath = path.join(projectRoot, "captions.json");
    let existing;
    try {
      existing = JSON.parse(await readFile(captionsPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const records = Array.isArray(existing) ? existing : existing?.captions ?? [];
    if (parsed.retime) {
      if (!existing || !records.length) throw new Error(toolsText('tools.captions.error.noRetimeCaptions'));
      const inputPath = path.resolve(projectRoot, source.path);
      const storedSilences = await readStoredSilences(analysis, analysisPath);
      let duration = Number(options.duration ?? analysis.probe?.duration_s);
      let silences = storedSilences;
      if (!Number.isFinite(duration) || duration <= 0) {
        const { ffprobe } = resolveTools(options);
        duration = probeRaw(inputPath, ffprobe, options).duration;
      }
      if (!silences) {
        const { ffmpeg } = resolveTools(options);
        const runner = options.silencesRunner ?? runSilenceDetect;
        const detected = await runner({ inputPath, range: { in: 0, out: duration }, ffmpeg,
          silenceDb: UNRECOGNIZED_DEFAULTS.silenceDb, silenceMinSec: UNRECOGNIZED_DEFAULTS.silenceMinSec, options });
        silences = Array.isArray(detected) ? detected : detected?.silences ?? [];
      }
      const retimed = retimeCaptionsToSpeech(records, { silences, duration, source: source.id });
      const root = Array.isArray(existing) ? retimed.captions : { ...existing, captions: retimed.captions };
      const summary = { retime: true, moved_words: retimed.moved, total_words: retimed.total,
        fitted_words: retimed.fitted_words, clamped_pairs: retimed.clamped_pairs,
        overlaps_left: retimed.overlaps_left, path: captionsPath };
      if (parsed.dryRun && parsed.json) stdout(JSON.stringify({ dry_run: true, ...summary }));
      else if (parsed.dryRun) {
        stdout(JSON.stringify(root, null, 2));
        stdout(JSON.stringify(summary));
      } else {
        await writeProjectFilesGuarded(projectRoot, { "captions.json": `${JSON.stringify(root, null, 2)}\n` });
        stdout(JSON.stringify(summary));
      }
      return 0;
    }
    if (!Array.isArray(analysis.transcript) || !analysis.transcript.length) throw new Error(toolsText('tools.captions.error.noSpeech'));
    const { language } = await readContentLanguage(projectRoot, {
      cliLang: parsed.lang ?? existing?.display_policy?.locale,
    });
    const defaults = captionLanguageDefaults(language);
    const result = buildCaptionsFromTranscript(analysis.transcript, {
      ...parsed, lang: language, maxCharacters: parsed.maxCharacters ?? defaults.landscapeCharacters,
      src: source.id, sourceDurationSeconds: Number.isFinite(analysis.probe?.duration_s) ? analysis.probe.duration_s : null,
    });
    const wordBook = { applied: 0 };
    if (!parsed.noWordBook) {
      const resolved = await resolveWordBook({ projectRoot, env: options.env ?? process.env, extraPath: parsed.wordBook });
      if (resolved.entries.length) {
        const applied = applyWordBook(result.captions, buildMatcher(resolved.entries), { mode: "captions" });
        wordBook.applied = applied.records.filter((record, index) => record.text !== result.captions[index].text).length;
        result.captions = applied.records;
      }
    }
    const root = {};
    for (const field of ["default_text_style", "display_policy", "emphasis_words"]) {
      if (existing && !Array.isArray(existing) && Object.hasOwn(existing, field)) root[field] = existing[field];
    }
    if (root.display_policy) {
      if (normalizeLanguage(root.display_policy.locale) !== language) {
        root.display_policy = { ...root.display_policy, locale: language };
      }
    } else if (language !== 'ja') {
      root.display_policy = {
        mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
        unit_metric: 'ascii-half-other-one-v1',
        max_line_units: defaults.landscapeCharacters / 2,
        minimum_fragment_duration_seconds: defaults.minimumSeconds,
        locale: language,
      };
    }
    const merged = mergeCaptionsForApply(records, result.captions, { force: parsed.force, src: source.id });
    root.captions = merged.captions;
    const content = `${JSON.stringify(root, null, 2)}\n`;
    const summary = { ...merged.summary, captions: merged.summary.total, warnings: result.warnings, path: captionsPath, word_book: wordBook };
    if (parsed.dryRun && parsed.json) stdout(JSON.stringify({ dry_run: true, ...summary }));
    else if (parsed.dryRun) stdout(JSON.stringify({ ...root, word_book: wordBook }, null, 2));
    else await writeProjectFilesGuarded(projectRoot, { "captions.json": content });
    if (!edit.tracks?.some((track) => track.items?.some((item) => item.source?.kind === "captions"))) {
      stderr(toolsText('tools.captions.warning.trackMissing'));
    }
    if (!(parsed.dryRun && parsed.json)) stdout(JSON.stringify(summary));
    return 0;
  } catch (error) {
    stderr(error?.code === 'AKARI_WRITE_CONFLICT' ? toolsText('tools.captions.error.writeConflict')
      : error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parseOptions(argv) {
  const parsed = {};
  const values = { "--source": "source", "--lang": "lang", "--readout": "readoutSeconds", "--min-duration": "minDurationSeconds", "--max-chars": "maxCharacters", "--split": "splitMode", "--max-seconds": "maxSeconds", "--pause": "pauseSeconds", "--word-book": "wordBook" };
  const booleans = { "--no-word-book": "noWordBook", "--force": "force", "--dry-run": "dryRun", "--json": "json", "--retime": "retime", "--narration": "narration" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (Object.hasOwn(booleans, argument)) parsed[booleans[argument]] = true;
    else if (Object.hasOwn(values, argument)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--") || !value.trim()) throw new Error(toolsText('tools.captions.error.valueRequired', { option: argument }));
      parsed[values[argument]] = ["--source", "--lang", "--split", "--word-book"].includes(argument) ? value : Number(value);
    } else throw new Error(toolsText('tools.captions.error.unknownOption', { option: argument }));
  }
  return parsed;
}

class NarrationSkip extends Error {}

function retainedCaptionRoot(existing, language, defaults) {
  const root = {};
  for (const field of ["default_text_style", "display_policy", "emphasis_words"]) {
    if (existing && !Array.isArray(existing) && Object.hasOwn(existing, field)) root[field] = existing[field];
  }
  if (root.display_policy) {
    if (normalizeLanguage(root.display_policy.locale) !== language) {
      root.display_policy = { ...root.display_policy, locale: language };
    }
  } else if (language !== 'ja') {
    root.display_policy = {
      mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
      unit_metric: 'ascii-half-other-one-v1',
      max_line_units: defaults.landscapeCharacters / 2,
      minimum_fragment_duration_seconds: defaults.minimumSeconds,
      locale: language,
    };
  }
  return root;
}

async function readNarrationTiming({ projectRoot, projectRelative, absolutePath }) {
  const target = { projectRoot, projectRelative };
  const analysisPath = analysisPathForTarget(target);
  if (analysisPath) {
    try {
      const analysis = JSON.parse(await readFile(analysisPath, "utf8"));
      if (Array.isArray(analysis?.transcript) && analysis.transcript.length) {
        return { segments: analysis.transcript, source: "analysis" };
      }
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    const transcriptsDirectory = transcriptsDirForTarget(target);
    const names = await readdir(transcriptsDirectory)
      .catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
    const files = names.filter((name) => name.endsWith(".json") && !name.includes(".tmp-")).sort().reverse();
    for (const name of files) {
      try {
        const value = JSON.parse(await readFile(path.join(transcriptsDirectory, name), "utf8"));
        if (Array.isArray(value?.segments) && value.segments.length) {
          return { segments: value.segments, source: "transcripts" };
        }
      } catch (error) {
        if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
    }
  }
  const cacheDirectory = path.join(projectRoot, ".akari", "cache", "transcribe");
  if (existsSync(cacheDirectory)) {
    const sha256 = await sha256File(absolutePath);
    const names = await readdir(cacheDirectory);
    const candidates = [];
    for (const name of names.filter((value) => value.startsWith(`${sha256}-`) && value.endsWith(".json"))) {
      try {
        const value = JSON.parse(await readFile(path.join(cacheDirectory, name), "utf8"));
        if (Array.isArray(value?.segments) && value.segments.length) candidates.push({ name, value });
      } catch (error) {
        if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
    }
    candidates.sort((a, b) => Number(a.value?.range?.in ?? 0) - Number(b.value?.range?.in ?? 0)
      || Number(b.value?.range?.out ?? 0) - Number(a.value?.range?.out ?? 0)
      || String(b.value?.generated_at ?? "").localeCompare(String(a.value?.generated_at ?? "")));
    if (candidates.length) return { segments: candidates[0].value.segments, source: "cache" };
  }
  return { segments: [], source: null };
}

async function runNarrationCaptions({ projectRoot, edit, parsed, stdout, stderr }) {
  const items = Array.isArray(edit.audio?.narration) ? edit.audio.narration : [];
  if (!items.length) throw new Error(toolsText('tools.captions.error.narrationMissing'));
  const captionsPath = path.join(projectRoot, "captions.json");
  let existing;
  try {
    existing = JSON.parse(await readFile(captionsPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const records = Array.isArray(existing) ? existing : existing?.captions ?? [];
  const { language } = await readContentLanguage(projectRoot, {
    cliLang: parsed.lang ?? existing?.display_policy?.locale,
  });
  const defaults = captionLanguageDefaults(language);
  const root = retainedCaptionRoot(existing, language, defaults);
  const buildOptions = {
    lang: language,
    maxCharacters: parsed.maxCharacters ?? defaults.landscapeCharacters,
    ...(parsed.readoutSeconds !== undefined ? { readoutSeconds: parsed.readoutSeconds } : {}),
    ...(parsed.minDurationSeconds !== undefined ? { minDurationSeconds: parsed.minDurationSeconds } : {}),
    ...(parsed.splitMode !== undefined ? { splitMode: parsed.splitMode } : {}),
    ...(parsed.maxSeconds !== undefined ? { maxSeconds: parsed.maxSeconds } : {}),
    ...(parsed.pauseSeconds !== undefined ? { pauseSeconds: parsed.pauseSeconds } : {}),
  };
  const groups = [];
  const narrations = [];
  const warnings = [];
  const successfulSegments = new Set();
  let failures = 0;
  let idStart = 1;
  for (const [itemIndex, item] of items.entries()) {
    const id = typeof item?.id === "string" ? item.id : "(unknown)";
    const audioPath = typeof item?.path === "string" ? item.path : "";
    try {
      if (typeof item?.script !== "string" || !item.script.trim()) {
        throw new NarrationSkip(toolsText('tools.captions.error.narrationScriptMissing', { id }));
      }
      if (!Number.isFinite(item.t) || item.t < 0) {
        throw new NarrationSkip(toolsText('tools.captions.error.narrationInvalidOffset', { id }));
      }
      if (!audioPath.trim()) {
        throw new NarrationSkip(toolsText('tools.captions.error.narrationAudioMissing', { id, path: audioPath }));
      }
      const absolutePath = path.resolve(projectRoot, audioPath);
      const projectRelative = toPosix(path.relative(projectRoot, absolutePath));
      if (projectRelative === ".." || projectRelative.startsWith("../") || path.isAbsolute(projectRelative)) {
        throw new NarrationSkip(toolsText('tools.captions.error.narrationOutside', { id }));
      }
      if (!existsSync(absolutePath)) {
        throw new NarrationSkip(toolsText('tools.captions.error.narrationAudioMissing', { id, path: audioPath }));
      }
      const timing = await readNarrationTiming({ projectRoot, projectRelative, absolutePath });
      if (!timing.segments.length) {
        throw new NarrationSkip(toolsText('tools.captions.error.narrationTimingMissing', { id, path: audioPath }));
      }
      const built = buildCaptionsFromNarration(item.script, timing.segments, {
        ...buildOptions, t: item.t, idStart, segmentOffset: itemIndex,
      });
      if (!built.captions.length) {
        throw new NarrationSkip(toolsText('tools.captions.error.narrationNoCaptions', { id }));
      }
      groups.push(...built.captions);
      successfulSegments.add(itemIndex);
      narrations.push({
        id, captions: built.captions.length, interpolated: built.interpolated,
        timing_source: timing.source, offset_seconds: item.t,
      });
      warnings.push(...built.warnings);
      idStart += built.captions.length;
    } catch (error) {
      if (!(error instanceof NarrationSkip) && !(error instanceof NarrationAlignmentError)) throw error;
      stderr(error instanceof NarrationAlignmentError
        ? toolsText('tools.captions.error.narrationAlignmentFailed', { id })
        : error.message);
      failures += 1;
    }
  }
  if (!groups.length) return 1;
  const merged = mergeCaptionsForApply(records, groups, {
    force: parsed.force,
    target: (row) => row?.time_domain === "output"
      && (row?.src === undefined || row?.src === null || row?.src === "")
      && successfulSegments.has(row?.sourceRef?.segment),
  });
  const mergedRows = merged.captions;
  const totals = { ...merged.summary };
  const ids = totals.ids;
  delete totals.total;
  delete totals.ids;
  const rootOut = { ...root, captions: mergedRows };
  const summary = {
    ...totals, total: mergedRows.length, ids, captions: mergedRows.length, warnings,
    path: captionsPath, word_book: { applied: 0 }, narrations,
    interpolated: narrations.reduce((sum, item) => sum + item.interpolated, 0),
  };
  if (parsed.dryRun && parsed.json) stdout(JSON.stringify({ dry_run: true, ...summary }));
  else if (parsed.dryRun) {
    stdout(JSON.stringify({ ...rootOut, word_book: summary.word_book }, null, 2));
    stdout(JSON.stringify(summary));
  } else {
    await writeProjectFilesGuarded(projectRoot, { "captions.json": `${JSON.stringify(rootOut, null, 2)}\n` });
  }
  if (!edit.tracks?.some((track) => track.items?.some((item) => item.source?.kind === "captions"))) {
    stderr(toolsText('tools.captions.warning.trackMissing'));
  }
  if (!(parsed.dryRun && parsed.json)) stdout(JSON.stringify(summary));
  return failures ? 1 : 0;
}

async function readStoredSilences(analysis, analysisPath) {
  if (Array.isArray(analysis?.timing_snap?.silences)) return analysis.timing_snap.silences;
  const observations = Array.isArray(analysis?.observations) ? analysis.observations : [];
  for (const observation of observations.toReversed()) {
    if (observation?.kind === "transcribe" && Array.isArray(observation?.args?.timing_snap?.silences)) {
      return observation.args.timing_snap.silences;
    }
  }
  const directory = path.join(path.dirname(analysisPath), "transcripts");
  const names = await readdir(directory).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
  for (const name of names.filter((value) => value.endsWith(".json")).sort().reverse()) {
    const transcript = JSON.parse(await readFile(path.join(directory, name), "utf8"));
    if (Array.isArray(transcript?.timing_snap?.silences)) return transcript.timing_snap.silences;
  }
  return null;
}

if (isMainModule(import.meta.url)) process.exitCode = await runCaptionsCli(process.argv.slice(2));
