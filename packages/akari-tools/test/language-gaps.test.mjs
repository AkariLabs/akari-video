import assert from "node:assert/strict";
import test from "node:test";
import {
  detectLanguageGaps,
  insertRecoveredSegments,
  LANGUAGE_GAP_MAX_RETRIES,
  LANGUAGE_GAP_MIN_DETECT_PROBABILITY,
  LANGUAGE_GAP_MIN_SECONDS,
  LANGUAGE_GAP_MIN_VOICED_SECONDS,
  LANGUAGE_GAP_PADDING_SECONDS,
} from "../src/media/language-gaps.mjs";

test("行間と両端から長さと有声時間を満たす抜けだけを見つける", () => {
  const segments = [{ start: 2, end: 11, text: "前" }, { start: 24, end: 29, text: "後" }];
  const silences = [
    { start: 0, end: 1.5 },
    { start: 11, end: 13 },
    { start: 23, end: 24 },
    { start: 29, end: 34 },
  ];
  assert.deepEqual(detectLanguageGaps(segments, silences, { in: 0, out: 36 }), [
    { start: 11, end: 24 }, { start: 29, end: 36 },
  ]);
  assert.deepEqual(detectLanguageGaps(segments, [{ start: 0, end: 36 }], { in: 0, out: 36 }), []);
  assert.equal(LANGUAGE_GAP_MIN_SECONDS, 1.5);
  assert.equal(LANGUAGE_GAP_MIN_VOICED_SECONDS, 1);
  assert.equal(LANGUAGE_GAP_PADDING_SECONDS, 0.2);
  assert.equal(LANGUAGE_GAP_MAX_RETRIES, 20);
  assert.equal(LANGUAGE_GAP_MIN_DETECT_PROBABILITY, 0.95);
});

test("起こし直した行と語を元の時刻へ戻し、順序を保つ", () => {
  const before = [{ start: 0, end: 2, text: "前" }, { start: 8, end: 10, text: "後" }];
  const recovered = [{ start: 0.2, end: 2.2, text: "Hello world", words: [
    { start: 0.2, end: 1, text: "Hello" },
    { start: 1, end: 2.2, text: " world" },
  ], markers: [{ start: 1.2, end: 1.3 }] }];
  const inserted = insertRecoveredSegments(before, recovered, { start: 3, end: 7 }, 2.8);
  assert.deepEqual(inserted.map((segment) => segment.text), ["前", "Hello world", "後"]);
  assert.deepEqual(inserted[1].words.map((word) => [word.start, word.end]), [[3, 3.8], [3.8, 5]]);
  assert.deepEqual(inserted[1].markers, [{ start: 4, end: 4.1 }]);
  assert.deepEqual(before.map((segment) => segment.text), ["前", "後"]);
  assert.deepEqual(recovered[0].words[0], { start: 0.2, end: 1, text: "Hello" });
});

test("余白で拾った区間外の語を落とし、本文を残った語へ合わせる", () => {
  const recovered = [{ start: 0, end: 3.5, text: "前 Hello world 後", words: [
    { start: 0, end: 0.2, text: "前" },
    { start: 0.4, end: 1, text: " Hello" },
    { start: 1.1, end: 2, text: " world" },
    { start: 3.3, end: 3.5, text: " 後" },
  ] }];
  const inserted = insertRecoveredSegments([], recovered, { start: 3, end: 5 }, 2.8);
  assert.equal(inserted[0].text, "Hello world");
  assert.deepEqual(inserted[0].words.map((word) => word.text), ["Hello", " world"]);
  assert.equal(inserted[0].words.map((word) => word.text).join(""), inserted[0].text);
});
