import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { fixture, json } from "./fixtures/transcribe-compare/helpers.mjs";
import { FILLER_LEXICON, FILLER_PACKS, countFillerHits, findFillerSpans } from "../src/media/filler-lexicon.mjs";
import { isWhisperModelExcluded } from "../src/media/whisper-model-candidates.mjs";
import { resolveTranscribeLanguage, speechLocaleForLanguage, transcribeMedia, whisperArguments } from "../src/media/transcribe.mjs";
import { transcribeCutsMedia } from "../src/media/transcribe-cuts.mjs";
import { compareTranscripts } from "../src/media/transcribe-diff.mjs";

test("explicit language, intake language, and auto fallback", async (t) => {
  const f = await fixture(t, []);
  assert.equal(await resolveTranscribeLanguage(f.project), "auto");
  await mkdir(path.join(f.project, ".akari"), { recursive: true });
  await writeFile(path.join(f.project, ".akari/intake.json"), JSON.stringify({ language: "en-US" }));
  assert.equal(await resolveTranscribeLanguage(f.project), "en");
  assert.equal(await resolveTranscribeLanguage(f.project, "fr-CA"), "fr");
  assert.equal(await resolveTranscribeLanguage(f.project, "auto"), "en");
  const seen = [];
  const options = { ...f.options, backend: "speech-analyzer", speechAnalyzerAvailable: true, unrecognized: false,
    backendRunner: async ({ lang }) => { seen.push(lang); return [{ start: 0, end: 1, text: "Hello" }]; } };
  await transcribeMedia(f.target, options);
  assert.equal((await json(path.join(f.directory, "transcripts/speech-analyzer.json"))).transcript_language, "en-US");
  assert.equal((await json(path.join(f.directory, "analysis.json"))).transcript_language, "en-US");
  await transcribeMedia(f.target, { ...options, lang: "ja" });
  assert.deepEqual(seen, ["en", "ja"]);
});

test("SpeechAnalyzer locale table and English only whisper model candidates", () => {
  assert.equal(speechLocaleForLanguage("en-GB"), "en-US");
  assert.equal(speechLocaleForLanguage("ja"), "ja-JP");
  assert.equal(speechLocaleForLanguage("fr"), "fr-FR");
  assert.equal(speechLocaleForLanguage("yue"), "yue-CN");
  assert.equal(speechLocaleForLanguage("xx"), null);
  assert.equal(isWhisperModelExcluded("ggml-base.en.bin", "en"), false);
  assert.equal(isWhisperModelExcluded("ggml-base.en.bin", "ja"), true);
  assert.equal(isWhisperModelExcluded("ggml-base.en.bin"), true);
  assert.equal(isWhisperModelExcluded("for-tests-base.en.bin", "en"), true);
});

test("unsupported SpeechAnalyzer locale selects whisper and reports a missing model in English", async (t) => {
  const f = await fixture(t, []);
  const seen = [];
  const options = { ...f.options, speechAnalyzerAvailable: true, backend: "speech-analyzer", lang: "xx",
    whisperBin: "fixture-whisper", whisperModel: "fixture-model", unrecognized: false,
    backendRunner: async ({ backend, lang }) => { seen.push([backend, lang]); return [{ start: 0, end: 1, text: "hello" }]; } };
  await transcribeMedia(f.target, options);
  assert.deepEqual(seen, [["whisper-cpp", "xx"]]);
  await assert.rejects(transcribeMedia(f.target, { ...options, whisperBin: undefined, whisperModel: undefined, whisperAvailable: false, uiLanguage: "en" }),
    /SpeechAnalyzer does not support xx[\s\S]*akari tools install whisper/);
});

test("runtime unsupported SpeechTranscriber locale falls back to whisper", async (t) => {
  const f = await fixture(t, []);
  const seen = [];
  await transcribeMedia(f.target, { ...f.options, backend: "speech-analyzer", lang: "fr", speechAnalyzerAvailable: true,
    whisperBin: "fixture-whisper", whisperModel: "fixture-model", unrecognized: false,
    backendRunner: async ({ backend }) => {
      seen.push(backend);
      if (backend === "speech-analyzer") throw new Error("Unsupported SpeechTranscriber locale: fr-FR");
      return [{ start: 0, end: 1, text: "bonjour" }];
    }, stderr: () => {} });
  assert.deepEqual(seen, ["speech-analyzer", "whisper-cpp"]);
});

