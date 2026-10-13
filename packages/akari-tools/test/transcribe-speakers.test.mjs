import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { setLanguage } from "../../i18n/index.mjs";

import { runMediaCli } from "../bin/media.mjs";
import { transcribeMedia } from "../src/media/transcribe.mjs";

setLanguage("ja");
after(() => setLanguage(undefined));

const temporaryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.tmp-lane");
const json = async file => JSON.parse(await readFile(file, "utf8"));
const vector = (positive = true) => Float32Array.from({ length: 256 }, (_, i) => i === 0 ? (positive ? 1 : -1) : 0);

async function fixture(t) {
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(path.join(temporaryRoot, "voice-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "channels", "demo", "videos", "clip");
  const channel = path.dirname(path.dirname(project));
  await mkdir(path.join(project, ".akari"), { recursive: true });
  await mkdir(path.join(project, "assets"), { recursive: true });
  await writeFile(path.join(project, "assets", "source.wav"), "音声の偽物");
  const target = "assets/source.wav";
  const directory = path.join(project, ".akari", "sidecars", `${target}.analysis`);
  const samples = Float32Array.from({ length: 32000 }, () => .3);
  const calls = { diarize: 0, embed: 0, asr: 0, decode: 0 };
  const engine = {
    status: "ready", version: "test-1",
    diarize: async () => { calls.diarize++; return [
      { start: 0, end: 1, speaker: 9 }, { start: 1, end: 2, speaker: 5 },
    ]; },
    embed: async audio => { calls.embed++; return vector(audio[0] >= 0); },
  };
  const options = {
    cwd: project, backend: "speech-analyzer", speechAnalyzerAvailable: true,
    wordBook: false, snap: false, unrecognized: false,
    ffmpegCommand: "fixture-ffmpeg", ffprobeCommand: "fixture-ffprobe",
    spawn: () => ({ status: 0, stdout: JSON.stringify({ format: { duration: "2" }, streams: [{ codec_type: "audio" }] }), stderr: "" }),
    silencesRunner: async () => [],
    backendRunner: async () => { calls.asr++; return [
      { start: 0, end: 1, text: "前", words: [] }, { start: 1, end: 2, text: "後", words: [] },
    ]; },
    voiceEngine: engine,
    voiceDecode: async () => { calls.decode++; return samples; },
    stderr: () => {},
  };
  return { root, project, channel, target, directory, calls, engine, options };
}

test("旗なしは結果・ASR 鍵・記録を保ち、声のエンジンを呼ばない", async t => {
  const f = await fixture(t);
  const result = await transcribeMedia(f.target, f.options);
  const sha = createHash("sha256").update(await readFile(path.join(f.project, f.target))).digest("hex");
  assert.equal(result.cache.key, `${sha}-0-2-speech-analyzer-auto`);
  assert.equal(Object.hasOwn(result, "speakers"), false);
  assert.deepEqual((await json(path.join(f.directory, "analysis.json"))).tracks.speakers, []);
  assert.equal(existsSync(path.join(f.directory, "voices.json")), false);
  assert.deepEqual([f.calls.diarize, f.calls.embed, f.calls.decode], [0, 0, 0]);
});

test("分離は記録へ話者を付け、側ファイルと分離キャッシュを残す", async t => {
  const f = await fixture(t);
  await mkdir(f.directory, { recursive: true });
  await writeFile(path.join(f.directory, "voices.json"), JSON.stringify({ decided: { A: "demo/p1" } }));
  const first = await transcribeMedia(f.target, { ...f.options, diarize: true });
  const second = await transcribeMedia(f.target, { ...f.options, diarize: true });
  assert.equal(f.calls.diarize, 1);
  assert.deepEqual(first.speakers, { requested: "auto", fallback: false,
    count: 2, ids: ["A", "B"], seconds: { A: 1, B: 1 }, shortSpeakers: ["A", "B"] });
  assert.deepEqual(second.segments.map(s => s.speaker), ["A", "B"]);
  assert.deepEqual(second.speakers.shortSpeakers, ["A", "B"]);
  const analysis = await json(path.join(f.directory, "analysis.json"));
  assert.equal(Object.hasOwn(analysis, "speakers"), false);
  assert.deepEqual(analysis.transcript.map(s => s.speaker), ["A", "B"]);
  assert.deepEqual(analysis.tracks.speakers, [
    { id: "A", spans: [[0, 1]] }, { id: "B", spans: [[1, 2]] },
  ]);
  const voices = await json(path.join(f.directory, "voices.json"));
  assert.equal(voices.schema, "akari.voices/0");
  assert.equal(voices.key.model, "wespeaker-voxceleb-resnet34-LM");
  assert.equal(Buffer.from(voices.speakers.A.embedding, "base64").length, 1024);
  assert.deepEqual(voices.decided, { A: "demo/p1" });
  assert.deepEqual([voices.requested, voices.fallback], ["auto", false]);
  assert.deepEqual(voices.shortSpeakers, ["A", "B"]);
  const [cacheName] = await readdir(path.join(f.project, ".akari", "cache", "diarize"));
  assert.deepEqual((await json(path.join(f.project, ".akari", "cache", "diarize", cacheName))).turns.map(turn => turn.speaker), ["A", "B"]);
  assert.equal(Object.hasOwn((await json(path.join(f.directory, "transcripts", "speech-analyzer.json"))).segments[0], "speaker"), false);
  assert.equal((await readdir(path.join(f.project, ".akari", "cache", "diarize"))).length, 1);
});

test("人物の照合は strong を束ね、明示した 2 人は束ねない", async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.channel, "people"), { recursive: true });
  await writeFile(path.join(f.channel, "people", "p1.wav"), "見本");
  await writeFile(path.join(f.channel, "people.json"), JSON.stringify({ entries: [
    { kind: "person", id: "p1", name: "一郎", voice: { samples: [{ file: "people/p1.wav", consent: "self" }] } },
  ] }));
  const auto = await transcribeMedia(f.target, { ...f.options, identify: true });
  assert.equal(auto.speakers.count, 1);
  assert.deepEqual(auto.speakers.identify.compared, ["demo/p1"]);
  assert.equal(auto.speakers.identify.suggestions.A.level, "strong");
  const fixed = await transcribeMedia(f.target, { ...f.options, identify: true, speakers: 2 });
  assert.equal(fixed.speakers.count, 2);
  assert.equal(fixed.speakers.identify.suggestions.B.level, "strong");
  f.engine.embed = async audio => vector(audio[0] >= 0 && audio.length > 20000);
  const none = await transcribeMedia(f.target, { ...f.options, identify: true, speakers: 1 });
  assert.equal(none.speakers.identify.suggestions.A.level, "none");
});

