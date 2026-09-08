import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeWhisperJson, transcribeMedia } from "../src/media/transcribe.mjs";
import { fixture } from "./fixtures/transcribe-compare/helpers.mjs";

// dogfood の冒頭 3 segment の本文から手書きで最小化。
// 通常トークンをまとめ、末尾併合も検証できるよう第 3 行の末尾を 0 長にしている。
const raw = JSON.parse(readFileSync(new URL("./fixtures/whisper-zero-duration/segments.json", import.meta.url), "utf8"));
const joined = (segment) => segment.words.map((word) => word.text).join("").replace(/\s/g, "");
const normalizeTokens = (text, tokens) => normalizeWhisperJson({ segments: [{ start: 0, end: 3, text, tokens }] })[0];

test("3 segment とも 0 長トークンを失わず本文と一致し、制御トークンは残さない", () => {
  const segments = normalizeWhisperJson(raw);
  assert.equal(segments.length, 3);
  for (const segment of segments) {
    assert.equal(joined(segment), segment.text.replace(/\s/g, ""));
    assert.ok(segment.words.every((word) => word.end > word.start));
    assert.doesNotMatch(joined(segment), /\[_/);
  }
  assert.deepEqual(segments[0].words[0], { start: 0.18, end: 0.26, text: "オス" });
  assert.deepEqual(segments[0].words[1], { start: 0.26, end: 1.07, text: "!AIで有" });
  assert.equal(segments[0].words[2].start, 1.07);
  assert.deepEqual(segments[1].words[1], { start: 5.16, end: 7.05, text: "もやっていきたいと思います" });
  assert.deepEqual(segments[2].words, [{ start: 7.11, end: 11.19, text: segments[2].text }]);
});

test("連続する 0 長・負長は次の通常語へ順番どおり付け、最初の from を使う", () => {
  const segment = normalizeTokens("あいうえお", [
    { text: "あ", start: 0, end: 0 },
    { text: "い", start: 0.2, end: 0.1 },
    { text: "う", start: 0.5, end: 1 },
    { text: "え", start: 1.2, end: 1.2 },
    { text: "お", start: 1.5, end: 1.4 },
  ]);
  assert.deepEqual(segment.words, [{ start: 0, end: 1, text: "あいうえお" }]);
});

test("非発話マーカーは長さにかかわらず除外し、正の長さだけ時刻を残す", () => {
  const segment = normalizeTokens("はい", [
    { text: "[Music]", start: 0, end: 0 },
    { text: "[_BEG_]", start: 0, end: 0.2 },
    { text: "は", start: 0.3, end: 0.3 },
    { text: "[Music]", start: 0.3, end: 0.4 },
    { text: "い", start: 0.5, end: 1 },
  ]);
  assert.deepEqual(segment.words, [{ start: 0.3, end: 1, text: "はい" }]);
  assert.deepEqual(segment.markers, [{ start: 0.3, end: 0.4 }]);
});

test("連結不一致や併合先なしは words も追加の不整合フラグも付けない", () => {
  for (const tokens of [
    [{ text: "い", start: 0, end: 1 }],
    [{ text: "はい", start: 0, end: 0 }],
    [{ text: "は", start: 0, end: 0 }, { text: "い", start: 1, end: 1 }],
    [{ text: "はい", start: NaN, end: 1 }],
  ]) {
    assert.deepEqual(normalizeTokens("はい", tokens), { start: 0, end: 3, text: "はい" });
  }
});

test("一致比較では空白を除き、句読点は落とさない", () => {
  const tokens = [{ text: " hello", start: 0, end: 1 }, { text: "world!", start: 1, end: 2 }];
  assert.equal(joined(normalizeTokens("hello \n world!", tokens)), "helloworld!");
  assert.equal(Object.hasOwn(normalizeTokens("hello world", tokens), "words"), false);
});

async function normalizeThroughTranscribe(t, segments) {
  const f = await fixture(t, []);
  const result = await transcribeMedia(f.target, {
    ...f.options, backend: "speech-analyzer", speechAnalyzerAvailable: true,
    in: 5, out: 8, unrecognized: false, noRecord: true, wordBook: false,
    backendRunner: async () => segments,
  });
  return result.segments;
}

test("segment と抽出範囲の両端でクランプされた語も併合し、時刻を境界へ寄せる", async (t) => {
  const [segment] = await normalizeThroughTranscribe(t, [{ start: 0.5, end: 4, text: "あいうえお", words: [
    { text: "あ", start: -1, end: 0 },
    { text: "い", start: 0, end: 0.5 },
    { text: "う", start: 0.7, end: 2 },
    { text: "え", start: 3, end: 3.5 },
    { text: "お", start: 4, end: 5 },
  ] }]);
  assert.deepEqual(segment, { start: 5.5, end: 8, text: "あいうえお", words: [
    { start: 5.5, end: 7, text: "あいうえお" },
  ] });
});

test("normalizeSegments も途中の負長語を次へ併合する", async (t) => {
  const [segment] = await normalizeThroughTranscribe(t, [{ start: 0, end: 3, text: "あいう", words: [
    { text: "あ", start: 0, end: 0.5 },
    { text: "い", start: 1, end: 0.9 },
    { text: "う", start: 1.5, end: 2 },
  ] }]);
  assert.deepEqual(segment.words, [{ start: 5, end: 5.5, text: "あ" }, { start: 6, end: 7, text: "いう" }]);
});

test("normalizeSegments の不一致・全語範囲外は本文だけを返す", async (t) => {
  const segments = await normalizeThroughTranscribe(t, [
    { start: 0, end: 1, text: "はい", words: [{ text: "い", start: 0, end: 1 }] },
    { start: 1, end: 2, text: "はい", words: [{ text: "はい", start: 3, end: 4 }] },
  ]);
  assert.deepEqual(segments, [{ start: 5, end: 6, text: "はい" }, { start: 6, end: 7, text: "はい" }]);
});
