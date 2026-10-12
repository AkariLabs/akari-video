import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { transcribeMedia, whisperDtwPreset } from "../src/media/transcribe.mjs";
import { UNRECOGNIZED_ALGO_VERSION } from "../src/media/unrecognized-spans.mjs";
import { fixture, json, putJson } from "./fixtures/transcribe-compare/helpers.mjs";

const gapSegments = () => [{
  start: 0, end: 4, text: "前中後",
  words: [
    { start: 0, end: 0.5, text: "前" },
    { start: 1, end: 1.5, text: "中" },
    { start: 2.5, end: 4, text: "後" },
  ],
}];
const speechOptions = (f) => ({
  ...f.options, backend: "speech-analyzer", speechAnalyzerAvailable: true, wordBook: false,
  silencesRunner: async () => [], backendRunner: async () => gapSegments(),
});
const cacheDirectory = (f) => path.join(f.project, ".akari/cache/transcribe");
const transcriptPath = (f, backend = "speech-analyzer") => path.join(f.directory, "transcripts", `${backend}.json`);
const spanCount = (result) => result.segments.reduce((count, segment) => count + (segment.unrecognized?.length ?? 0), 0);

test("whisper model 名から DTW preset を詳細モデル優先で選ぶ", () => {
  assert.equal(whisperDtwPreset("ggml-large-v3-turbo-q5_0.bin"), "large.v3.turbo");
  assert.equal(whisperDtwPreset("ggml-large-v3.bin"), "large.v3");
  for (const name of ["medium", "small", "base", "tiny"]) assert.equal(whisperDtwPreset(`ggml-${name}.bin`), name);
  assert.equal(whisperDtwPreset("ggml-large-v2.bin"), null);
});

test("whisper cache key versions only explicitly requested spaced-word languages", async (t) => {
  const f = await fixture(t, []);
  const common = { ...f.options, backend: "whisper-cpp", whisperBin: "fixture-whisper", whisperModel: "fixture-model",
    backendRunner: async () => [], noRecord: true, wordBook: false, unrecognized: false, snap: false };
  const keys = new Map();
  for (const lang of ["en", "en-US", "de", "ja", "ja-JP", "zh", "zh-CN", "auto", "und", "unknown", "zz"]) {
    const result = await transcribeMedia(f.target, { ...common, lang });
    keys.set(lang, result.cache.key);
  }
  assert.match(keys.get("en"), /-whisper-cpp-en-mixed-v3-words3$/u);
  assert.equal(keys.get("en-US"), keys.get("en"));
  assert.match(keys.get("de"), /-whisper-cpp-de-mixed-v3-words3$/u);
  for (const lang of ["ja", "zh", "auto", "und", "unknown", "zz"]) assert.doesNotMatch(keys.get(lang), /-words3$/u);
  assert.equal(keys.get("ja-JP"), keys.get("ja"));
  assert.equal(keys.get("zh-CN"), keys.get("zh"));
  const prompted = await transcribeMedia(f.target, { ...common, lang: "en", whisperPrompt: true });
  assert.match(prompted.cache.key, /-whisper-cpp-en-mixed-v3-filler-prompt-words3$/u);
  const speech = await transcribeMedia(f.target, { ...speechOptions(f), lang: "en", noRecord: true });
  assert.doesNotMatch(speech.cache.key, /-words3$/u);
});

for (const rejectsDtw of [false, true]) {
  test(`whisper-cli は -dtw を${rejectsDtw ? "拒否時だけ外して再実行する" : "モデル preset 付きで実行する"}`, async (t) => {
    const f = await fixture(t, []);
    const whisperCalls = [];
    const spawn = (command, args) => {
      if (command === "fixture-ffprobe") return { status: 0, stdout: JSON.stringify({ format: { duration: "30" }, streams: [{ codec_type: "audio" }] }), stderr: "" };
      if (command === "fixture-ffmpeg") return { status: 0, stdout: "", stderr: "" };
      whisperCalls.push(args);
      if (rejectsDtw && whisperCalls.length === 1) return { status: 1, stdout: "", stderr: "unknown argument: -dtw" };
      const prefix = args[args.indexOf("-of") + 1];
      writeFileSync(`${prefix}.json`, JSON.stringify({ transcription: [{ offsets: { from: 0, to: 30000 }, text: "語",
        tokens: [{ offsets: { from: 0, to: 30000 }, text: "語" }] }] }));
      return { status: 0, stdout: "", stderr: "" };
    };
    const result = await transcribeMedia(f.target, { ...f.options, spawn, backend: "whisper-cpp", wordBook: false,
      whisperBin: "fixture-whisper", whisperModel: "ggml-large-v3-turbo-q5_0.bin", unrecognized: false,
      silencesRunner: async () => [], stderr: () => {},
    });
    assert.deepEqual(whisperCalls[0].slice(-2), ["-dtw", "large.v3.turbo"]);
    assert.ok(whisperCalls.every((args) => !args.includes("-sow")));
    assert.equal(whisperCalls.length, rejectsDtw ? 2 : 1);
    if (rejectsDtw) assert.equal(whisperCalls[1].includes("-dtw"), false);
    assert.equal(result.timing_snap.dtw, !rejectsDtw);
  });
}

