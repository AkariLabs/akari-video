import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runMediaCli } from "../bin/media.mjs";
import { resolveTarget } from "../src/media/common.mjs";
import { recordEngineTranscript, transcriptsDirForTarget } from "../src/media/record.mjs";
import { resolveWhisper, transcribeMedia } from "../src/media/transcribe.mjs";
import { writeWordBookFile } from "../../word-book/src/index.mjs";
import { fixture, json, putJson } from "./fixtures/transcribe-compare/helpers.mjs";

const speechOptions = (f) => ({ ...f.options, backend: "speech-analyzer", speechAnalyzerAvailable: true, unrecognized: false,
  backendRunner: async () => [{ start: 0, end: 1, text: "発話" }],
});

test("transcribe の成功時は生 sidecar を保存、cache hit でも旧版を退避して最新を更新", async (t) => {
  const f = await fixture(t, []);
  let calls = 0;
  const options = { ...speechOptions(f), backendRunner: async () => { calls += 1; return [{ start: 0, end: 1, text: "発話" }]; } };
  const first = await transcribeMedia(f.target, options);
  const file = path.join(f.directory, "transcripts/speech-analyzer.json");
  const before = await readFile(file, "utf8");
  const raw = JSON.parse(before);
  assert.deepEqual(Object.keys(raw), ["version", "backend", "generated_at", "source", "elapsed_sec", "cost_usd", "segments"]);
  assert.deepEqual(raw.source, { path: f.target, range: { in: 0, out: 30 } });
  assert.equal(raw.version, 1);
  assert.equal(raw.cost_usd, null);
  assert.ok(Number.isFinite(raw.elapsed_sec) && raw.elapsed_sec >= 0);
  assert.deepEqual(raw.segments, first.segments);
  const later = new Date("2026-09-08T01:00:01Z");
  const second = await transcribeMedia(f.target, { ...options, now: later });
  assert.equal(first.cache.hit, false);
  assert.equal(second.cache.hit, true);
  assert.equal(calls, 1);
  const files = await readdir(path.dirname(file));
  assert.deepEqual(files.sort(), ["speech-analyzer.2026-09-08T01-00-00-000Z.json", "speech-analyzer.json"]);
  assert.equal(await readFile(path.join(path.dirname(file), files[0]), "utf8"), before);
  assert.equal((await json(file)).generated_at, later.toISOString());
  const analysis = await json(path.join(f.directory, "analysis.json"));
  assert.deepEqual(analysis.transcript, first.segments);
  assert.equal(analysis.observations.length, 2);
});

test("backend 名を正規化し、同時刻の再実行でも退避版を失わない", async (t) => {
  const f = await fixture(t, []);
  const target = resolveTarget(f.target, f.options);
  assert.equal(transcriptsDirForTarget(target), path.join(f.directory, "transcripts"));
  const value = { backend: "cloud:scribe", generated_at: f.options.now.toISOString(), source: { path: f.target, range: { in: 0, out: 30 } }, elapsed_sec: 0.1, cost_usd: 0.03, segments: [] };
  await Promise.all([1, 2, 3].map((n) => recordEngineTranscript(target, { ...value, segments: [{ start: 0, end: 1, text: String(n) }] })));
  const files = await readdir(path.join(f.directory, "transcripts"));
  assert.equal(files.length, 3);
  assert.ok(files.every((file) => /^cloud-scribe(?:\.[A-Za-z0-9-]+)?\.json$/.test(file)));
  const contents = await Promise.all(files.map((file) => json(path.join(f.directory, "transcripts", file))));
  assert.deepEqual(contents.map((value) => value.segments[0].text).sort(), ["1", "2", "3"]);
  assert.ok(contents.every((value) => value.backend === "cloud-scribe" && value.cost_usd === 0.03));
  await assert.rejects(recordEngineTranscript(target, { ...value, backend: "../escape" }), /backend 名が不正/);
  assert.equal(await recordEngineTranscript({ projectRoot: null }, value), null);
});

test("--no-record は新規 sidecar を作らず既存の sidecar・analysis も更新しない", async (t) => {
  const f = await fixture(t, []);
  const options = { ...speechOptions(f), stdout: () => {}, stderr: () => {} };
  const argv = ["transcribe", f.target, "--backend", "speech-analyzer"];
  assert.equal(await runMediaCli([...argv, "--no-record"], options), 0);
  assert.deepEqual(await readdir(path.join(f.directory, "transcripts")), []);
  assert.equal(existsSync(path.join(f.directory, "analysis.json")), false);
  assert.equal(await runMediaCli(argv, options), 0);
  const raw = await readFile(path.join(f.directory, "transcripts/speech-analyzer.json"), "utf8");
  const analysis = await readFile(path.join(f.directory, "analysis.json"), "utf8");
  assert.equal(await runMediaCli([...argv, "--no-record"], options), 0);
  assert.deepEqual(await readdir(path.join(f.directory, "transcripts")), ["speech-analyzer.json"]);
  assert.equal(await readFile(path.join(f.directory, "transcripts/speech-analyzer.json"), "utf8"), raw);
  assert.equal(await readFile(path.join(f.directory, "analysis.json"), "utf8"), analysis);
});

