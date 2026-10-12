import { after } from 'node:test';
import { setLanguage } from '../../i18n/index.mjs';

setLanguage('ja');
after(() => setLanguage(undefined));
import assert from "node:assert/strict";
import test from "node:test";
import { buildCaptionsFromTranscript as build } from "../src/captions/build.mjs";
import { readFileSync } from 'node:fs';
import { captionLength } from "../src/captions/build.mjs";

const segment = (start, end, text = "字幕") => ({ start, end, text, words: [{ start, end, text }] });

test("word boundaries preserve silence and source metadata deterministically", () => {
  const first = { ...segment(0, 2), start: 0, end: 3, speaker: "speaker-1", unrecognized: [] };
  const input = [segment(8, 10), first, segment(4, 6)];
  const before = JSON.stringify(input);
  const result = build(input, { src: "s1", idStart: 7 });
  assert.equal(result.captions[0].end, first.words.at(-1).end + 0.3);
  assert.ok(result.captions[1].start - result.captions[0].end > 1);
  assert.deepEqual(result.captions.map((cue) => cue.sourceRef.segment), [1, 2, 0]);
  assert.equal(result.captions[0].id, "c-0007");
  assert.equal(result.captions[0].speaker, "speaker-1");
  assert.equal(result.captions[0].src, "s1");
  assert.equal(result.captions[0].edited, false);
  assert.equal(result.captions[0].words, first.words);
  // 契約 §3: 空の unrecognized[] はキーごと書かない。
  assert.ok(!Object.hasOwn(result.captions[0], "unrecognized"));
  assert.ok(!Object.hasOwn(result.captions[0], "time_domain"));
  assert.deepEqual(result.warnings, []);
  assert.equal(JSON.stringify(result), JSON.stringify(build(input, { src: "s1", idStart: 7 })));
  assert.equal(JSON.stringify(input), before);
});

test("readout is capped at the next caption start", () => {
  const { captions } = build([segment(0, 2), segment(2.1, 4)]);
  assert.equal(captions[0].end, captions[1].start);
});

test("short captions reach the floor only where space permits", () => {
  assert.equal(build([segment(1, 1.4), segment(4, 6)]).captions[0].end, 2);
  const result = build([segment(0, 0.4), segment(0.6, 2)]);
  assert.equal(result.captions[0].end, 0.6);
  assert.equal(result.captions.length, 2);
  assert.match(result.warnings[0], /c-0001/);
});

test("missing and empty words use segment boundaries without splitting", () => {
  for (const extra of [{}, { words: [] }]) {
    const { captions, warnings } = build([{ start: 1.12345, end: 3.23456, text: "  語時刻なし字幕  ", ...extra }], { maxCharacters: 3 });
    assert.equal(captions[0].start, 1.123);
    assert.equal(captions[0].end, 3.535);
    assert.equal(captions[0].text, "語時刻なし字幕");
    assert.ok(!Object.hasOwn(captions[0], "src"));
    assert.equal(warnings.length, 1);
  }
});

test("本文と語が一致しなくても字幕の words を残す", () => {
  const words = [{ start: 0, end: 1, text: "別の語" }];
  const [caption] = build([{ start: 0, end: 1, text: "字幕本文", words }],
    { splitMode: "none", maxCharacters: 0 }).captions;
  assert.equal(caption.text, "字幕本文");
  assert.deepEqual(caption.words, words);
  const [withoutWords] = build([{ start: 0, end: 1, text: "字幕本文" }],
    { splitMode: "none", maxCharacters: 0 }).captions;
  assert.equal(Object.hasOwn(withoutWords, "words"), false);
});

test("25 characters in eight words split greedily at ten characters", () => {
  const words = ["あいう", "えおか", "きくけ", "こさし", "すせそ", "たちつ", "てとな", "にぬねの"]
    .map((text, index) => ({ text, start: index * 2, end: index * 2 + 1 }));
  const text = words.map((word) => word.text).join("");
  assert.equal(Array.from(text).length, 25);
  const { captions } = build([{ start: 0, end: 15, text, words }], { splitMode: "none", maxCharacters: 10 });
  assert.deepEqual(captions.map((cue) => Array.from(cue.text).length), [9, 9, 7]);
  assert.deepEqual(captions.flatMap((cue) => cue.words), words);
  assert.equal(captions.map((cue) => cue.text).join(""), text);
  for (const cue of captions) {
    assert.equal(cue.start, cue.words[0].start);
    assert.equal(cue.end, cue.words.at(-1).end + 0.3);
  }
});

