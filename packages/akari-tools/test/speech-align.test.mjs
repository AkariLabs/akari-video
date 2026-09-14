import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  clampAdjacentSegments,
  detectSpeechChunks,
  detectSpeechChunksFromPeaks,
  fitWordsIntoWindow,
  snapSegmentsToWords,
  snapWordsToSpeech,
} from "../src/media/speech-align.mjs";
import { retimeCaptionsToSpeech } from "../src/captions/retime.mjs";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/speech-snap-owner");
const load = async (name) => JSON.parse(await readFile(path.join(fixtures, name), "utf8"));
const { resolveCaptionDisplay } = createRequire(import.meta.url)("../../edit-store/lib/caption-display.js");

function silenceOverlap(word, silence) {
  const [start, end] = Array.isArray(silence) ? silence : [silence.start, silence.end];
  return Math.max(0, Math.min(word.end, end) - Math.max(word.start, start));
}

test("枠内の語は複製するだけで動かさない", () => {
  const input = [{ start: 0.1, end: 0.2, text: "語", raw_start: 0, raw_end: 0.3 }];
  const before = structuredClone(input);
  const result = fitWordsIntoWindow(input, { start: 0, end: 1 });
  assert.equal(result.fitted, 0);
  assert.deepEqual(result.words, before);
  assert.deepEqual(input, before);
  assert.notEqual(result.words, input);
  assert.notEqual(result.words[0], input[0]);
});

test("枠を越える語は最短長が残る範囲で境界だけ切り詰める", () => {
  assert.deepEqual(fitWordsIntoWindow([{ start: 0.2, end: 1.4, text: "末" }], { start: 0, end: 1 }), {
    words: [{ start: 0.2, end: 1, text: "末" }], fitted: 1,
  });
  assert.deepEqual(fitWordsIntoWindow([{ start: 0.4, end: 2, text: "先" }], { start: 1, end: 3 }), {
    words: [{ start: 1, end: 2, text: "先" }], fitted: 1,
  });
});

test("最短語長を確保できない枠は語列全体を線形に写す", () => {
  const result = fitWordsIntoWindow([
    { start: 0, end: 1, text: "a" }, { start: 2, end: 4, text: "b" },
  ], { start: 10, end: 10.08 });
  assert.deepEqual(result.words, [
    { start: 10, end: 10.02, text: "a" }, { start: 10.04, end: 10.08, text: "b" },
  ]);
  assert.equal(result.fitted, 2);
});

test("丸ごと枠外の連続語は末尾から 0.05 秒ずつ後ろ詰めする", () => {
  const result = fitWordsIntoWindow([
    { start: 0.1, end: 0.2, text: "内" },
    { start: 1.5, end: 1.6, text: "外1" },
    { start: 1.7, end: 1.8, text: "外2" },
  ], { start: 0, end: 1 });
  assert.deepEqual(result.words, [
    { start: 0.1, end: 0.2, text: "内" },
    { start: 0.9, end: 0.95, text: "外1" },
    { start: 0.95, end: 1, text: "外2" },
  ]);
  assert.equal(result.fitted, 2);
});

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
  assert.deepEqual([byId("c-0001").start, byId("c-0001").end], [0.53, 2.34]);
  assert.deepEqual([comma.start, comma.end], [2.29, 2.34]);
  assert.deepEqual([byId("c-0002").start, byId("c-0002").end], [2.34, 5.2]);
  assert.equal(byId("c-0005").end, 19.56875);
  assert.equal(byId("c-0006").start, 19.56875);
  for (const [id, expected] of [
    ["c-0003", [5.625714, 8.04]], ["c-0004", [11.24, 13.96]],
    ["c-0007", [23.05, 23.88]], ["c-0008", [24.71, 25.66]],
  ]) assert.deepEqual([byId(id).start, byId(id).end], expected);
  assert.equal(result.clamped_pairs, 2);
  assert.equal(result.overlaps_left, 0);
  assert.equal(result.fitted_words, 4);
  const edited = byId("c-0002");
  assert.ok(edited.words.every((word) => word.start >= 2.34 && word.end <= 5.2));
  assert.deepEqual(edited.words.slice(-4).map(({ text, start, end }) => ({ text, start, end })), [
    { text: "YouTube", start: 4.051429, end: 5.05 },
    { text: "の", start: 5.05, end: 5.1 },
    { text: "撮影", start: 5.1, end: 5.15 },
    { text: "を", start: 5.15, end: 5.2 },
  ]);
  assert.doesNotThrow(() => resolveCaptionDisplay(
    { ...captionData, captions: result.captions },
    { cuts: [], output: { width: 1920, height: 1080 } },
    { output: { width: 1920, height: 1080 } },
  ));
  assert.ok(flattened.some((word) => Object.hasOwn(word, "raw_start") && Object.hasOwn(word, "raw_end")));
});