test("helper が資産 unsupported を報告した場合も whisper にフォールバックする", async (t) => {
  const f = await fixture(t, []);
  const seen = [];
  await transcribeMedia(f.target, { ...f.options, backend: "speech-analyzer", lang: "ja", speechAnalyzerAvailable: true,
    whisperBin: "fixture-whisper", whisperModel: "fixture-model", unrecognized: false,
    backendRunner: async ({ backend }) => {
      seen.push(backend);
      if (backend === "speech-analyzer") {
        throw new Error("Unsupported SpeechTranscriber locale: ja-JP (this macOS does not provide a SpeechAnalyzer model for ja-JP; asset status: unsupported, before: unsupported)");
      }
      return [{ start: 0, end: 1, text: "こんにちは" }];
    }, stderr: () => {} });
  assert.deepEqual(seen, ["speech-analyzer", "whisper-cpp"]);
});

test("English whisper prompt is opt-in and does not affect Japanese arguments", () => {
  const base = whisperArguments("model", "input", "en", "output");
  assert.equal(base.includes("--prompt"), false);
  const enabled = whisperArguments("model", "input", "en", "output", { whisperPrompt: true });
  assert.equal(enabled[enabled.indexOf("--prompt") + 1].includes("Um, uh"), true);
  assert.equal(whisperArguments("model", "input", "ja", "output", { whisperPrompt: true }).includes("--prompt"), false);
});

test("whisper and cloud record primary language, while auto records und", async (t) => {
  const f = await fixture(t, []);
  await writeFile(path.join(f.project, ".akari/connections.json"), JSON.stringify({ providers: [{ id: "scribe", doctor: { status: "ok" } }] }));
  const common = { ...f.options, unrecognized: false,
    backendRunner: async () => [{ start: 0, end: 1, text: "Hello" }] };
  await transcribeMedia(f.target, { ...common, backend: "whisper-cpp", whisperBin: "fixture-whisper", whisperModel: "fixture-model", lang: "en" });
  assert.equal((await json(path.join(f.directory, "transcripts/whisper-cpp.json"))).transcript_language, "en");
  await transcribeMedia(f.target, { ...common, backend: "cloud:scribe", lang: "en" });
  assert.equal((await json(path.join(f.directory, "transcripts/cloud-scribe.json"))).transcript_language, "en");
  await transcribeMedia(f.target, { ...common, backend: "cloud:scribe", lang: "auto" });
  assert.equal((await json(path.join(f.directory, "transcripts/cloud-scribe.json"))).transcript_language, "und");
  assert.equal((await json(path.join(f.directory, "analysis.json"))).transcript_language, "und");
});

test("English transcript diff labels filler confidence", () => {
  const missing = { backend: "missing", segments: [] };
  const high = compareTranscripts([{ backend: "heard", segments: [{ start: 0, end: 1, text: "um" }] }, missing], { language: "en" });
  const low = compareTranscripts([{ backend: "heard", segments: [{ start: 0, end: 1, text: "like" }] }, missing], { language: "en" });
  assert.deepEqual([high.items[0].kind, high.items[0].confidence], ["filler", "high"]);
  assert.deepEqual([low.items[0].kind, low.items[0].confidence], ["filler", "low"]);
});

test("Japanese lexicon stays fixed; English high and low confidence are distinct", () => {
  assert.deepEqual(FILLER_LEXICON, ["えー", "えーと", "えっと", "あー", "あの", "あのー", "その", "そのー", "まあ", "まぁ", "なんか", "うーん", "んー", "ええと"]);
  assert.deepEqual(FILLER_PACKS.en.filter((item) => item.confidence === "high").map((item) => item.text), ["um", "uh", "erm", "uhm", "hmm"]);
  assert.deepEqual(findFillerSpans("Um, you know, I mean, like it", "en").map(({ filler, confidence }) => [filler, confidence]),
    [["um", "high"], ["you know", "low"], ["I mean", "low"], ["like", "low"]]);
  assert.equal(countFillerHits("album umbrella", "en"), 0);
});