test("英語の半角を半字として数え、語間の空白を保つ", () => {
  const words = ["hello", "world", "again"].map((text, i) => ({ text, start: i * 2, end: i * 2 + 1 }));
  const captions = build([{ start: 0, end: 5, text: "hello world again", words }], { splitMode: "none", maxCharacters: 6 }).captions;
  assert.deepEqual(captions.map((cue) => cue.text), ["hello world", "again"]);
  for (const cue of captions) assert.equal(cue.words.map((word) => word.text).join(""), cue.text);
  assert.equal(captionLength("ABC 12,。"), 4.5);
  assert.equal(captionLength("ｶﾅ"), 2);
  const large = segment(0, 2, "😀😀😀😀");
  assert.equal(build([large], { maxCharacters: 3 }).captions[0].text, large.text);
});

test("英語の行を分けた後の先頭語から空白を除く", () => {
  const words = ["When", " the", " score", " is", " high", ",", " we", " win"]
    .map((text, index) => ({ text, start: index * 0.3, end: index * 0.3 + 0.2 }));
  const text = words.map((word) => word.text).join("");
  const captions = build([{ start: 0, end: 3, text, words }], { splitMode: "none", maxCharacters: 6 }).captions;
  assert.ok(captions.length > 1);
  for (const cue of captions) {
    assert.doesNotMatch(cue.text, /^\s/u);
    assert.doesNotMatch(cue.words[0].text, /^\s/u);
    assert.equal(cue.words.map((word) => word.text).join(""), cue.text);
  }
  assert.match(captions.map((cue) => cue.text).join(" "), /When the score/u);
});

test("本文に無い空白を字幕に足さない", () => {
  for (const surfaces of [["AK", "ARI", "の"], ["29", "800", "円"], ["GPT", "4"], ["すごい!", "AIが"]]) {
    const text = surfaces.join("");
    const words = surfaces.map((word, index) => ({ text: word, start: index, end: index + 0.5 }));
    const cue = build([{ start: 0, end: 3, text, words }], { splitMode: "none", maxCharacters: 0 }).captions[0];
    assert.equal(cue.text, text);
    assert.equal(cue.words.map((word) => word.text).join(""), text);
  }
});

test("数字の区切りを保ち、本文の英語の空白を優先する", () => {
  for (const value of ["3.5", "1,000", "10:30"]) {
    const words = value.match(/\d+|[.,:]/gu).map((text, index) => ({ text, start: index, end: index + 0.5 }));
    const cue = build([{ start: 0, end: words.length, text: value, words }],
      { splitMode: "none", maxCharacters: 0 }).captions[0];
    assert.equal(cue.text, value);
    assert.equal(cue.words.map((word) => word.text).join(""), value);
    assert.equal(cue.words, words);
  }
  const surfaces = ["Hello", "world", "again"];
  const words = surfaces.map((text, index) => ({ text, start: index, end: index + 0.5 }));
  const spaced = build([{ start: 0, end: 3, text: "Hello  world again", words }],
    { splitMode: "none", maxCharacters: 0 }).captions[0];
  assert.equal(spaced.text, "Hello  world again");
  assert.deepEqual(spaced.words.map((word) => word.text), ["Hello", "  world", " again"]);
});

test("empty text is dropped and warned about; original indexes remain stable", () => {
  const { captions, warnings } = build([segment(0, 1, " \n "), segment(2, 4)]);
  assert.equal(captions.length, 1);
  assert.deepEqual(captions[0].sourceRef, { segment: 1 });
  assert.match(warnings[0], /segment 0/);
});

test("invalid numeric options are rejected", () => {
  for (const options of [{ readoutSeconds: NaN }, { readoutSeconds: -1 }, { minDurationSeconds: Infinity }, { maxCharacters: -1 }, { maxCharacters: 1.5 }, { idStart: 10000 }]) {
    assert.throws(() => build([], options));
  }
});


