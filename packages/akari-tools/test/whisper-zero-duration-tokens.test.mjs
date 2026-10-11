import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeWhisperJson, transcribeMedia } from "../src/media/transcribe.mjs";
import { fixture } from "./fixtures/transcribe-compare/helpers.mjs";

// dogfood の冒頭 3 segment の本文から手書きで最小化。
// 通常トークンをまとめ、末尾併合も検証できるよう第 3 行の末尾を 0 長にしている。
const raw = JSON.parse(readFileSync(new URL("./fixtures/whisper-zero-duration/segments.json", import.meta.url), "utf8"));
const spacedRaw = JSON.parse(readFileSync(new URL("./fixtures/whisper-spaced-tokens.json", import.meta.url), "utf8"));
const legacySpacedJa = JSON.parse(readFileSync(new URL("./fixtures/whisper-spaced-legacy-ja.json", import.meta.url), "utf8"));
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

test("英語の空白を含めて照合し、句読点も落とさない", () => {
  const tokens = [{ text: " hello", start: 0, end: 1 }, { text: " world!", start: 1, end: 2 }];
  const segment = normalizeTokens("hello world!", tokens);
  assert.deepEqual(segment.words.map((word) => word.text), ["hello", " world!"]);
  assert.equal(segment.words.map((word) => word.text).join(""), segment.text);
  const withoutSpaces = normalizeTokens("helloworld!", tokens);
  assert.deepEqual(withoutSpaces.words.map((word) => word.text), ["hello", "world!"]);
  assert.equal(withoutSpaces.words.map((word) => word.text).join(""), withoutSpaces.text);
  assert.equal(Object.hasOwn(normalizeTokens("hello world", tokens), "words"), false);
});

