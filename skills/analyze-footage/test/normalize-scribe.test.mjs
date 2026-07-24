import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { normalizeScribe } from "../bin/transcribe-cloud.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.join(here, "fixtures", "scribe-punctuation-inflation.json"), "utf8"),
);

test("句読点トークンの無音を末尾語の end へ膨張させない（隙間の原則）", () => {
  const segments = normalizeScribe(fixture);

  // 文末の「。」で 2 文にセグメント化される。
  assert.equal(segments.length, 2);

  const [first, second] = segments;

  // 第 1 文: 末尾語は「ね。」で、end は実発話の end（2823.12）を維持する。
  // 句読点トークン「。」の膨張 end（2826.84）を吸わない。
  assert.equal(first.text, "はいもう、書き出し終わりましたね。");
  assert.equal(first.words.at(-1).text, "ね。");
  assert.equal(first.words.at(-1).end, 2823.12);
  assert.equal(first.end, 2823.12);
  assert.notEqual(first.end, 2826.84);

  // 第 2 文: 末尾語は「です。」で、end は実発話の end（3729.20）を維持する。
  // 句読点トークン「。」の膨張 end（3731.399）を吸わない。
  assert.equal(second.text, "これ無料です。");
  assert.equal(second.words.at(-1).text, "です。");
  assert.equal(second.words.at(-1).end, 3729.20);
  assert.equal(second.end, 3729.20);
  assert.notEqual(second.end, 3731.399);
});

test("句読点のみのトークンは独立 word として残さない", () => {
  const segments = normalizeScribe(fixture);
  for (const segment of segments) {
    for (const word of segment.words) {
      assert.ok(
        !/^[。、！？!?,.]+$/.test(word.text),
        `句読点のみの word が残っている: ${JSON.stringify(word)}`,
      );
    }
  }
});

test("ゼロ幅の読点も直前語へ結合する（既存挙動の非退行）", () => {
  const segments = normalizeScribe(fixture);
  // 「もう」+ ゼロ幅「、」→「もう、」。end は「もう」の end（2821.62）のまま。
  const mou = segments[0].words.find((word) => word.text.startsWith("もう"));
  assert.equal(mou.text, "もう、");
  assert.equal(mou.end, 2821.62);
});

test("words が無い応答は空配列を返す（非退行）", () => {
  assert.deepEqual(normalizeScribe({}), []);
  assert.deepEqual(normalizeScribe(null), []);
  assert.deepEqual(normalizeScribe({ words: [] }), []);
});

test("句読点なし・2 秒以上の無音で文分割する（非退行）", () => {
  const segments = normalizeScribe({
    words: [
      { text: "こんにちは", start: 1.0, end: 1.8 },
      { text: "今日", start: 5.0, end: 5.4 },
    ],
  });
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, "こんにちは");
  assert.equal(segments[0].end, 1.8);
  assert.equal(segments[1].text, "今日");
});