test("English cuts detect repeats and restart phrases; candidates without quiet boundaries stay off", async (t) => {
  const f = await fixture(t, ["speech-analyzer"]);
  await writeFile(path.join(f.project, ".akari/intake.json"), JSON.stringify({ language: "en" }));
  const transcriptPath = path.join(f.directory, "transcripts/speech-analyzer.json");
  const transcript = await json(transcriptPath);
  transcript.segments = [{ start: 0, end: 8, text: "Um, like, I, I think that's, that's — okay, let me start over." }];
  await writeFile(transcriptPath, JSON.stringify(transcript));
  await transcribeCutsMedia(f.target, { ...f.options, whisperAvailable: false, filler: "on", redo: "on", silencesRunner: async () => [] });
  const cuts = await json(path.join(f.directory, "cuts.json"));
  const um = cuts.candidates.find((item) => item.text?.toLowerCase().startsWith("um"));
  assert.deepEqual([um.on, um.default_on, um.adjacent, um.boundary_review], [false, false, true, true]);
  assert.equal(cuts.candidates.find((item) => item.text?.toLowerCase().startsWith("like")).on, false);
  assert.ok(cuts.candidates.some((item) => item.kind === "redo" && item.text.includes("I, I")));
  assert.ok(cuts.candidates.some((item) => item.kind === "redo" && item.text.includes("that's, that's")));
  assert.ok(cuts.candidates.some((item) => item.kind === "redo" && item.text.includes("let me start over")));
});

test("English restart candidates cover abandoned sentences but stay off without quiet boundaries", async (t) => {
  const cases = [
    ["Hey everyone, um, so this week I, okay, let me start over. Hey everyone, this week I finally made it.",
      "Hey everyone, um, so this week I, okay, let me start over."],
    ["Um, so this week I, okay, let me start over.", "Um, so this week I, okay, let me start over."],
    ["Hey everyone — okay, let me start over. Here is the update.", "Hey everyone — okay, let me start over."],
  ];
  for (const [text, abandoned] of cases) {
    const f = await fixture(t, ["speech-analyzer"]);
    await writeFile(path.join(f.project, ".akari/intake.json"), JSON.stringify({ language: "en" }));
    const transcriptPath = path.join(f.directory, "transcripts/speech-analyzer.json");
    const transcript = await json(transcriptPath);
    transcript.segments = [{ start: 2, end: 2 + text.length * 0.05, text }];
    await writeFile(transcriptPath, JSON.stringify(transcript));
    await transcribeCutsMedia(f.target, { ...f.options, whisperAvailable: false, redo: "on", silencesRunner: async () => [] });
    const cuts = await json(path.join(f.directory, "cuts.json"));
    const restarts = cuts.candidates.filter((candidate) => candidate.reason === "Restart phrase");
    assert.equal(restarts.length, 1, text);
    assert.equal(restarts[0].text, abandoned);
    assert.equal(restarts[0].start, 2);
    assert.deepEqual([restarts[0].on, restarts[0].default_on, restarts[0].boundary_review], [false, false, true]);
  }
});

test("English restart phrases accept period and space separators and alternate wording", async (t) => {
  for (const text of ["First attempt. Sorry, let me start again.", "Wait let me try that again.", "No, scratch that.", "Start over."]) {
    const f = await fixture(t, ["speech-analyzer"]);
    await writeFile(path.join(f.project, ".akari/intake.json"), JSON.stringify({ language: "en" }));
    const transcriptPath = path.join(f.directory, "transcripts/speech-analyzer.json");
    const transcript = await json(transcriptPath);
    transcript.segments = [{ start: 0, end: 3, text }];
    await writeFile(transcriptPath, JSON.stringify(transcript));
    await transcribeCutsMedia(f.target, { ...f.options, whisperAvailable: false, silencesRunner: async () => [] });
    const cuts = await json(path.join(f.directory, "cuts.json"));
    assert.equal(cuts.candidates.filter((candidate) => candidate.reason === "Restart phrase").length, 1, text);
  }
});

test("English cuts with filler on regenerate whisper with its prompt enabled", async (t) => {
  const f = await fixture(t, ["whisper-cpp"]);
  await writeFile(path.join(f.project, ".akari/intake.json"), JSON.stringify({ language: "en" }));
  let calls = 0;
  await transcribeCutsMedia(f.target, { ...f.options, filler: "on", whisperBin: "fixture-whisper", whisperModel: "fixture-model",
    unrecognized: false, backendRunner: async () => { calls += 1; return [{ start: 0, end: 1, text: "Um" }]; },
    silencesRunner: async () => [] });
  assert.equal(calls, 1);
  const cache = await json(path.join(f.directory, "transcripts/whisper-cpp.json"));
  assert.equal(cache.transcript_language, "en");
  assert.ok((await readdir(path.join(f.project, ".akari/cache/transcribe"))).some((name) => name.includes("filler-prompt")));
});