test("split pieces cap readout at the following word and warn below the floor", () => {
  const words = [{ start: 0, end: 0.4, text: "前半" }, { start: 0.5, end: 2, text: "後半" }];
  const { captions, warnings } = build([{ start: 0, end: 2, text: "前半後半", words }], { maxCharacters: 2 });
  assert.equal(captions[0].end, captions[1].start);
  assert.deepEqual(captions.map((cue) => cue.sourceRef), [{ segment: 0 }, { segment: 0 }]);
  assert.equal(warnings.length, 1);
});

test("segment の speaker を全分割 caption へ写し、無ければ null にする", () => {
  const words = [
    { start: 0, end: 1, text: "前半" },
    { start: 1, end: 2, text: "後半" },
  ];
  const { captions } = build([{ start: 0, end: 2, text: "前半後半", words, speaker: "speaker-a" }], {
    splitMode: "none", maxCharacters: 2,
  });
  assert.deepEqual(captions.map(caption => caption.speaker), ["speaker-a", "speaker-a"]);
  assert.equal(build([segment(0, 1)]).captions[0].speaker, null);
});

const phraseSegment = (text, surfaces = Array.from(text)) => ({
  start: 0, end: surfaces.length * 0.2,
  text, words: surfaces.map((text, i) => ({ text, start: i * 0.2, end: (i + 1) * 0.2 })),
});
const texts = (result) => result.captions.map((cue) => cue.text);

test("phrase mode always splits sentence endings, including punctuation absent from words", () => {
  for (const mark of ["。", "！", "？", "!", "?"]) {
    assert.deepEqual(texts(build([phraseSegment(`前半${mark} 後半`, ["前半", "後半"])])), [`前半${mark}`, "後半"]);
  }
});

test("phrase mode splits gaps at the pause threshold", () => {
  const input = { start: 0, end: 4, text: "前半後半", words: [{ text: "前半", start: 0, end: 1 }, { text: "後半", start: 1.6, end: 4 }] };
  assert.deepEqual(texts(build([input])), ["前半", "後半"]);
  assert.deepEqual(texts(build([input], { pauseSeconds: 0.7 })), ["前半後半"]);
});

test("25 characters prefer the last comma before the character limit", () => {
  const text = "あいうえお、かきくけこ、さしすせそたちつてとなにぬ";
  assert.equal(Array.from(text).length, 25);
  const result = build([phraseSegment(text)]);
  assert.deepEqual(texts(result), ["あいうえお、かきくけこ、", "さしすせそたちつてとなにぬ"]);
  assert.equal(texts(result).join(""), text);
});

test("25 characters without commas split greedily at whole words", () => {
  const words = ["あいう", "えおか", "きくけ", "こさし", "すせそ", "たちつ", "てとな", "にぬねの"];
  assert.deepEqual(texts(build([phraseSegment(words.join(""), words)])), [words.slice(0, 6).join(""), words.slice(6).join("")]);
});

test("duration limit uses word span and prefers commas", () => {
  const input = { start: 0, end: 9, text: "前、次最後", words: [{ text: "前、", start: 0, end: 2 }, { text: "次", start: 2, end: 5 }, { text: "最後", start: 5, end: 9 }] };
  assert.deepEqual(texts(build([input])), ["前、", "次最後"]);
  assert.deepEqual(texts(build([input], { maxSeconds: 0 })), [input.text]);
  assert.deepEqual(texts(build([input], { maxSeconds: 3 })), ["前、", "次", "最後"]);
});

test("standalone punctuation merges into the preceding piece even over limits", () => {
  const input = phraseSegment("前。！後", ["前", "。", "！", "後"]);
  const result = build([input], { maxCharacters: 1 });
  assert.deepEqual(texts(result), ["前。！", "後"]);
  assert.deepEqual(result.captions.flatMap((cue) => cue.words), input.words);
});