test("両方自由の重なりは語間に収まる中点で分け合う", () => {
  const result = clampAdjacentSegments([
    { start: 0, end: 1.4, words: [{ start: 0.2, end: 0.9, text: "前" }] },
    { start: 1, end: 2, words: [{ start: 1.3, end: 1.8, text: "後" }] },
  ]);
  assert.deepEqual([result.segments[0].end, result.segments[1].start], [1.2, 1.2]);
  assert.deepEqual([result.clamped_pairs, result.overlaps_left], [1, 0]);
});

test("語が接している両方自由の行は接点を境界にする", () => {
  const result = clampAdjacentSegments([
    { start: 0, end: 1.3, words: [{ start: 0.2, end: 1, text: "前" }] },
    { start: 0.9, end: 2, words: [{ start: 1, end: 1.8, text: "後" }] },
  ]);
  assert.deepEqual([result.segments[0].end, result.segments[1].start], [1, 1]);
});

test("片方が固定なら自由な次行だけを固定 end へ寄せる", () => {
  const result = clampAdjacentSegments([
    { start: 0, end: 1.1, fixed: true, words: [{ start: 0.2, end: 1, text: "前" }] },
    { start: 1, end: 2, words: [{ start: 1.05, end: 1.3, text: "後" }] },
  ]);
  assert.equal(result.segments[0].end, 1.1);
  assert.equal(result.segments[1].start, 1.1);
  assert.equal(result.segments[1].words[0].start, 1.1);
  assert.deepEqual([result.clamped_pairs, result.overlaps_left], [1, 0]);
});

test("固定 start が末尾語へ食い込むと自由側の語を 0.05 秒のまま平行移動する", () => {
  const result = clampAdjacentSegments([
    { start: 0.53, end: 2.48, words: [
      { start: 0.57, end: 1.85, text: "前" }, { start: 2.31, end: 2.36, text: "、" },
    ] },
    { start: 2.34, end: 5.2, fixed: true, words: [{ start: 2.34, end: 2.72, text: "今日" }] },
  ]);
  assert.deepEqual([result.segments[0].end, result.segments[1].start], [2.34, 2.34]);
  assert.deepEqual([result.segments[0].words[1].start, result.segments[0].words[1].end], [2.29, 2.34]);
});

test("固定 start で 0.05 秒以上残る末尾語は start を動かさず切り詰める", () => {
  const result = clampAdjacentSegments([
    { start: 0, end: 1.6, words: [
      { start: 0.2, end: 0.6, text: "a" }, { start: 0.8, end: 1.5, text: "b" },
    ] },
    { start: 1, end: 2, fixed: true, words: [{ start: 1, end: 1.5, text: "c" }] },
  ]);
  assert.deepEqual(result.segments[0].words[1], { start: 0.8, end: 1, text: "b" });
  assert.deepEqual([result.clamped_pairs, result.overlaps_left], [1, 0]);
});

test("固定 end で 0.05 秒以上残る先頭語は end を動かさず切り詰める", () => {
  const result = clampAdjacentSegments([
    { start: 0, end: 1, fixed: true, words: [{ start: 0.2, end: 1, text: "a" }] },
    { start: 0.7, end: 2, words: [
      { start: 0.75, end: 1.6, text: "b" }, { start: 1.8, end: 1.9, text: "c" },
    ] },
  ]);
  assert.deepEqual(result.segments[1].words[0], { start: 1, end: 1.6, text: "b" });
  assert.deepEqual([result.clamped_pairs, result.overlaps_left], [1, 0]);
});

test("両方固定の重なりは残す", () => {
  const result = clampAdjacentSegments([
    { start: 0, end: 1.2, fixed: true, words: [{ start: 0, end: 1, text: "前" }] },
    { start: 1, end: 2, fixed: true, words: [{ start: 1, end: 2, text: "後" }] },
  ]);
  assert.deepEqual([result.clamped_pairs, result.overlaps_left], [0, 1]);
  assert.deepEqual(result.segments.map(({ start, end }) => [start, end]), [[0, 1.2], [1, 2]]);
});

test("語に 0.01 秒も確保できなければ境界を切らず重なりを残す", () => {
  const result = clampAdjacentSegments([
    { start: 0, end: 1.2, words: [
      { start: 0.2, end: 0.995, text: "前" }, { start: 0.995, end: 1.1, text: "端" },
    ] },
    { start: 1, end: 2, fixed: true, words: [{ start: 1, end: 1.5, text: "後" }] },
  ]);
  assert.deepEqual([result.clamped_pairs, result.overlaps_left], [0, 1]);
  assert.equal(result.segments[0].end, 1.2);
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
