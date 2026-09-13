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
  const expected = ["b4e11cb2aef370cbc5a8db98b34eb94f332000497a7a19076d33322a8b934b3a","7d58967ae50c90dbfc1e38c5faf555525e4bdfc85c57dc26e5c6ecc7c2557ee8","8eefa548548b2f1f7f6c86c060dc0549325712f9cd19953ff4852ddf4ff381a6","66de5b1f2cc4add30281e233d88d4e10a8614933fb9d3fc92151321d2746ce4f","911e5ca9bc8d65e0599b82b30eab995ac256fb340690967a1c53401d5a8af110"];
  for (const [index, style] of [undefined, "karaoke", "pop", "reveal", "reveal-word"].entries()) {
    const canonical = html({ ...cue, style }).replace(/file:[^"\s]+/gu, "<bundled-font>");
    assert.equal(createHash("sha256").update(canonical).digest("hex"), expected[index]);
  }
});