test("人物の一覧が無いときは一行警告し、照合結果を付けない", async t => {
  const f = await fixture(t);
  const warnings = [];
  const result = await transcribeMedia(f.target, { ...f.options, identify: true, people: "missing.json", stderr: line => warnings.push(line) });
  assert.equal(Object.hasOwn(result.speakers, "identify"), false);
  assert.equal(warnings.filter(line => line.includes("people.json")).length, 1);
});

test("人物の一覧に声の見本が無いときは照合せず、提案を残さない", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.channel, "people.json"), JSON.stringify({ entries: [
    { kind: "person", id: "p1", name: "一郎" },
  ] }));
  const warnings = [];
  const result = await transcribeMedia(f.target, { ...f.options, identify: true, stderr: line => warnings.push(line) });
  assert.deepEqual(result.speakers.identify, { compared: [], suggestions: {} });
  assert.equal(warnings.filter(line => line === "話者の照合: 声の見本がある人物がいないので照らしません").length, 1);
  const voices = await json(path.join(f.directory, "voices.json"));
  assert.deepEqual(Object.keys(voices.speakers), ["A", "B"]);
  for (const speaker of Object.values(voices.speakers)) assert.equal(Object.hasOwn(speaker, "suggestion"), false);
});

test("エンジンが無い場合は ASR の前に終了コード 2 を返す", async t => {
  const f = await fixture(t);
  const errors = [];
  const code = await runMediaCli(["transcribe", f.target, "--diarize"], {
    ...f.options, voiceEngine: { status: "missing" }, stderr: line => errors.push(line), stdout: () => {},
  });
  assert.equal(code, 2);
  assert.match(errors[0], /話者を分けるには準備が要ります/);
  assert.equal(f.calls.asr, 0);
});

test("人数が合わない場合は自動分離へ戻し、一行で知らせる", async t => {
  const f = await fixture(t);
  const warnings = [];
  const result = await transcribeMedia(f.target, { ...f.options, speakers: 3, stderr: line => warnings.push(line) });
  assert.equal(result.speakers.count, 2);
  assert.deepEqual([result.speakers.requested, result.speakers.fallback], [3, true]);
  const voices = await json(path.join(f.directory, "voices.json"));
  assert.deepEqual([voices.requested, voices.fallback], [3, true]);
  assert.equal(f.calls.diarize, 4);
  assert.deepEqual(warnings.filter(line => line.includes("指定の 3 人")), [
    "指定の 3 人に分けられなかったので、自動で分けた結果（2 人）を使います",
  ]);
});

test("照合できない環境でも分離結果を返し、照合だけ飛ばす", async t => {
  const f = await fixture(t);
  f.engine.status = { status: "ready", canIdentify: false };
  const warnings = [];
  const result = await transcribeMedia(f.target, { ...f.options, identify: true, stderr: line => warnings.push(line) });
  assert.equal(result.speakers.count, 2);
  assert.equal(Object.hasOwn(result.speakers, "identify"), false);
  assert.equal(f.calls.embed, 0);
  const voices = await json(path.join(f.directory, "voices.json"));
  assert.deepEqual(voices.speakers, {});
  assert.deepEqual([voices.requested, voices.fallback], ["auto", false]);
  assert.deepEqual(warnings.filter(line => line.includes("この Mac では")), [
    "この Mac では声の照合はできません（話者を分けることはできます）",
  ]);
});

test("旧い分離キャッシュに人数結果が無くても指定人数を保つ", async t => {
  const f = await fixture(t);
  await transcribeMedia(f.target, { ...f.options, speakers: 4 });
  const cacheDirectory = path.join(f.project, ".akari", "cache", "diarize");
  const [name] = await readdir(cacheDirectory);
  const cachePath = path.join(cacheDirectory, name);
  const cache = await json(cachePath);
  delete cache.countResult;
  await writeFile(cachePath, JSON.stringify(cache));
  const result = await transcribeMedia(f.target, { ...f.options, speakers: 4 });
  assert.deepEqual([result.speakers.requested, result.speakers.fallback], [4, false]);
  assert.equal(f.calls.diarize, 1);
});

test("media の旗は含意と値の検証を行う", async t => {
  const f = await fixture(t);
  for (const args of [["--speakers", "2"], ["--people", "missing.json"]]) {
    const lines = [];
    const code = await runMediaCli(["transcribe", f.target, ...args], { ...f.options, stdout: line => lines.push(JSON.parse(line)) });
    assert.equal(code, 0);
    assert.equal(lines[0].speakers.count, 2);
  }
  const errors = [];
  assert.equal(await runMediaCli(["transcribe", f.target, "--speakers", "5"], { ...f.options, stderr: line => errors.push(line) }), 1);
  assert.match(errors[0], /auto または 1〜4/);
});