test("missing words split sentences with proportional timestamps and warning", () => {
  const result = build([{ start: 2, end: 8, text: "前。後半分。" }], { readoutSeconds: 0, minDurationSeconds: 0 });
  assert.deepEqual(result.captions.map(({ text, start, end }) => ({ text, start, end })), [{ text: "前。", start: 2, end: 4 }, { text: "後半分。", start: 4, end: 8 }]);
  assert.match(result.warnings.join(" "), /按分/);
});

test("source duration caps readout and drops cues shorter than 0.2 seconds", () => {
  assert.equal(build([segment(8, 10)], { sourceDurationSeconds: 10 }).captions[0].end, 10);
  assert.equal(build([segment(9.5, 10.2)], { sourceDurationSeconds: 10.033333333333 }).captions[0].end, 10.033);
  const result = build([segment(9.9, 10), segment(11, 12)], { sourceDurationSeconds: 10 });
  assert.equal(result.captions.length, 0);
  assert.equal(result.warnings.filter((warning) => /0.2 秒未満/.test(warning)).length, 2);
  assert.equal(build([segment(9.8, 10)], { sourceDurationSeconds: 10 }).captions.length, 1);
});

test("none ignores sentence, pause and duration splitting; zero and null disable character limits", () => {
  const input = phraseSegment("前。後", ["前。", "後"]);
  input.words[1] = { ...input.words[1], start: 8, end: 10 };
  for (const maxCharacters of [0, null]) {
    assert.deepEqual(texts(build([input], { splitMode: "none", maxCharacters })), [input.text]);
  }
});

test("phrase output is byte deterministic and does not mutate transcript", () => {
  const input = [phraseSegment("動画編集に、夜を明かしたことはありますか。切って、貼って、揃えて、また直して。終わらない。")];
  const before = JSON.stringify(input);
  const result = build(input);
  assert.ok(result.captions.length >= 3);
  assert.equal(JSON.stringify(result), JSON.stringify(build(input)));
  assert.equal(JSON.stringify(input), before);
});

test("unrecognized spans are clipped to each caption instead of copied to every piece", () => {
  // 1 セグメント（語 3 つ）を文字数上限で 3 つの字幕へ割る。未認識区間は 2 つ目の字幕の中だけにある。
  const words = [
    { start: 0, end: 1, text: "あいうえお" },
    { start: 2, end: 3, text: "かきくけこ" },
    { start: 3, end: 4, text: "さしすせそ" },
  ];
  const input = [{
    start: 0,
    end: 4,
    text: "あいうえおかきくけこさしすせそ",
    words,
    unrecognized: [{ start: 2.2, end: 2.6 }],
  }];
  const { captions } = build(input, { maxCharacters: 5, splitMode: "none", minDurationSeconds: 0 });
  assert.equal(captions.length, 3);
  // 区間 [2.2, 2.6) を覆う字幕だけが持つ（1 つ目は end=1.3、3 つ目は start=3）。
  assert.deepEqual(captions.map((cue) => cue.unrecognized ?? null), [null, [{ start: 2.2, end: 2.6 }], null]);
  assert.ok(!Object.hasOwn(captions[0], "unrecognized"));
  assert.ok(!Object.hasOwn(captions[2], "unrecognized"));
});

test("unrecognized spans straddling a caption edge are trimmed to that caption", () => {
  const input = [{
    start: 0,
    end: 4,
    text: "あいうえおかきくけこ",
    words: [
      { start: 0, end: 1, text: "あいうえお" },
      { start: 2.5, end: 4, text: "かきくけこ" },
    ],
    unrecognized: [{ start: 0.5, end: 3 }],
  }];
  const { captions } = build(input, { maxCharacters: 5, splitMode: "none", minDurationSeconds: 0 });
  assert.equal(captions.length, 2);
  assert.deepEqual(captions[0].unrecognized, [{ start: 0.5, end: captions[0].end }]);
  assert.deepEqual(captions[1].unrecognized, [{ start: captions[1].start, end: 3 }]);
});

