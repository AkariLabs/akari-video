import assert from "node:assert/strict";
import test from "node:test";

import { generateCaptionOverlays, renderStyledCaptionFragment } from "../src/captions.mjs";

function visibleTokenText(html) {
  return [...html.matchAll(/<span class="akari-caption__tok[^"]*"[^>]*>(.*?)<\/span>/gs)]
    .map((match) => match[1].replace(/<[^>]+>/gu, ""))
    .join("");
}

function caption(overrides = {}) {
  return {
    id: "c-0001",
    start: 0,
    end: 3,
    text: "難しくて、いまだに解けない。",
    speaker: null,
    sourceRef: null,
    edited: false,
    style: "reveal",
    words: [
      { start: 0, end: 1, text: "難しくて、" },
      { start: 1, end: 2, text: "いまだに" },
      { start: 2, end: 3, text: "解けない。" },
    ],
    ...overrides,
  };
}

test("reveal derives non-accumulating phrase groups with word-start timing", () => {
  const [{ html }] = generateCaptionOverlays([caption()], [{ in: 0, out: 3 }], {
    maxCharacters: 10,
  });

  assert.match(html, /class="akari-caption akari-caption--reveal"/);
  assert.equal((html.match(/class="akari-caption__reveal-group"/g) ?? []).length, 2);
  assert.match(html, /--akari-reveal-delay: 0s; --akari-reveal-dur: 1s/);
  assert.match(html, /--akari-reveal-delay: 1s; --akari-reveal-dur: 2s/);
  assert.match(html, /animation: akari-caption-reveal [^;]+ both paused;/);
  assert.match(html, /100% \{ opacity: 0; transform: translateY\(0\); \}/);
  assert.doesNotMatch(html, /<span class="[^"]*akari-caption__tok--karaoke/);
});

test("reveal without words degrades to plain display and emits one warning", () => {
  const warnings = [];
  const [{ html }] = generateCaptionOverlays(
    [caption({ words: undefined, display_text: "整えた表示" })],
    [{ in: 0, out: 3 }],
    { onWarning: (warning) => warnings.push(warning) },
  );

  assert.match(html, /<div class="akari-caption">/);
  assert.doesNotMatch(html, /akari-caption--reveal/);
  assert.match(html, /整えた表示/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /reveal without words/);
});

test("static emphasis hints replace matching tokens without adding token animation", () => {
  const words = [
    { start: 0, end: 0.5, text: "色" },
    { start: 0.5, end: 1, text: "縁" },
    { start: 1, end: 1.5, text: "危険" },
    { start: 1.5, end: 2, text: "成功" },
    { start: 2, end: 2.5, text: "注目" },
  ];
  const emphasisWords = [
    { id: "e-0001", t_start: 0, t_end: 0.5, word: "色", emotion: "emphasis", style_hint: "color-only" },
    { id: "e-0002", t_start: 0.5, t_end: 1, word: "縁", emotion: "emphasis", style_hint: "outline-bold" },
    { id: "e-0003", t_start: 1, t_end: 1.5, word: "危険", emotion: "pain", style_hint: "danger" },
    { id: "e-0004", t_start: 1.5, t_end: 2, word: "成功", emotion: "joy", style_hint: "positive" },
    { id: "e-0005", t_start: 2, t_end: 2.5, word: "注目", emotion: "surprise", style_hint: "highlight" },
  ];
  const html = renderStyledCaptionFragment(words, "karaoke", {
    rangeStart: 0,
    emphasisWords,
  });

  for (const style of ["color-only", "outline-bold", "danger", "positive", "highlight"]) {
    assert.match(html, new RegExp(`akari-caption__tok--${style}[^>]*data-emphasis-id=`));
  }
  assert.match(html, /--akari-emphasis-color-only/);
  assert.match(html, /--akari-emphasis-outline/);
  assert.match(html, /--akari-emphasis-danger/);
  assert.match(html, /--akari-emphasis-positive/);
  assert.match(html, /--akari-emphasis-highlight/);
  assert.doesNotMatch(
    html,
    /akari-caption__tok--(?:color-only|outline-bold|danger|positive|highlight)"[^>]*style="[^"]*animation/,
  );
});

test("display_text is rendered while canonical text remains unchanged", () => {
  const sourceCaption = caption({
    text: "今日は来れない",
    display_text: "今日は、来れない",
    style: "karaoke",
    words: [
      { start: 0, end: 1.5, text: "今日は" },
      { start: 1.5, end: 3, text: "来れない" },
    ],
  });
  const before = structuredClone(sourceCaption);
  const warnings = [];
  const [{ html }] = generateCaptionOverlays([sourceCaption], [{ in: 0, out: 3 }], {
    onWarning: (warning) => warnings.push(warning),
  });

  assert.equal(visibleTokenText(html), sourceCaption.display_text);
  assert.match(html, /akari-caption__tok--unlit">、<\/span>/);
  assert.deepEqual(sourceCaption, before);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /not covered by words/);
});

test("a large display_text rewrite uses proportional timing and warns", () => {
  const warnings = [];
  const sourceCaption = caption({
    text: "この文章は大幅に削除されます",
    display_text: "要約",
    style: "karaoke",
    words: [
      { start: 0, end: 1, text: "この文章は" },
      { start: 1, end: 2, text: "大幅に" },
      { start: 2, end: 3, text: "削除されます" },
    ],
  });
  const [{ html }] = generateCaptionOverlays([sourceCaption], [{ in: 0, out: 3 }], {
    onWarning: (warning) => warnings.push(warning),
  });

  assert.equal(visibleTokenText(html), "要約");
  assert.ok(warnings.some((warning) => /proportional timing fallback/.test(warning)));
});

test("partial words coverage keeps residual characters visible and unlit", () => {
  const warnings = [];
  const [{ html }] = generateCaptionOverlays(
    [caption({
      text: "前今日は後",
      style: "karaoke",
      words: [{ start: 0.5, end: 2.5, text: "今日は" }],
    })],
    [{ in: 0, out: 3 }],
    { onWarning: (warning) => warnings.push(warning) },
  );

  assert.equal(visibleTokenText(html), "前今日は後");
  assert.equal((html.match(/akari-caption__tok--unlit/g) ?? []).length, 2);
  assert.match(html, /akari-caption__tok--karaoke[^>]*>今日は<\/span>/);
  assert.ok(warnings.some((warning) => /not covered by words/.test(warning)));
});

test("a requested split inside a word snaps to the word boundary within the +2 budget", () => {
  const html = renderStyledCaptionFragment(
    [
      { start: 0, end: 1, text: "難しくて、いまだに" },
      { start: 1, end: 2, text: "残ります" },
    ],
    "reveal",
    { maximum: 8, rangeStart: 0, rangeEnd: 2 },
  );

  assert.match(
    html,
    /<span class="akari-caption__tok" style="">難しくて、いまだに<\/span>/,
  );
  assert.doesNotMatch(html, />難しくて、い<\/span>/);
  assert.doesNotMatch(html, />まだに<\/span>/);
});
