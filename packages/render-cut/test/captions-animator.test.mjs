import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { generateCaptionOverlays } from "../src/captions.mjs";

const animator = [{ id: "a", basis: "chars", amount: { y: 24 } }];
const words = ["A😀", "e\u0301👩‍👩‍👧‍👦", "字幕"].map((text, i) => ({ text, start: i, end: i + 1 }));
const cue = { id: "c", start: 0, end: 3, time_domain: "output", text: words.map(w => w.text).join(""), words };
const options = { output: { width: 1920, height: 1080 }, maxCharacters: 3 };
const html = (row, opts = options) => generateCaptionOverlays([row], [{ in: 0, out: 3 }], opts)[0].html;
const chars = value => [...value.matchAll(/data-akari-char="(\d+)">([^<]*)<\/span>/gu)];

for (const style of [undefined, "karaoke", "pop", "reveal", "reveal-word"]) {
  test(`chars markup preserves graphemes and cue-wide indices (${style ?? "plain"})`, () => {
    const result = html({ ...cue, style, animator });
    const matches = chars(result);
    assert.deepEqual(matches.map(m => Number(m[1])), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(matches.map(m => m[2]), ["A", "😀", "e\u0301", "👩‍👩‍👧‍👦", "字", "幕"]);
    assert.match(result, /class="akari-caption__tok[^>]*>[\s\S]*class="akari-caption__char"/u);
  });
  test(`non-chars declarations keep exact caption HTML (${style ?? "plain"})`, () => {
    const original = html({ ...cue, style });
    for (const declaration of [[], ...["words", "lines", "segments"].map(basis => [{ ...animator[0], basis }])]) {
      assert.equal(html({ ...cue, style, animator: declaration }), original);
    }
    assert.doesNotMatch(original, /akari-caption__char/u);
  });
}

test("emphasis chars remain graphemes and HTML-sensitive text is escaped once", () => {
  const row = { ...cue, text: "e\u0301👩‍👩‍👧‍👦<&", words: [{ text: "e\u0301👩‍👩‍👧‍👦<&", start: 0, end: 3 }], animator };
  const result = html(row, { ...options, emphasisWords: [{ id: "e", word: row.text, t_start: 0, t_end: 3, emotion: "joy", style: "one-char-bang" }] });
  assert.deepEqual(chars(result).map(m => m[2]), ["e\u0301", "👩‍👩‍👧‍👦", "&lt;", "&amp;"]);
});

test("only the declared cue receives character spans", () => {
  const result = generateCaptionOverlays([cue, { ...cue, id: "animated", animator }], [{ in: 0, out: 3 }], options);
  assert.doesNotMatch(result[0].html, /akari-caption__char/u);
  assert.equal(chars(result[1].html).length, 6);
});

// Updated for the explicit-x ink-width plate and center-origin transform CSS; stripping only those declarations restores the old hashes.
test("undeclared caption HTML keeps the caption plate geometry contract", () => {
  const expected = ["0d9d6542de25df310d40199fb7c530f029c0276850618525c013711f87b00ae1","1b17c67b5d5203d599b7b81d3256118ae212443190aa408a2618b1ef4ce8ffaf","4013e78451efeb726134767bc53fc512adae5707d482bfef5f9cbf8fdb51a543","f1ca62be6e9722fa32adcfdb6de8107a18785bb4a5290acbaa60fbc6c4738a0e","d80a5e7a1231894969d28068cde68a7d435159e1aa8aee2e2029412a1cfb0404"];
  for (const [index, style] of [undefined, "karaoke", "pop", "reveal", "reveal-word"].entries()) {
    const canonical = html({ ...cue, style }).replace(/file:[^"\s]+/gu, "<bundled-font>");
    assert.equal(createHash("sha256").update(canonical).digest("hex"), expected[index]);
  }
});
