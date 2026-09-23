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

// Plate rotation and scale now use individual CSS properties so transform animations cannot replace them.
test("undeclared caption HTML keeps the caption plate geometry contract", () => {
  const expected = ["dd89a7c158a26692a3ccd966116349858479f247af80a6a34f93361bcf5593d0","e11e1c04e21d7c57f9ccae4772195ab38e5542244660a93b0f413db069493e89","65804a8053226f1f49c2bc18163e9cdfc18577f120fff585cd8a936f3d0e53c4","36274db405a7045453ed9a1dc7b6e29c642cf22c19b87793affed4128daaef3d","30a9b5c584f7142f5fc31aeb62c51dab5edef892d6537835d9b35c8ff8940fcf"];
  for (const [index, style] of [undefined, "karaoke", "pop", "reveal", "reveal-word"].entries()) {
    const canonical = html({ ...cue, style }).replace(/file:[^"\s]+/gu, "<bundled-font>");
    assert.equal(createHash("sha256").update(canonical).digest("hex"), expected[index]);
  }
});