test("機械の生は単語帳適用前、analysis は従来どおり適用後、範囲置換も保持", async (t) => {
  const f = await fixture(t, []);
  const wordBookPath = path.join(f.project, "word-book.json");
  await writeWordBookFile(wordBookPath, { version: 0, entries: [{ surface: "AKARI Video", variants: ["あかりビデオ"], kind: "term" }] });
  await putJson(path.join(f.directory, "analysis.json"), { version: 0, transcript: [{ start: 0, end: 1, text: "残す" }] });
  const result = await transcribeMedia(f.target, { ...speechOptions(f), wordBookPath, in: 5, out: 7, stderr: () => {},
    backendRunner: async () => [{ start: 0, end: 1, text: "あかりビデオ", words: [{ start: 0, end: 1, text: "あかりビデオ" }] }],
  });
  assert.equal(result.segments[0].text, "AKARI Video");
  const raw = await json(path.join(f.directory, "transcripts/speech-analyzer.json"));
  assert.equal(raw.segments[0].text, "あかりビデオ");
  assert.equal(raw.segments[0].start, 5);
  assert.deepEqual(raw.source.range, { in: 5, out: 7 });
  assert.deepEqual((await json(path.join(f.directory, "analysis.json"))).transcript.map((segment) => segment.text), ["残す", "AKARI Video"]);
});

test("クラウドの見積が戻れば流用し、無ければ null。ローカルは cost を記録しない", async (t) => {
  const f = await fixture(t, []);
  await putJson(path.join(f.project, ".akari/connections.json"), { providers: [{ id: "scribe", doctor: { status: "ok" } }] });
  const base = { ...f.options, backend: "cloud:scribe", unrecognized: false };
  await transcribeMedia(f.target, { ...base, lang: "cost", backendRunner: async () => ({ cost_estimate_usd: 0.03, segments: [{ start: 0, end: 1, text: "発話" }] }) });
  assert.equal((await json(path.join(f.directory, "transcripts/cloud-scribe.json"))).cost_usd, 0.03);
  await transcribeMedia(f.target, { ...base, lang: "no-cost", backendRunner: async () => [{ start: 0, end: 1, text: "発話" }] });
  assert.equal((await json(path.join(f.directory, "transcripts/cloud-scribe.json"))).cost_usd, null);
  await transcribeMedia(f.target, { ...speechOptions(f), backendRunner: async () => ({ cost_estimate_usd: 999, segments: [{ start: 0, end: 1, text: "発話" }] }) });
  assert.equal((await json(path.join(f.directory, "transcripts/speech-analyzer.json"))).cost_usd, null);
});

test("無音・空結果も記録し、backend 失敗は sidecar を作らない", async (t) => {
  const f = await fixture(t, []);
  await assert.rejects(transcribeMedia(f.target, { ...speechOptions(f), backendRunner: async () => { throw new Error("backend error"); } }), /backend error/);
  assert.deepEqual(await readdir(path.join(f.directory, "transcripts")), []);
  const result = await transcribeMedia(f.target, { ...speechOptions(f), backendRunner: async () => [] });
  assert.equal(result.no_speech, true);
  assert.deepEqual((await json(path.join(f.directory, "transcripts/speech-analyzer.json"))).segments, []);
});

test("AKARI_WHISPER_BIN が WHISPER_CPP_BIN より優先し、不在なら次候補へ", async (t) => {
  const f = await fixture(t, []);
  const akari = path.join(f.project, "akari-whisper");
  const cpp = path.join(f.project, "cpp-whisper");
  const model = path.join(f.project, "ggml-fixture.bin");
  await writeFile(akari, "fixture"); await chmod(akari, 0o755);
  await writeFile(cpp, "fixture"); await chmod(cpp, 0o755);
  await writeFile(model, "fixture");
  const names = ["AKARI_WHISPER_BIN", "WHISPER_CPP_BIN", "WHISPER_CPP_MODEL"];
  const previous = names.map((name) => process.env[name]);
  t.after(() => names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; }));
  process.env.AKARI_WHISPER_BIN = akari;
  process.env.WHISPER_CPP_BIN = cpp;
  process.env.WHISPER_CPP_MODEL = model;
  assert.deepEqual(resolveWhisper(), { bin: akari, model });
  process.env.AKARI_WHISPER_BIN = "/no/such";
  assert.deepEqual(resolveWhisper(), { bin: cpp, model });
});
