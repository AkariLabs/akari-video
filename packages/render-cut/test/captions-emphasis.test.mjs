import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { generateCaptionOverlays } from "../src/captions.mjs";

const CAPTIONS = [
  {
    id: "c-0001",
    start: 5,
    end: 9,
    text: "痛い最高90 秒です",
    speaker: null,
    sourceRef: null,
    edited: false,
    style: "karaoke",
    words: [
      { start: 5, end: 6, text: "痛い" },
      { start: 6, end: 7, text: "最高" },
      { start: 7, end: 7.4, text: "90" },
      { start: 7.4, end: 8, text: " 秒" },
      { start: 8, end: 9, text: "です" },
    ],
  },
];
const CUTS = [{ in: 4, out: 10 }];

function emphasis(overrides) {
  return {
    id: "e-0001",
    t_start: 5,
    t_end: 6,
    word: "痛い",
    emotion: "pain",
    style_hint: "one-char-bang",
    ...overrides,
  };
}

test("emphasis_words absent keeps the pre-emphasis caption output byte-identical", () => {
  const output = generateCaptionOverlays(CAPTIONS, CUTS);
  const digest = createHash("sha256").update(JSON.stringify(output)).digest("hex");

  assert.equal(digest, "24fd61a3d542e73a718ba05a17ab851f5501ffdb8bd480c67b900e67e91c064e");
  assert.deepEqual(generateCaptionOverlays(CAPTIONS, CUTS, { emphasisWords: [] }), output);
  assert.deepEqual(generateCaptionOverlays(CAPTIONS, CUTS, { emphasisWords: "invalid" }), output);
});

test("one-char-bang, size-pulse, and color-accent generate their deterministic HTML", () => {
  const words = [
    emphasis({ id: "e-0001" }),
    emphasis({ id: "e-0002", t_start: 6, t_end: 7, word: "最高", emotion: "joy", style_hint: "size-pulse" }),
    emphasis({ id: "e-0003", t_start: 8, t_end: 9, word: "です", emotion: "sadness", style_hint: "color-accent" }),
  ];
  const [{ html }] = generateCaptionOverlays(CAPTIONS, CUTS, { emphasisWords: words });

  assert.match(html, /akari-caption__tok--one-char-bang[^>]*data-emphasis-id="e-0001"/);
  assert.equal((html.match(/class="akari-caption__emphasis-char"/g) ?? []).length, 2);
  assert.match(html, /@keyframes akari-emphasis-one-char-bang/);
  assert.match(html, /scale\(1\.6\)/);
  assert.match(html, /akari-caption__tok--size-pulse[^>]*data-emphasis-id="e-0002"/);
  assert.match(html, /@keyframes akari-emphasis-size-pulse/);
  assert.match(html, /50% \{ transform: scale\(1\.25\); \}/);
  assert.match(html, /akari-caption__tok--color-accent[^>]*data-emphasis-id="e-0003"[^>]*color: var\(--akari-emphasis-sadness\)/);
});

test("one emphasis word spanning multiple caption tokens applies to every overlapping contained token", () => {
  const [{ html }] = generateCaptionOverlays(CAPTIONS, CUTS, {
    emphasisWords: [emphasis({ t_start: 7, t_end: 8, word: "90 秒", emotion: "emphasis", style_hint: "size-pulse" })],
  });

  assert.equal((html.match(/data-emphasis-id="e-0001"/g) ?? []).length, 2);
  assert.match(html, /data-emphasis-id="e-0001"[^>]*>90<\/span>/);
  assert.match(html, /data-emphasis-id="e-0001"[^>]*> 秒<\/span>/);
});

test("an unmatched or malformed element is ignored while another element still applies", () => {
  const baseline = generateCaptionOverlays(CAPTIONS, CUTS);
  const [{ html }] = generateCaptionOverlays(CAPTIONS, CUTS, {
    emphasisWords: [
      emphasis({ id: "bad-id", word: "痛い" }),
      emphasis({ id: "e-0002", t_start: 5, t_end: 6, word: "不一致" }),
      emphasis({ id: "e-0003", t_start: 6, t_end: 7, word: "最高", emotion: "joy", style_hint: "size-pulse" }),
    ],
  });

  assert.doesNotMatch(html, /bad-id|e-0002/);
  assert.match(html, /data-emphasis-id="e-0003"/);
  assert.match(html, /akari-caption__tok--karaoke[^>]*>痛い<\/span>/);
  assert.notDeepEqual([{ ...baseline[0], html }], baseline);

  assert.deepEqual(
    generateCaptionOverlays(CAPTIONS, CUTS, {
      emphasisWords: [emphasis({ id: "e-0002", word: "不一致" })],
    }),
    baseline,
  );
});

test("emphasis replaces only its karaoke token and leaves neighboring karaoke tokens intact", () => {
  const [{ html }] = generateCaptionOverlays(CAPTIONS, CUTS, {
    emphasisWords: [emphasis({ t_start: 6, t_end: 7, word: "最高", emotion: "joy", style_hint: "size-pulse" })],
  });

  assert.match(html, /akari-caption__tok--karaoke[^>]*>痛い<\/span>/);
  assert.match(html, /akari-caption__tok--size-pulse[^>]*>最高<\/span>/);
  assert.doesNotMatch(html, /akari-caption__tok--karaoke[^>]*>最高<\/span>/);
  assert.equal((html.match(/class="akari-caption__tok akari-caption__tok--karaoke"/g) ?? []).length, 4);
});