test('English transcript restores spaces from segment text despite joined transcriber words', () => {
  const transcript = JSON.parse(readFileSync(new URL('./fixtures/english-transcript.json', import.meta.url)));
  const { captions } = build(transcript, { lang: 'en-US' });
  assert.equal(captions.length, 36);
  assert.equal(captions.filter(cue => cue.text.length > 42).length, 0);
  assert.equal(captions.filter(cue => /[a-z]{12,}/iu.test(cue.text)).length, 0);
  assert.equal(captions.filter(cue => /^[,.?!;:]/u.test(cue.text)).length, 0);
  assert.equal(captions.filter(cue => /(?:^|\s)(?:a|an|the|and|or|but|for|of|to|in|on|at|with|by|from|before)$/iu.test(cue.text)).length, 0);
  assert.deepEqual(captions.flatMap(cue => cue.words).map(({ start, end, text }) => ({ start, end, text: text.replace(/\s/gu, '') })),
    transcript.flatMap(segment => segment.words).map(({ start, end, text }) => ({ start, end, text: text.replace(/\s/gu, '') })));
  assert.ok(captions.some(cue => cue.text.includes('let me')));
  assert.ok(captions.some(cue => cue.text.includes('I learned')));
});

test('English character splitting carries function words into the next cue without changing word times', () => {
  const words = 'We walked to the recording room'.split(' ')
    .map((text, index) => ({ text, start: index * 0.2, end: index * 0.2 + 0.1 }));
  const segment = { start: 0, end: 1.1, text: 'We walked to the recording room', words };
  const captions = build([segment], { lang: 'en', maxCharacters: 19, maxSeconds: 0, pauseSeconds: 1 }).captions;
  assert.deepEqual(captions.map(cue => cue.text), ['We walked', 'to the recording', 'room']);
  assert.deepEqual(captions.flatMap(cue => cue.words).map(({ start, end }) => ({ start, end })),
    words.map(({ start, end }) => ({ start, end })));
  for (const cue of captions) assert.equal(cue.words.map(word => word.text).join(''), cue.text);
});

test('English transcriber words with prefixed punctuation attach marks to the previous cue', () => {
  const words = [
    { text: 'Hello', start: 0, end: 0.2 },
    { text: ',where', start: 0.2, end: 0.4 },
    { text: 'next', start: 0.4, end: 0.6 },
  ];
  const captions = build([{ start: 0, end: 0.6, text: 'Hello, where next', words }], {
    lang: 'en', maxCharacters: 6, maxSeconds: 0, pauseSeconds: 1,
  }).captions;
  assert.deepEqual(captions.map(cue => cue.text), ['Hello,', 'where', 'next']);
  assert.deepEqual(captions.flatMap(cue => cue.words).map(({ start, end }) => ({ start, end })),
    words.map(({ start, end }) => ({ start, end })));
});

test('a genuine pause still separates English cues at the original word times', () => {
  const input = [
    { start: 0, end: 0.4, text: 'walked to', words: [
      { text: 'walked', start: 0, end: 0.2 }, { text: 'to', start: 0.2, end: 0.4 },
    ] },
    { start: 1.2, end: 1.5, text: 'town', words: [{ text: 'town', start: 1.2, end: 1.5 }] },
  ];
  assert.deepEqual(build(input, { lang: 'en', pauseSeconds: 0.6 }).captions.map(cue => cue.text),
    ['walked to', 'town']);
});

test('Japanese none-mode keeps legacy gap ownership byte for byte', () => {
  const words = [
    { text: '前半', start: 0, end: 1 },
    { text: '後半', start: 1, end: 2 },
  ];
  const captions = build([{ start: 0, end: 2, text: '前半、 後半', words }], {
    lang: 'ja', splitMode: 'none', maxCharacters: 3,
  }).captions;
  assert.deepEqual(captions.map(cue => cue.text), ['前半', '、 後半']);
});

test('English fallback separates words and attaches punctuation without doubled spaces; Japanese stays joined', () => {
  const words = ['hello', '  world', ',', 'again'].map((text, index) => ({ text, start: index, end: index + 0.5 }));
  const input = [{ start: 0, end: 4, text: 'different source', words }];
  assert.deepEqual(build(input, { lang: 'en', maxCharacters: 42 }).captions.map(cue => cue.text), ['hello world, again']);
  assert.deepEqual(build(input, { lang: 'ja', maxCharacters: 42 }).captions.map(cue => cue.text), ['hello  world,again']);
});
