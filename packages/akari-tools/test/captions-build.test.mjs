import assert from "node:assert/strict";
import test from "node:test";
import { buildCaptionsFromTranscript as build } from "../src/captions/build.mjs";

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
  assert.equal(result.captions[0].speaker, null);
  assert.equal(result.captions[0].src, "s1");
  assert.equal(result.captions[0].edited, false);
  assert.equal(result.captions[0].words, first.words);
  assert.equal(result.captions[0].unrecognized, first.unrecognized);
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

test("25 characters in eight words split greedily at ten characters", () => {
  const words = ["あいう", "えおか", "きくけ", "こさし", "すせそ", "たちつ", "てとな", "にぬねの"]
    .map((text, index) => ({ text, start: index * 2, end: index * 2 + 1 }));
  const text = words.map((word) => word.text).join("");
  assert.equal(Array.from(text).length, 25);
  const { captions } = build([{ start: 0, end: 15, text, words }], { maxCharacters: 10 });
  assert.deepEqual(captions.map((cue) => Array.from(cue.text).length), [9, 9, 7]);
  assert.deepEqual(captions.flatMap((cue) => cue.words), words);
  assert.equal(captions.map((cue) => cue.text).join(""), text);
  for (const cue of captions) {
    assert.equal(cue.start, cue.words[0].start);
    assert.equal(cue.end, cue.words.at(-1).end + 0.3);
  }
});

test("splitting counts Unicode code points and preserves spaces in English", () => {
  const words = ["hello", "world", "again"].map((text, i) => ({ text, start: i * 2, end: i * 2 + 1 }));
  assert.deepEqual(build([{ start: 0, end: 5, text: "hello world again", words }], { maxCharacters: 11 }).captions.map((c) => c.text), ["hello world", "again"]);
  const large = segment(0, 2, "😀😀😀😀");
  assert.equal(build([large], { maxCharacters: 3 }).captions[0].text, large.text);
});

test("empty text is dropped and warned about; original indexes remain stable", () => {
  const { captions, warnings } = build([segment(0, 1, " \n "), segment(2, 4)]);
  assert.equal(captions.length, 1);
  assert.deepEqual(captions[0].sourceRef, { segment: 1 });
  assert.match(warnings[0], /segment 0/);
});

test("invalid numeric options are rejected", () => {
  for (const options of [{ readoutSeconds: NaN }, { readoutSeconds: -1 }, { minDurationSeconds: Infinity }, { maxCharacters: 0 }, { maxCharacters: 1.5 }, { idStart: 10000 }]) {
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