test("whisper は抜けの言語が変わったときだけ起こし直して差し込む", async (t) => {
  const segment = (from, to, text) => ({ offsets: { from, to }, text,
    tokens: [{ offsets: { from, to }, text }] });
  const run = async (initial, detectedLanguage, recovered = [], recoveredLanguage = "en", detectProbability = 0.99, uiLanguage = "ja") => {
    const f = await fixture(t, []);
    const whisperCalls = [];
    const fullCalls = [];
    const cuts = [];
    const backendLogs = [];
    let silenceCalls = 0;
    const spawn = (command, args) => {
      if (command === "fixture-ffprobe") return { status: 0, stdout: JSON.stringify({ format: { duration: "30" }, streams: [{ codec_type: "audio" }] }), stderr: "" };
      if (command === "fixture-ffmpeg") {
        if (args.includes("-ss") && args[args.indexOf("-i") + 1] !== path.join(f.project, f.target)) cuts.push(args);
        return { status: 0, stdout: "", stderr: "" };
      }
      whisperCalls.push(args);
      const prefix = args[args.indexOf("-of") + 1];
      if (args.includes("-dl")) {
        writeFileSync(`${prefix}.json`, JSON.stringify({ result: { language: detectedLanguage }, transcription: [] }));
        return { status: 0, stdout: "", stderr: detectedLanguage === null ? "" : detectProbability === null
          ? `whisper_full_with_state: auto-detected language: ${detectedLanguage}`
          : `whisper_full_with_state: auto-detected language: ${detectedLanguage} (p = ${detectProbability})` };
      } else {
        fullCalls.push(args);
        writeFileSync(`${prefix}.json`, JSON.stringify({ result: { language: fullCalls.length === 1 ? "ja" : recoveredLanguage },
          transcription: fullCalls.length === 1 ? initial : recovered[fullCalls.length - 2] ?? [] }));
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const result = await transcribeMedia(f.target, { ...f.options, spawn, backend: "whisper-cpp", wordBook: false,
      whisperBin: "fixture-whisper", whisperModel: "ggml-base.bin", unrecognized: false, snap: false,
      silencesRunner: async () => { silenceCalls += 1; return []; }, uiLanguage,
      stderr: (message) => backendLogs.push(message),
    });
    return { result, whisperCalls, fullCalls, cuts, silenceCalls, backendLogs };
  };
  const initial = [segment(0, 2000, "前"), segment(8000, 10000, "中"), segment(16000, 30000, "後")];
  const sameLanguage = await run([segment(0, 1000, "前")], "ja", [[segment(1200, 3200, "幻聴")]]);
  assert.equal(sameLanguage.fullCalls.length, 1);
  assert.equal(sameLanguage.whisperCalls.length, 2);
  assert.equal(sameLanguage.whisperCalls[1].includes("-dl"), true);
  assert.deepEqual(sameLanguage.result.segments.map(({ text }) => text), ["前"]);

  const unknownLanguage = await run([segment(0, 1000, "前")], null);
  assert.equal(unknownLanguage.fullCalls.length, 1);
  assert.deepEqual(unknownLanguage.result.segments.map(({ text }) => text), ["前"]);

  const lowProbability = await run([segment(0, 1000, "前")], "en", [[segment(1200, 3200, "幻聴")]], "en", 0.93);
  assert.equal(lowProbability.fullCalls.length, 1);
  assert.deepEqual(lowProbability.result.segments.map(({ text }) => text), ["前"]);
  assert.ok(lowProbability.backendLogs.some((line) => /言語切替区間 1（\d+\.\d{2}〜\d+\.\d{2} 秒）: 判定した言語=en, p=0\.930, 1 回目の言語=ja, 起こし直さない（p が 0\.95 未満）/u.test(line)));

  const englishLog = await run([segment(0, 1000, "前")], "en", [[segment(1200, 3200, "Hello")]], "en", 0.93, "en");
  assert.ok(englishLog.backendLogs.some((line) => /Language-switch gap 1 .*detected language=en, p=0\.930.*skip retry \(p below 0\.95\)/u.test(line)));

  const missingProbability = await run([segment(0, 1000, "前")], "en", [[segment(1200, 3200, "幻聴")]], "en", null);
  assert.equal(missingProbability.fullCalls.length, 1);
  assert.deepEqual(missingProbability.result.segments.map(({ text }) => text), ["前"]);

  const withGaps = await run(initial, "en", [
    [segment(1200, 3200, "Hello")], [segment(1200, 3200, "world")],
  ]);
  assert.equal(withGaps.silenceCalls, 1);
  assert.equal(withGaps.whisperCalls.length, 5);
  assert.equal(withGaps.fullCalls.length, 3);
  assert.equal(withGaps.cuts.length, 2);
  assert.deepEqual(withGaps.result.segments.map(({ start, text }) => [start, text]),
    [[0, "前"], [3, "Hello"], [8, "中"], [11, "world"], [16, "後"]]);
  for (const args of withGaps.whisperCalls.slice(1)) {
    assert.equal(args[args.indexOf("-l") + 1], "auto");
    assert.equal(path.basename(args[args.indexOf("-f") + 1]), "input.wav");
  }
  assert.equal(withGaps.whisperCalls.filter((args) => args.includes("-dl")).length, 2);
  assert.ok(withGaps.whisperCalls.filter((args) => args.includes("-dl")).every((args) => !args.includes("-dtw")));
  assert.notEqual(withGaps.fullCalls[1][withGaps.fullCalls[1].indexOf("-f") + 1],
    withGaps.fullCalls[2][withGaps.fullCalls[2].indexOf("-f") + 1]);

  const rejected = await run([segment(0, 1000, "前")], "en", [[segment(1200, 3200, "幻聴")]], "ja");
  assert.equal(rejected.fullCalls.length, 2);
  assert.deepEqual(rejected.result.segments.map(({ text }) => text), ["前"]);
  assert.ok(rejected.backendLogs.some((line) => line.includes("起こし直した言語=ja は 1 回目の言語と同じため差し込みません")));

  const withoutGaps = await run([segment(0, 30000, "全体")], "en");
  assert.equal(withoutGaps.whisperCalls.length, 1);
  assert.equal(withoutGaps.silenceCalls, 0);
  assert.equal(withoutGaps.cuts.length, 0);
  const empty = await run([], "en");
  assert.equal(empty.whisperCalls.length, 1);
  assert.equal(empty.silenceCalls, 1);
  assert.equal(empty.cuts.length, 0);
});

test("intake と --lang auto は言語切替を再判定し、明示した具体的な言語は再判定しない", async (t) => {
  const f = await fixture(t, []);
  await writeFile(path.join(f.project, ".akari/intake.json"), JSON.stringify({ language: "ja" }));
  const segment = (from, to, text) => ({ offsets: { from, to }, text,
    tokens: [{ offsets: { from, to }, text }] });
  const initial = [segment(0, 2000, "前"), segment(8000, 30000, "後")];
  let detectCalls = 0;
  const fullCalls = [];
  const spawn = (command, args) => {
    if (command === "fixture-ffprobe") return { status: 0,
      stdout: JSON.stringify({ format: { duration: "30" }, streams: [{ codec_type: "audio" }] }), stderr: "" };
    if (command === "fixture-ffmpeg") return { status: 0, stdout: "", stderr: "" };
    const prefix = args[args.indexOf("-of") + 1];
    if (args.includes("-dl")) {
      detectCalls += 1;
      writeFileSync(`${prefix}.json`, JSON.stringify({ result: { language: "en" }, transcription: [] }));
      return { status: 0, stdout: "", stderr: "auto-detected language: en (p = 0.990)" };
    }
    fullCalls.push(args);
    writeFileSync(`${prefix}.json`, JSON.stringify({ result: { language: args[args.indexOf("-l") + 1] === "ja" ? "ja" : "en" },
      transcription: args[args.indexOf("-l") + 1] === "ja" ? initial : [segment(1200, 3200, "Hello")] }));
    return { status: 0, stdout: "", stderr: "" };
  };
  const common = { ...f.options, spawn, backend: "whisper-cpp", whisperBin: "fixture-whisper",
    whisperModel: "ggml-base.bin", wordBook: false, unrecognized: false, snap: false,
    silencesRunner: async () => [], noRecord: true, uiLanguage: "ja" };
  const intake = await transcribeMedia(f.target, common);
  assert.equal(fullCalls[0][fullCalls[0].indexOf("-l") + 1], "ja");
  assert.ok(fullCalls.some(args => args[args.indexOf("-l") + 1] === "auto"));
  assert.ok(detectCalls > 0);
  assert.deepEqual(intake.segments.map(({ text }) => text), ["前", "Hello", "後"]);
  assert.match(intake.cache.key, /-whisper-cpp-ja-mixed-v3-intake-gaps-v1$/u);

  const autoFixture = await fixture(t, []);
  await writeFile(path.join(autoFixture.project, ".akari/intake.json"), JSON.stringify({ language: "ja" }));
  const beforeAuto = { full: fullCalls.length, detect: detectCalls };
  const auto = await transcribeMedia(autoFixture.target, { ...common, cwd: autoFixture.project, lang: "auto" });
  assert.equal(auto.cache.hit, false);
  assert.equal(auto.cache.key, intake.cache.key);
  assert.equal(fullCalls[beforeAuto.full][fullCalls[beforeAuto.full].indexOf("-l") + 1], "ja");
  assert.ok(detectCalls > beforeAuto.detect);
  assert.deepEqual(auto.segments.map(({ text }) => text), ["前", "Hello", "後"]);
  const inferred = await transcribeMedia(autoFixture.target, { ...common, cwd: autoFixture.project });
  assert.equal(inferred.cache.hit, true);
  assert.equal(inferred.cache.key, auto.cache.key);

  const beforeExplicit = { full: fullCalls.length, detect: detectCalls };
  const explicit = await transcribeMedia(f.target, { ...common, lang: "ja" });
  assert.equal(explicit.cache.hit, false);
  assert.equal(fullCalls.length, beforeExplicit.full + 1);
  assert.equal(detectCalls, beforeExplicit.detect);
  assert.deepEqual(explicit.segments.map(({ text }) => text), ["前", "後"]);
  assert.notEqual(explicit.cache.key, intake.cache.key);
  assert.match(explicit.cache.key, /-whisper-cpp-ja-mixed-v3$/u);
  assert.equal((await transcribeMedia(f.target, common)).cache.hit, true);
  assert.equal((await transcribeMedia(f.target, { ...common, lang: "ja" })).cache.hit, true);
});

test("全 backend 共通で既定吸着し、snap/timingSnap false は吸着を飛ばす", async (t) => {
  const f = await fixture(t, []);
  const options = { ...speechOptions(f), unrecognized: false,
    silencesRunner: async () => [{ start: 1, end: 3 }],
    backendRunner: async () => [{ start: 0, end: 4, text: "前後", words: [
      { start: 0.2, end: 0.8, text: "前" }, { start: 1.2, end: 2, text: "後" },
    ] }],
  };
  const snapped = await transcribeMedia(f.target, { ...options, lang: "snap" });
  assert.equal(snapped.segments[0].words[1].start, 3);
  assert.deepEqual(snapped.segments[0].words[1], { start: 3, end: 3.05, text: "後", raw_start: 1.2, raw_end: 2 });
  assert.deepEqual(snapped.timing_snap.method, "silencedetect");
  const recordedTimingSnap = (await json(transcriptPath(f))).timing_snap;
  assert.equal(recordedTimingSnap.moved_words, 1);
  assert.equal(recordedTimingSnap.clamped_pairs, 0);
  assert.equal(recordedTimingSnap.overlaps_left, 0);
  const observedTimingSnap = (await json(path.join(f.directory, "analysis.json"))).observations.at(-1).args.timing_snap;
  assert.equal(observedTimingSnap.moved_words, 1);
  assert.equal(observedTimingSnap.clamped_pairs, 0);
  assert.equal(observedTimingSnap.overlaps_left, 0);
  for (const disabled of [{ snap: false }, { timingSnap: false }]) {
    const result = await transcribeMedia(f.target, { ...options, ...disabled, lang: Object.keys(disabled)[0] });
    assert.equal(result.segments[0].words[1].start, 1.2);
    assert.equal(Object.hasOwn(result, "timing_snap"), false);
  }
});

test("既定吸着は接する語を境界にして隣接 segment の表示窓をクランプする", async (t) => {
  const f = await fixture(t, []);
  const result = await transcribeMedia(f.target, {
    ...speechOptions(f), unrecognized: false, lang: "adjacent-clamp",
    backendRunner: async () => [
      { start: 0.4, end: 1.12, text: "前", words: [{ start: 0.5, end: 1, text: "前" }] },
      { start: 0.94, end: 1.6, text: "後", words: [{ start: 1, end: 1.5, text: "後" }] },
    ],
  });
  assert.equal(result.segments[0].end, 1);
  assert.equal(result.segments[1].start, 1);
  assert.equal(result.timing_snap.clamped_pairs, 1);
  assert.equal(result.timing_snap.overlaps_left, 0);
});

test("backend の speaker は空でない文字列だけを segment へ写す", async (t) => {
  const withSpeaker = await fixture(t, []);
  const spoken = await transcribeMedia(withSpeaker.target, {
    ...speechOptions(withSpeaker), unrecognized: false,
    backendRunner: async () => [{ ...gapSegments()[0], speaker: "speaker-2" }],
  });
  assert.equal(spoken.segments[0].speaker, "speaker-2");
  assert.deepEqual(Object.keys(spoken.segments[0]).slice(0, 5), ["start", "end", "text", "speaker", "words"]);

  const withoutSpeaker = await fixture(t, []);
  const local = await transcribeMedia(withoutSpeaker.target, {
    ...speechOptions(withoutSpeaker), unrecognized: false,
  });
  assert.equal(Object.hasOwn(local.segments[0], "speaker"), false);
  assert.deepEqual(local.segments[0], gapSegments()[0]);
  assert.equal(JSON.stringify(local.segments[0]), JSON.stringify(gapSegments()[0]));
});

test("cache hit でも閾値を変えて再計算し、ASR は一度しか実行しない", async (t) => {
  const f = await fixture(t, []);
  let calls = 0;
  let silenceCalls = 0;
  const options = {
    ...speechOptions(f),
    backendRunner: async () => { calls += 1; return gapSegments(); },
    silencesRunner: async () => { silenceCalls += 1; return []; },
  };
  const first = await transcribeMedia(f.target, options);
  const second = await transcribeMedia(f.target, { ...options, unrecognizedMinGap: 0.45 });
  assert.equal(spanCount(first), 1);
  assert.equal(spanCount(second), 2);
  assert.deepEqual(first.cache, { hit: false, key: second.cache.key });
  assert.deepEqual(second.cache, { hit: true, key: first.cache.key });
  assert.equal(calls, 1);
  assert.equal(silenceCalls, 2);
  const files = await readdir(cacheDirectory(f));
  assert.equal(files.length, 1);
  assert.deepEqual((await json(path.join(cacheDirectory(f), files[0]))).segments, gapSegments());
  assert.deepEqual((await json(transcriptPath(f))).segments, second.segments);
});

test("旧 cache の span と版を除去し、現在の既定で再計算する", async (t) => {
  const f = await fixture(t, []);
  const sha256 = createHash("sha256").update(await readFile(path.join(f.project, f.target))).digest("hex");
  const key = `${sha256}-0-30-speech-analyzer-auto`;
  await mkdir(cacheDirectory(f), { recursive: true });
  const file = path.join(cacheDirectory(f), `${key}.json`);
  await putJson(file, {
    path: f.target, range: { in: 0, out: 30 }, backend: "speech-analyzer", no_speech: false,
    cache: { hit: false, key }, generated_at: f.options.now.toISOString(),
    segments: [
      { ...gapSegments()[0], unrecognized: [{ start: 0.5, end: 1 }], unrecognized_algo_version: 1 },
      { start: 5, end: 8, text: "端", words: [{ start: 6, end: 7, text: "端" }],
        unrecognized: [{ start: 5, end: 6 }, { start: 7, end: 8 }], unrecognized_algo_version: 1 },
    ],
  });
  const before = await readFile(file, "utf8");
  const options = { ...speechOptions(f), backendRunner: async () => assert.fail("旧 cache hit で ASR を実行した") };
  const result = await transcribeMedia(f.target, options);
  assert.deepEqual(result.cache, { hit: true, key });
  assert.deepEqual(result.segments[0].unrecognized, [{ start: 1.5, end: 2.5 }]);
  assert.equal(result.segments[0].unrecognized_algo_version, UNRECOGNIZED_ALGO_VERSION);
  assert.equal(Object.hasOwn(result.segments[1], "unrecognized"), false);
  assert.equal(Object.hasOwn(result.segments[1], "unrecognized_algo_version"), false);
  const disabled = await transcribeMedia(f.target, { ...options, unrecognized: false });
  assert.equal(spanCount(disabled), 0);
  assert.ok(disabled.segments.every((segment) => !Object.hasOwn(segment, "unrecognized_algo_version")));
  assert.equal(await readFile(file, "utf8"), before);
});

test("transcripts の segment に判定版を記録し、span と top-level の外形を保つ", async (t) => {
  const f = await fixture(t, []);
  await transcribeMedia(f.target, speechOptions(f));
  const transcript = await json(transcriptPath(f));
  assert.deepEqual(Object.keys(transcript), ["version", "backend", "generated_at", "source", "elapsed_sec", "cost_usd", "segments", "timing_snap", "transcript_language"]);
  assert.equal(transcript.segments[0].unrecognized_algo_version, UNRECOGNIZED_ALGO_VERSION);
  assert.deepEqual(transcript.segments[0].unrecognized, [{ start: 1.5, end: 2.5 }]);
});

test("cache に markers を保持し、無効から有効への変更でも端のマーカーを再計算する", async (t) => {
  const f = await fixture(t, []);
  const segments = [{ start: 0, end: 3, text: "語", words: [{ start: 1, end: 2, text: "語" }],
    markers: [{ start: 2.2, end: 2.4 }] }];
  let calls = 0;
  const options = { ...speechOptions(f),
    backendRunner: async () => { calls += 1; return segments; },
    silencesRunner: async () => [{ start: 0, end: 30 }],
  };
  const first = await transcribeMedia(f.target, { ...options, unrecognized: false });
  assert.deepEqual(first.segments, [{ start: 0, end: 3, text: "語", words: segments[0].words }]);
  assert.deepEqual((await json(transcriptPath(f))).segments, first.segments);
  const [file] = await readdir(cacheDirectory(f));
  assert.deepEqual((await json(path.join(cacheDirectory(f), file))).segments, segments);
  const second = await transcribeMedia(f.target, options);
  assert.equal(second.cache.hit, true);
  assert.equal(calls, 1);
  assert.deepEqual(second.segments[0].unrecognized, [{ start: 2.2, end: 2.4 }]);
  assert.equal(Object.hasOwn(second.segments[0], "markers"), false);
  assert.deepEqual((await json(transcriptPath(f))).segments, second.segments);
});

for (const empty of [false, true]) {
  test(`cloud cache は cost・range・生成日時と no_speech=${empty} を保持する`, async (t) => {
    const f = await fixture(t, []);
    await putJson(path.join(f.project, ".akari/connections.json"), { providers: [{ id: "scribe", doctor: { status: "ok" } }] });
    let calls = 0;
    const options = { ...speechOptions(f), backend: "cloud:scribe", in: 5, out: 10,
      backendRunner: async () => { calls += 1; return { cost_estimate_usd: 0.03, segments: empty ? [] : gapSegments() }; },
    };
    const first = await transcribeMedia(f.target, options);
    const later = new Date("2026-09-08T02:00:00Z");
    const second = await transcribeMedia(f.target, { ...options, now: later, unrecognizedMinGap: 0.45 });
    assert.equal(calls, 1);
    assert.deepEqual(second.cache, { hit: true, key: first.cache.key });
    for (const result of [first, second]) {
      assert.equal(result.backend, "cloud:scribe");
      assert.equal(result.cost_usd, 0.03);
      assert.equal(result.no_speech, empty);
      assert.deepEqual(result.range, { in: 5, out: 10 });
      assert.equal(result.generated_at, f.options.now.toISOString());
    }
    assert.equal(spanCount(first), empty ? 0 : 1);
    assert.equal(spanCount(second), empty ? 0 : 2);
    const transcript = await json(transcriptPath(f, "cloud-scribe"));
    assert.equal(transcript.generated_at, later.toISOString());
    assert.equal(transcript.cost_usd, 0.03);
    assert.deepEqual(transcript.segments, second.segments);
  });
}
