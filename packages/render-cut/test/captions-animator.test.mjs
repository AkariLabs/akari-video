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

// Hashes from addd7a27; only the machine-dependent bundled font URL is canonicalized.
test("undeclared caption HTML matches addd7a27 bytes", () => {
  const expected = ["b4e11cb2aef370cbc5a8db98b34eb94f332000497a7a19076d33322a8b934b3a","bfd9d1f5e1a952379aaaf2ab6fd7b3d804f7b799e8159ddeab8fbebb2e0e1a9d","7a60701ff8f2b5a549ef0bbe38779fb32f53c7144fc584a907ecbd0901f3a323","6ee4fb8c471a188c49daeaaa0a97c735a2bceeac2e43fde5a4f29549afcd1f5b","435dcdc23d2936463d116223fbf1c575646794da6bed6596c6359eb7ae3e080a"];
  for (const [index, style] of [undefined, "karaoke", "pop", "reveal", "reveal-word"].entries()) {
    const canonical = html({ ...cue, style }).replace(/file:[^"\s]+/gu, "<bundled-font>");
    assert.equal(createHash("sha256").update(canonical).digest("hex"), expected[index]);
  }
});
