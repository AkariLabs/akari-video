import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveFfmpeg, resolveFfprobe } from "../../../media-bin/src/index.mjs";
import { runWordBookCli } from "../../../akari-tools/bin/word-book.mjs";
import { transcribeMedia } from "../../../akari-tools/src/media/transcribe.mjs";
import { writeWordBookFile } from "../../src/index.mjs";

const evidenceDirectory = path.dirname(fileURLToPath(import.meta.url));
const resultsPath = path.join(evidenceDirectory, "results.json");
const temporary = await mkdtemp(path.join(os.tmpdir(), "akari-word-book-evidence-"));
const checks = [];

try {
  const creatorRoot = path.join(temporary, "creator");
  const projectRoot = path.join(creatorRoot, "channels", "c", "videos", "p");
  const env = {
    HOME: path.join(temporary, "home"),
    AKARI_HOME: path.join(temporary, "machine"),
    AKARI_CREATOR_ROOT: creatorRoot,
  };
  await mkdir(path.join(creatorRoot, ".akari", "memory"), { recursive: true });
  await mkdir(path.join(projectRoot, ".akari", "memory"), { recursive: true });
  await mkdir(path.join(projectRoot, "assets"), { recursive: true });
  await writeFile(path.join(creatorRoot, ".akari", "root.json"), JSON.stringify({ schema: "creator-root/v1" }));

  await writeWordBookFile(path.join(creatorRoot, ".akari", "memory", "word-book.json"), {
    version: 0,
    entries: [{ surface: "AKARI Video", variants: ["あかりビデオ"], kind: "term", protect_break: false }],
  });
  await writeWordBookFile(path.join(creatorRoot, "channels", "c", ".akari", "memory", "word-book.json"), {
    version: 0,
    entries: [{ surface: "AKARI Video", variants: ["あかりビデオ"], kind: "term", protect_break: true }],
  });
  await writeWordBookFile(path.join(projectRoot, ".akari", "memory", "word-book.json"), {
    version: 0,
    entries: [{ surface: "動画", variants: ["ムービー"], kind: "notation" }],
  });

  const ffmpeg = resolveFfmpeg();
  const ffprobe = resolveFfprobe();
  const mediaPath = path.join(projectRoot, "assets", "input.wav");
  execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=2",
    "-ac", "1", "-c:a", "pcm_s16le", mediaPath,
  ]);
  const backendSegments = [
    {
      start: 0, end: 1.7, text: "あかり ビデオを紹介",
      words: [
        { start: 0, end: 0.4, text: "あかり" },
        { start: 0.4, end: 0.9, text: "ビデオ" },
        { start: 1, end: 1.2, text: "を" },
        { start: 1.2, end: 1.7, text: "紹介" },
      ],
    },
    {
      start: 1.7, end: 2, text: "しん ご",
      words: [{ start: 1.7, end: 1.85, text: "しん" }, { start: 1.85, end: 2, text: "ご" }],
    },
  ];
  const transcribeOptions = {
    cwd: projectRoot,
    env,
    ffmpegCommand: ffmpeg,
    ffprobeCommand: ffprobe,
    backend: "speech-analyzer",
    speechAnalyzerAvailable: true,
    unrecognized: false,
    stderr: () => {},
    now: new Date("2026-09-02T00:00:00.000Z"),
    backendRunner: async () => structuredClone(backendSegments),
  };
  const first = await transcribeMedia("assets/input.wav", transcribeOptions);
  const analysisPath = path.join(projectRoot, ".akari", "sidecars", "assets", "input.wav.analysis", "analysis.json");
  const analysisAfterFirst = readFileSync(analysisPath, "utf8");
  const analysis = JSON.parse(analysisAfterFirst);
  check("transcript_word_collapsed", analysis.transcript[0].words[0], { start: 0, end: 0.9, text: "AKARI Video" });
  check("transcript_text_replaced", analysis.transcript[0].text, "AKARI Videoを紹介");

  const cachePath = path.join(projectRoot, ".akari", "cache", "transcribe", `${first.cache.key}.json`);
  const cached = JSON.parse(readFileSync(cachePath, "utf8"));
  check("cache_text_is_raw", cached.segments[0].text, "あかり ビデオを紹介");
  check("cache_words_are_raw", cached.segments[0].words.map((word) => word.text), ["あかり", "ビデオ", "を", "紹介"]);

  const second = await transcribeMedia("assets/input.wav", {
    ...transcribeOptions,
    noRecord: true,
    backendRunner: async () => { throw new Error("cache hit で backend を呼んではならない"); },
  });
  check("second_transcribe_cache_hit", second.cache.hit, true);
  check("cache_hit_analysis_byte_identical", readFileSync(analysisPath, "utf8") === analysisAfterFirst, true);

  const resolveOutput = captureIo();
  assert.equal(await runWordBookCli(["resolve", "--project", projectRoot, "--json"], { ...resolveOutput, env }), 0);
  const resolved = JSON.parse(resolveOutput.lines[0]);
  check("resolve_channel_wins", resolved.sources["AKARI Video"], "channel");

  const addOutput = captureIo();
  assert.equal(await runWordBookCli([
    "add", "--surface", "新語", "--variant", "しんご", "--scope", "channel", "--project", projectRoot,
  ], { ...addOutput, env }), 0);
  const channelBook = JSON.parse(readFileSync(path.join(creatorRoot, "channels", "c", ".akari", "memory", "word-book.json"), "utf8"));
  check("add_channel_entry", channelBook.entries.some((entry) => entry.surface === "新語"), true);

  const applyOutput = captureIo();
  assert.equal(await runWordBookCli(["apply", "--project", projectRoot, "--json"], { ...applyOutput, env }), 0);
  const afterApply = JSON.parse(readFileSync(analysisPath, "utf8"));
  check("apply_added_term", afterApply.transcript[1].words[0], { start: 1.7, end: 2, text: "新語" });
  check("apply_added_term_text", afterApply.transcript[1].text, "新語");

  await writeFile(resultsPath, `${JSON.stringify({
    status: "PASS",
    checks,
    observed: {
      replaced_word: analysis.transcript[0].words[0],
      cache_hit: second.cache.hit,
      source_scope: resolved.sources["AKARI Video"],
      apply_replaced: JSON.parse(applyOutput.lines[0]).analysis.stats.replaced,
    },
  }, null, 2)}\n`);
} catch (error) {
  await writeFile(resultsPath, `${JSON.stringify({
    status: "FAIL",
    checks,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`);
  throw error;
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function check(name, actual, expected) {
  assert.deepEqual(actual, expected);
  checks.push({ name, pass: true, actual });
}

function captureIo() {
  const lines = [];
  const errors = [];
  return { lines, errors, stdout: (line) => lines.push(line), stderr: (line) => errors.push(line) };
}
