import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runMediaCli } from "../bin/media.mjs";
import { compareTranscripts, transcribeDiffMedia } from "../src/media/transcribe-diff.mjs";
import { fixture, json, putJson } from "./fixtures/transcribe-compare/helpers.mjs";

const transcript = (backend, segments) => ({ backend, segments });
const segment = (text, start = 0, end = 1, extra = {}) => ({ text, start, end, ...extra });

test("3 エンジン fixture: word 4 / filler 3 / unrecognized 1、句読点は除外", async (t) => {
  const f = await fixture(t);
  const lines = [], errors = [];
  assert.equal(await runMediaCli(["transcribe-diff", f.target], { ...f.options, stdout: (line) => lines.push(line), stderr: (line) => errors.push(line) }), 0, errors.join("\n"));
  assert.equal(lines.length, 1);
  const summary = JSON.parse(lines[0]);
  assert.deepEqual(summary.by_kind, { word: 4, filler: 3, unrecognized: 1 });
  assert.equal(summary.items, 8);
  assert.ok(summary.agreement >= 0.8 && summary.agreement <= 0.95);
  const diff = await json(path.join(f.directory, "diff.json"));
  assert.equal(diff.version, 1);
  assert.equal(diff.generated_at, f.options.now.toISOString());
  assert.deepEqual(diff.items.map((item) => item.id), Array.from({ length: 8 }, (_, i) => `d-${String(i + 1).padStart(4, "0")}`));
  const product = diff.items.find((item) => item.texts["cloud-scribe"] === "AKARI Video");
  assert.equal(product.majority, "AKARI Video");
  assert.deepEqual(product.votes, { "AKARI Video": 2, "あかりビデオ": 1 });
  assert.equal(product.timing, "estimated");
  const filler = diff.items.find((item) => item.start === 0.4);
  assert.equal(filler.end, 0.9);
  assert.equal(filler.timing, undefined);
  assert.equal(filler.kind, "filler");
  assert.equal(diff.items.find((item) => item.kind === "unrecognized").overlaps_unrecognized, true);
  assert.equal(diff.items.some((item) => item.kind === "punct"), false);
  t.diagnostic(`fixture stdout: ${lines[0]}`);
});

test("単独エンジンは diff.json を書かず、退避版は読まない", async (t) => {
  const f = await fixture(t, ["whisper-cpp"]);
  await putJson(path.join(f.directory, "transcripts/cloud-scribe.2026-09-08.json"), { invalid: true });
  assert.deepEqual(await transcribeDiffMedia(f.target, f.options), { engines: ["whisper-cpp"], skipped: "比較対象なし" });
  assert.equal(existsSync(path.join(f.directory, "diff.json")), false);
  await putJson(path.join(f.directory, "diff.json"), { untouched: true });
  await transcribeDiffMedia(f.target, f.options);
  assert.deepEqual(await json(path.join(f.directory, "diff.json")), { untouched: true });
});

test("agreement は空白・句読点を除く基準文字数分母、全エンジン一致のみ分子", () => {
  const result = compareTranscripts([
    transcript("a", [segment("甲、乙 丙。丁！")]),
    transcript("b", [segment("甲乙誤丁")]),
    transcript("c", [segment("甲異丙丁?")]),
  ]);
  assert.equal(result.agreement, 2 / 4);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].majority, null);
  assert.deepEqual(result.items[0].votes, { "、乙 丙": 1, "乙誤": 1, "異丙": 1 });
});

test("時刻窓は分割 segment を合わせ、時間の離れた同一文は一致扱いしない", () => {
  const result = compareTranscripts([
    transcript("a", [segment("甲乙", 0, 2), segment("同じ", 4, 5)]),
    transcript("b", [segment("甲", 0, 1), segment("乙", 1, 2), segment("同じ", 6, 7)]),
  ]);
  assert.equal(result.agreement, 0.5);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((item) => [item.start, item.end]), [[4, 5], [6, 7]]);
  assert.ok(result.items.every((item) => item.majority === null));
});

test("speaker は transcript diff の結果へ影響しない", () => {
  const now = new Date("2026-09-12T00:00:00.000Z");
  const plain = [
    transcript("a", [segment("前後", 0, 2)]),
    transcript("b", [segment("前誤", 0, 2)]),
  ];
  const withSpeakers = plain.map((item, index) => ({
    ...item,
    segments: item.segments.map(value => ({ ...value, speaker: `speaker-${index}` })),
  }));
  assert.deepEqual(compareTranscripts(withSpeakers, { now }), compareTranscripts(plain, { now }));
});

test("複数エンジンの同じ位置への挿入を 1 item に集約し、語時刻を使う", () => {
  const result = compareTranscripts([
    transcript("a", [segment("前後", 0, 3)]),
    transcript("b", [segment("前追加後", 0, 3, { words: [{ text: "前", start: 0, end: 1 }, { text: "追加", start: 1, end: 2 }, { text: "後", start: 2, end: 3 }] })]),
    transcript("c", [segment("前別後", 0, 3, { words: [{ text: "前", start: 0, end: 1 }, { text: "別", start: 1, end: 2 }, { text: "後", start: 2, end: 3 }] })]),
  ]);
  assert.equal(result.agreement, 1);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].texts, { a: "", b: "追加", c: "別" });
  assert.equal(result.items[0].timing, undefined);
  assert.equal(result.items[0].start, 1);
  assert.equal(result.items[0].end, 2);
});

test("--engines の順序・選択を保ち、不正入力 1 / 素材不在 2", async (t) => {
  const f = await fixture(t);
  const lines = [], errors = [];
  const opts = { ...f.options, stdout: (line) => lines.push(line), stderr: (line) => errors.push(line) };
  assert.equal(await runMediaCli(["transcribe-diff", f.target, "--engines", "whisper-cpp,cloud:scribe"], opts), 0);
  assert.deepEqual(JSON.parse(lines[0]).engines, ["whisper-cpp", "cloud-scribe"]);
  for (const value of ["missing", "../cloud-scribe", "cloud-scribe,cloud:scribe", ""]) {
    assert.equal(await runMediaCli(["transcribe-diff", f.target, "--engines", value], opts), 1);
  }
  assert.equal(await runMediaCli(["transcribe-diff", "missing.wav"], opts), 2);
  await putJson(path.join(f.directory, "transcripts/cloud-scribe.json"), { version: 1, backend: "cloud-scribe", segments: [{ start: "invalid" }] });
  assert.equal(await runMediaCli(["transcribe-diff", f.target], opts), 1);
});
