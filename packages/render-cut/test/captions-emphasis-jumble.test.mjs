import assert from "node:assert/strict";
import test from "node:test";

import { generateCaptionOverlays } from "../src/captions.mjs";

const CAPTIONS = [
  {
    id: "c-0001",
    start: 0,
    end: 4,
    text: "めんどくさい生理的に無理すぎる案件だった",
    speaker: null,
    sourceRef: null,
    edited: false,
    style: "karaoke",
    words: [
      { start: 0, end: 1.5, text: "めんどくさい" },
      { start: 1.5, end: 4, text: "生理的に無理すぎる案件だった" },
    ],
  },
];
const CUTS = [{ in: 0, out: 4 }];

function emphasis(overrides) {
  return {
    id: "e-0001",
    t_start: 0,
    t_end: 1.5,
    word: "めんどくさい",
    emotion: "disgust",
    ...overrides,
  };
}

const JITTER_SUFFIX_PATTERN =
  /; rotate: calc\(-?\d+(?:\.\d+)?deg \* var\(--akari-jumble-amp, 1\)\); translate: 0 calc\(-?\d+(?:\.\d+)?em \* var\(--akari-jumble-amp, 1\)\); scale: calc\(1 \+ -?\d+(?:\.\d+)? \* var\(--akari-jumble-amp, 1\)\)/g;

test("one-char-jumble output is deterministic across repeated calls (same input -> same bytes)", () => {
  const words = [emphasis({ style_hint: "one-char-jumble" })];
  const first = generateCaptionOverlays(CAPTIONS, CUTS, { emphasisWords: words });
  const second = generateCaptionOverlays(CAPTIONS, CUTS, {
    emphasisWords: words.map((word) => ({ ...word })),
  });

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first, second);
});

test("one-char-jumble reuses the one-char-bang per-char markup and adds static rotate/translate/scale", () => {
  const words = [emphasis({ style_hint: "one-char-jumble" })];
  const [{ html }] = generateCaptionOverlays(CAPTIONS, CUTS, { emphasisWords: words });

  const charSpans = [
    ...html.matchAll(/<span class="akari-caption__emphasis-char" style="([^"]+)">([^<]+)<\/span>/g),
  ];
  assert.equal(charSpans.length, Array.from("めんどくさい").length);
  for (const [, style] of charSpans) {
    assert.match(
      style,
      /^--akari-emphasis-delay: [\d.]+s; --akari-emphasis-dur: [\d.]+s; rotate: calc\(-?\d+(?:\.\d+)?deg \* var\(--akari-jumble-amp, 1\)\); translate: 0 calc\(-?\d+(?:\.\d+)?em \* var\(--akari-jumble-amp, 1\)\); scale: calc\(1 \+ -?\d+(?:\.\d+)? \* var\(--akari-jumble-amp, 1\)\)$/,
    );
  }
  assert.match(html, /akari-caption__tok--one-char-jumble[^>]*data-emphasis-id="e-0001"/);
  assert.match(html, /@keyframes akari-emphasis-one-char-bang/);
});

test("adjacent characters receive different deterministic rotate/offset/scale jitter", () => {
  const words = [emphasis({ style_hint: "one-char-jumble" })];
  const [{ html }] = generateCaptionOverlays(CAPTIONS, CUTS, { emphasisWords: words });

  const rotations = [...html.matchAll(/rotate: calc\((-?\d+(?:\.\d+)?)deg/g)].map(([, value]) => Number(value));
  const offsets = [...html.matchAll(/translate: 0 calc\((-?\d+(?:\.\d+)?)em/g)].map(([, value]) => Number(value));
  const scales = [...html.matchAll(/scale: calc\(1 \+ (-?\d+(?:\.\d+)?) \*/g)].map(([, value]) => Number(value));

  assert.equal(rotations.length, 6);
  assert.notEqual(rotations[0], rotations[1]);
  assert.notEqual(offsets[0], offsets[1]);
  assert.notEqual(scales[0], scales[1]);
  // 少なくとも一部の文字は非ゼロの角度を持つ（全文字が偶然 0deg に丸まっていない）ことを保証する。
  assert.ok(rotations.some((value) => value !== 0));
});

test("stripping the static jitter segment reproduces byte-identical one-char-bang per-char markup (amp=0 identity proxy)", () => {
  const [{ html: bangHtml }] = generateCaptionOverlays(CAPTIONS, CUTS, {
    emphasisWords: [emphasis({ style_hint: "one-char-bang" })],
  });
  const [{ html: jumbleHtml }] = generateCaptionOverlays(CAPTIONS, CUTS, {
    emphasisWords: [emphasis({ style_hint: "one-char-jumble" })],
  });

  const stripped = jumbleHtml
    .replace(JITTER_SUFFIX_PATTERN, "")
    .replaceAll("akari-caption__tok--one-char-jumble", "akari-caption__tok--one-char-bang");

  assert.equal(stripped, bangHtml);
});

test("disgust emotion auto-assigns one-char-jumble without disturbing pain/surprise/anger -> one-char-bang", () => {
  const [{ html: disgustHtml }] = generateCaptionOverlays(CAPTIONS, CUTS, {
    emphasisWords: [emphasis({})],
  });
  assert.match(disgustHtml, /akari-caption__tok--one-char-jumble/);

  for (const emotion of ["pain", "surprise", "anger"]) {
    const [{ html }] = generateCaptionOverlays(CAPTIONS, CUTS, {
      emphasisWords: [emphasis({ emotion })],
    });
    assert.match(html, /akari-caption__tok--one-char-bang/, `emotion=${emotion} should still map to one-char-bang`);
    assert.doesNotMatch(html, /akari-caption__tok--one-char-jumble/);
  }
});

test("explicit style_hint overrides emotion (joy word can still opt into one-char-jumble)", () => {
  const [{ html }] = generateCaptionOverlays(CAPTIONS, CUTS, {
    emphasisWords: [emphasis({ emotion: "joy", style_hint: "one-char-jumble" })],
  });
  assert.match(html, /akari-caption__tok--one-char-jumble/);
});

test("a 15+ character emphasis word splits into that many jittered char spans without throwing", () => {
  const longWord = "せいりてきにむりすぎるレベルのやつ"; // 17 文字
  const captions = [
    {
      id: "c-0002",
      start: 0,
      end: 3,
      text: longWord,
      speaker: null,
      sourceRef: null,
      edited: false,
      style: "karaoke",
      words: [{ start: 0, end: 3, text: longWord }],
    },
  ];
  const cuts = [{ in: 0, out: 3 }];
  const words = [
    {
      id: "e-0001",
      t_start: 0,
      t_end: 3,
      word: longWord,
      emotion: "disgust",
      style_hint: "one-char-jumble",
    },
  ];

  const [{ html }] = generateCaptionOverlays(captions, cuts, { emphasisWords: words });
  const charSpans = html.match(/class="akari-caption__emphasis-char"/g) ?? [];
  assert.equal(charSpans.length, Array.from(longWord).length);
  assert.ok(charSpans.length >= 15);
});