test("English Whisper tokens keep word spaces and attach punctuation and contractions", () => {
  const input = { segments: [{ start: 0, end: 2, text: "let me's, go", tokens: [
    { text: " let", start: 0.1, end: 0.3 },
    { text: " me", start: 0.4, end: 0.6 },
    { text: "'s", start: 0.6, end: 0.7 },
    { text: ",", start: 0.7, end: 0.75 },
    { text: " go", start: 0.9, end: 1.2 },
  ] }] };
  const [english] = normalizeWhisperJson(input, "en");
  assert.deepEqual(english.words, [
    { start: 0.1, end: 0.3, text: "let" },
    { start: 0.4, end: 0.7, text: " me's," },
    { start: 0.9, end: 1.2, text: " go" },
  ]);
  assert.equal(english.words.map((word) => word.text).join(""), english.text);
  assert.equal(/letme|me's,go/u.test(english.text), false);
  // The Japanese path must retain its original token-by-token assembly.
  assert.deepEqual(normalizeWhisperJson(input, "ja")[0].words, [
    { start: 0.1, end: 0.3, text: "let" },
    { start: 0.4, end: 0.6, text: " me" },
    { start: 0.6, end: 0.7, text: "'s" },
    { start: 0.7, end: 0.75, text: "," },
    { start: 0.9, end: 1.2, text: " go" },
  ]);
});

test("Whisper's zero-length English tokens keep every word and the Japanese path matches the original snapshot", () => {
  const segments = normalizeWhisperJson(spacedRaw, "en");
  assert.equal(segments.length, spacedRaw.transcription.length);
  const joined = segments.map((segment) => {
    assert.ok(segment.words?.length > 0);
    assert.ok(segment.words.every((word) => word.end > word.start));
    const text = segment.words.map((word) => word.text).join("");
    assert.equal(text.replace(/\s+/gu, " ").trim(), segment.text.replace(/\s+/gu, " ").trim());
    return text;
  }).join(" ");
  assert.doesNotMatch(joined, /letme|alittle|yourmouth|liketohear|Heyeveryone|'swhat|Okay,seeyou/u);
  assert.deepEqual(segments[0].words.filter((word) => ["let", "me"].includes(word.text.trim())).map((word) => word.text.trim()), ["let", "me"]);
  assert.deepEqual(segments[2].words.filter((word) => ["Okay,", "see", "you"].includes(word.text.trim())).map((word) => word.text.trim()), ["Okay,", "see", "you"]);
  assert.deepEqual(segments[3].words.at(-1), { start: 9.825, end: 10, text: " I?" });
  assert.deepEqual(segments[4].words, [{ start: 11, end: 11.1, text: "Bye." }]);
  const japanesePath = normalizeWhisperJson(spacedRaw, "ja");
  assert.deepEqual(japanesePath.map(({ start, end, text }) => ({ start, end, text })),
    legacySpacedJa.map(({ start, end, text }) => ({ start, end, text })));
  assert.deepEqual(japanesePath.map(segment => segment.words?.map(({ start, end }) => ({ start, end }))),
    legacySpacedJa.map(segment => segment.words?.map(({ start, end }) => ({ start, end }))));
  assert.deepEqual(japanesePath.map(segment => segment.words?.map(word => word.text).join('').replace(/\s/gu, '')),
    legacySpacedJa.map(segment => segment.words?.map(word => word.text).join('').replace(/\s/gu, '')));
});

test("punctuation-only Whisper tokens keep text without extending the preceding word", () => {
  const [segment] = normalizeWhisperJson({ result: { language: "en" }, transcription: [{
    offsets: { from: 0, to: 1200 }, text: "Hello, world.", tokens: [
      { offsets: { from: 100, to: 300 }, text: " Hello" },
      { offsets: { from: 300, to: 500 }, text: "," },
      { offsets: { from: 600, to: 800 }, text: " world" },
      { offsets: { from: 800, to: 1100 }, text: "." },
    ],
  }] }, "en");
  assert.deepEqual(segment.words, [
    { start: 0.1, end: 0.3, text: "Hello," },
    { start: 0.6, end: 0.8, text: " world." },
  ]);
});

test("Whisper language tags and auto detection preserve Japanese token assembly", () => {
  const input = { transcription: [{ start: 0, end: 2, text: "こんにちは、", tokens: [
    { text: " こん", start: 0.1, end: 0.4 },
    { text: " にち", start: 0.4, end: 0.8 },
    { text: " は", start: 0.8, end: 1.1 },
    { text: "、", start: 1.1, end: 1.2 },
  ] }] };
  const legacy = normalizeWhisperJson(input, "ja");
  assert.deepEqual(legacy[0].words, [
    { start: 0.1, end: 0.4, text: "こん" },
    { start: 0.4, end: 0.8, text: "にち" },
    { start: 0.8, end: 1.1, text: "は" },
    { start: 1.1, end: 1.2, text: "、" },
  ]);
  assert.deepEqual(normalizeWhisperJson({ ...input, result: { language: "ja" } }, "auto"), legacy);
  assert.deepEqual(normalizeWhisperJson(input, "ja-JP"), legacy);
  assert.deepEqual(normalizeWhisperJson(input, "auto"), legacy);
  assert.deepEqual(normalizeWhisperJson(input, "und"), legacy);
  assert.deepEqual(normalizeWhisperJson(input, "zz"), legacy);
  assert.deepEqual(normalizeWhisperJson(input, "zh-CN"), legacy);
});

test("Whisper auto detection and regional English tags group space-delimited words", () => {
  const input = { transcription: [{ start: 0, end: 2, text: "let me go", tokens: [
    { text: " let", start: 0.1, end: 0.3 },
    { text: " me", start: 0.4, end: 0.6 },
    { text: " go", start: 0.7, end: 1 },
  ] }] };
  const expected = [
    { start: 0.1, end: 0.3, text: "let" },
    { start: 0.4, end: 0.6, text: " me" },
    { start: 0.7, end: 1, text: " go" },
  ];
  for (const [raw, language] of [
    [{ ...input, result: { language: "en" } }, "auto"],
    [input, "en-US"],
    [{ ...input, language: "en" }, "unknown"],
    [{ ...input, result: { language: "en" } }, "zz"],
  ]) {
    const [segment] = normalizeWhisperJson(raw, language);
    assert.deepEqual(segment.words, expected);
    assert.equal(segment.words.map((word) => word.text).join(""), segment.text);
  }
});

test("英語のゼロ長トークンを空白ごと次の語へ併合する", () => {
  const segment = normalizeTokens("When the score is high,", [
    { text: " When", start: 0, end: 0.4 },
    { text: " the", start: 0.5, end: 0.5 },
    { text: " score", start: 0.6, end: 1 },
    { text: " is", start: 1.1, end: 1.3 },
    { text: " high", start: 1.4, end: 1.8 },
    { text: ",", start: 1.8, end: 2 },
  ]);
  assert.deepEqual(segment.words.map((word) => word.text), ["When", " the score", " is", " high", ","]);
  assert.equal(segment.words.map((word) => word.text).join(""), segment.text);
});

test("日本語の行頭と全角文字間に紛れた空白を除く", () => {
  const segment = normalizeTokens("今日は晴れ", [
    { text: " 今日", start: 0, end: 0.5 },
    { text: " は", start: 0.5, end: 1 },
    { text: " 晴れ", start: 1, end: 2 },
  ]);
  assert.deepEqual(segment.words.map((word) => word.text), ["今日", "は", "晴れ"]);
  assert.equal(segment.words.map((word) => word.text).join(""), segment.text);
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

test("別バックエンドの英語語列も本文の空白に合わせる", async (t) => {
  const [segment] = await normalizeThroughTranscribe(t, [{ start: 0, end: 3, text: "When the score", words: [
    { text: "When", start: 0, end: 0.5 },
    { text: "the", start: 0.5, end: 1 },
    { text: "score", start: 1, end: 2 },
  ] }]);
  assert.deepEqual(segment.words.map((word) => word.text), ["When", " the", " score"]);
  assert.equal(segment.words.map((word) => word.text).join(""), segment.text);
});

test("normalizeSegments の不一致・全語範囲外は本文だけを返す", async (t) => {
  const segments = await normalizeThroughTranscribe(t, [
    { start: 0, end: 1, text: "はい", words: [{ text: "い", start: 0, end: 1 }] },
    { start: 1, end: 2, text: "はい", words: [{ text: "はい", start: 3, end: 4 }] },
  ]);
  assert.deepEqual(segments, [{ start: 5, end: 6, text: "はい" }, { start: 6, end: 7, text: "はい" }]);
});
