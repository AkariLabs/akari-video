import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  detectSpeechChunks,
  detectSpeechChunksFromPeaks,
  snapSegmentsToWords,
  snapWordsToSpeech,
} from "../src/media/speech-align.mjs";
import { retimeCaptionsToSpeech } from "../src/captions/retime.mjs";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/speech-snap-owner");
const load = async (name) => JSON.parse(await readFile(path.join(fixtures, name), "utf8"));

function silenceOverlap(word, silence) {
  const [start, end] = Array.isArray(silence) ? silence : [silence.start, silence.end];
  return Math.max(0, Math.min(word.end, end) - Math.max(word.start, start));
}

test("silencedetect の無音一覧を正規化して補集合を返す", () => {
  assert.deepEqual(detectSpeechChunks({ silences: [[1, 2], { start: 1.8, end: 3 }, [-1, 0.2]], duration: 4 }), [
    { start: 0.2, end: 1 }, { start: 3, end: 4 },
  ]);
});

test("RMS 版は旧実装の適応しきい値・gap merge・最短長を保つ", () => {
  const rms = Float32Array.from([0.01, 0.01, 0.2, 0.2, 0.01, 0.2, 0.2, 0.01]);
  assert.deepEqual(detectSpeechChunksFromPeaks(rms, 0.1, { minSpeechSec: 0.1, minGapSec: 0.11 }), [
    { start: 0.2, end: 0.7 },
  ]);
});

test("オーナー実データを発話へ吸着し本文・語数・edited 行境界を保つ", async () => {
  const [silenceData, captionData] = await Promise.all([load("silences-owner.json"), load("captions-owner.json")]);
  const before = captionData.captions;
  const textBefore = before.map((row) => row.text);
  const wordCountBefore = before.reduce((sum, row) => sum + row.words.length, 0);
  const editedBefore = before.filter((row) => row.edited).map((row) => ({ id: row.id, start: row.start, end: row.end }));
  const result = retimeCaptionsToSpeech(before, { silences: silenceData.silences, duration: 26.16, source: "src-1" });
  const byId = (id) => result.captions.find((row) => row.id === id);
  assert.equal(byId("c-0004").words.find((word) => word.text === "いい").start, 11.30);
  assert.equal(byId("c-0004").words.find((word) => word.text === "感じ").end, 12.124);
  assert.equal(byId("c-0005").words.find((word) => word.text === "ゴ").start, 16.14);
  assert.deepEqual(result.captions.map((row) => row.text), textBefore);
  assert.equal(result.total, wordCountBefore);
  assert.equal(result.captions.reduce((sum, row) => sum + row.words.length, 0), wordCountBefore);
  assert.deepEqual(result.captions.filter((row) => row.edited).map((row) => ({ id: row.id, start: row.start, end: row.end })), editedBefore);
  const flattened = result.captions.flatMap((row) => row.words);
  for (const word of flattened) {
    assert.equal(Math.max(...silenceData.silences.map((silence) => silenceOverlap(word, silence))), 0, `${word.text}: ${word.start}-${word.end}`);
    assert.ok(word.end - word.start >= 0.05 - 1e-6);
  }
  for (let index = 1; index < flattened.length; index += 1) {
    assert.ok(flattened[index].start >= flattened[index - 1].end,
      `${flattened[index - 1].text} ${flattened[index - 1].end} -> ${flattened[index].text} ${flattened[index].start}`);
  }
  const comma = byId("c-0001").words.find((word) => word.text === "、");
  const today = byId("c-0002").words.find((word) => word.text === "今日");
  assert.ok(comma.end <= today.start, `読点 ${comma.start}-${comma.end} -> 今日 ${today.start}-${today.end}`);
  assert.equal(result.moved, 52);
  assert.ok(flattened.some((word) => Object.hasOwn(word, "raw_start") && Object.hasOwn(word, "raw_end")));
});

test("短い語は発話チャンク内に留まり、最短 0.05 秒へ延ばす", () => {
  const result = snapWordsToSpeech([{ start: 2.31, end: 2.34, text: "、" }], [{ start: 1.61, end: 2.73 }]);
  assert.deepEqual(result.words[0], { start: 2.31, end: 2.36, text: "、", raw_start: 2.31, raw_end: 2.34 });
});

test("チャンク境界と衝突しても平坦化語列の単調性を優先する", () => {
  const result = snapWordsToSpeech([
    { start: 1.2, end: 1.4, text: "先" },
    { start: 0.8, end: 0.95, text: "後" },
  ], [{ start: 0, end: 1 }, { start: 2, end: 3 }]);
  assert.ok(result.words[1].start >= result.words[0].end);
  assert.ok(result.words.every((word) => word.end - word.start >= 0.05 - 1e-6));
});

test("丸ごと無音の連続語は次の発話チャンクへ文字数比で再配分される", () => {
  const result = snapWordsToSpeech([
    { start: 1, end: 1.2, text: "一" },
    { start: 1.2, end: 1.4, text: "長い" },
  ], [{ start: 2, end: 2.9 }]);
  assert.equal(result.words[0].start, 2);
  assert.ok(result.words[1].end - result.words[1].start > result.words[0].end - result.words[0].start);
  assert.ok(result.words[1].start >= result.words[0].end);
});

test("行境界は語に旧既定余白を付け、最短 0.3 秒を保証する", () => {
  assert.deepEqual(snapSegmentsToWords([{ start: 9, end: 10, words: [{ start: 1, end: 1.05, text: "語" }] }]), [
    { start: 0.94, end: 1.24, words: [{ start: 1, end: 1.05, text: "語" }] },
  ]);
});
