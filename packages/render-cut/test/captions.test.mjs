import assert from "node:assert/strict";
import test from "node:test";

import {
  generateCaptionOverlays,
  generateResolvedCaptionOverlays,
  renderCaptionFragment,
  renderStyledCaptionFragment,
  sourceRangeToTimeline,
} from "../src/captions.mjs";

test("resolved caption overlay consumes the Node-resolved cue without re-splitting or animation", () => {
  const [overlay] = generateResolvedCaptionOverlays({
    display_cues: [{
      id: "c-0001-occ-0001-part-1",
      source_cue_id: "c-0001",
      start: 1,
      end: 2.25,
      text: "<今回>",
      style_vars: {
        "--caption-left": "261px",
        "--caption-width": "1120px",
        "--caption-bottom": "29px",
      },
    }],
  });
  assert.equal(overlay.start, 1);
  assert.equal(overlay.duration, 1.25);
  assert.equal(overlay.generatedFrom, "c-0001");
  assert.deepEqual(overlay.vars, {
    "--caption-left": "261px",
    "--caption-width": "1120px",
    "--caption-bottom": "29px",
  });
  assert.match(overlay.html, /&lt;今回&gt;/u);
  assert.match(overlay.html, /white-space:nowrap/u);
  assert.match(overlay.html, /gap:0/u);
  assert.match(overlay.html, /padding:0/u);
  assert.doesNotMatch(overlay.html, /animation:/u);
});

test("caption generation is deterministic and uses the line-fit plate structure", () => {
  const captions = [
    {
      id: "c-0001",
      start: 5,
      end: 9,
      text: "字幕の一行目\n字幕の二行目",
      speaker: null,
      sourceRef: null,
      edited: false,
    },
  ];
  const cuts = [
    { in: 4, out: 7 },
    { in: 8, out: 10 },
  ];
  const first = generateCaptionOverlays(captions, cuts);
  const second = generateCaptionOverlays(captions, cuts);

  assert.deepEqual(second, first);
  assert.deepEqual(
    first.map(({ start, duration }) => ({ start, duration })),
    [
      { start: 1, duration: 2 },
      { start: 3, duration: 1 },
    ],
  );
  assert.match(first[0].html, /akari-caption__plate/);
  assert.match(first[0].html, /akari-caption__line/);
  assert.match(first[0].html, /width: max-content/);
  assert.match(first[0].html, /margin: 0 auto/);
  assert.match(first[0].html, /var\(--plate-gap, 4px\)/);
  assert.doesNotMatch(first[0].html, /data-start|data-duration/);
});

test("caption fragment escapes text and keeps one root element", () => {
  const fragment = renderCaptionFragment("<unsafe> & text", { maximum: 50 });
  assert.match(fragment, /&lt;unsafe&gt; &amp; text/);
  assert.equal(fragment.trim().startsWith('<div class="akari-caption">'), true);
  assert.equal(fragment.trim().endsWith("</div>"), true);
});

test("source time maps onto the concatenated timeline", () => {
  assert.deepEqual(sourceRangeToTimeline(30, 35, [{ in: 5, out: 10 }, { in: 30, out: 35 }]), [
    { start: 5, duration: 5 },
  ]);
});

// --- R3 captions-words: 後方互換（既定スタイルはバイト等価）---

test("words[] without a style field is ignored: output is byte-identical to a caption with no words", () => {
  const baseline = [
    { id: "c-0001", start: 5, end: 9, text: "字幕テキスト", speaker: null, sourceRef: null, edited: false },
  ];
  const withWords = [
    {
      ...baseline[0],
      words: [
        { start: 5, end: 6, text: "字幕" },
        { start: 6, end: 9, text: "テキスト" },
      ],
    },
  ];
  const cuts = [{ in: 4, out: 10 }];
  assert.deepEqual(generateCaptionOverlays(withWords, cuts), generateCaptionOverlays(baseline, cuts));
});

test("an unsupported style value falls back to the legacy plain fragment (byte-identical)", () => {
  const baseline = [
    { id: "c-0001", start: 5, end: 9, text: "字幕テキスト", speaker: null, sourceRef: null, edited: false },
  ];
  const withUnknownStyle = [
    {
      ...baseline[0],
      style: "typewriter",
      words: [{ start: 5, end: 9, text: "字幕テキスト" }],
    },
  ];
  const cuts = [{ in: 4, out: 10 }];
  assert.deepEqual(generateCaptionOverlays(withUnknownStyle, cuts), generateCaptionOverlays(baseline, cuts));
});

test("style requested but words[] is missing, empty, or entirely malformed falls back to the legacy fragment", () => {
  const baseline = [
    { id: "c-0001", start: 5, end: 9, text: "字幕テキスト", speaker: null, sourceRef: null, edited: false },
  ];
  const missing = [{ ...baseline[0], style: "karaoke" }];
  const empty = [{ ...baseline[0], style: "karaoke", words: [] }];
  const malformed = [
    {
      ...baseline[0],
      style: "karaoke",
      words: [
        { start: 5, end: 4, text: "end-before-start" },
        { start: 5, text: "no-end" },
        { start: 5, end: 6, text: "" },
      ],
    },
  ];
  const cuts = [{ in: 4, out: 10 }];
  const expected = generateCaptionOverlays(baseline, cuts);
  assert.deepEqual(generateCaptionOverlays(missing, cuts), expected);
  assert.deepEqual(generateCaptionOverlays(empty, cuts), expected);
  assert.deepEqual(generateCaptionOverlays(malformed, cuts), expected);
});

// --- R3 captions-words: opt-in karaoke / pop ---

const SAMPLE_WORDS = [
  { start: 1.0, end: 1.3, text: "これ" },
  { start: 1.3, end: 1.9, text: "ゴールデンウィーク" },
  { start: 1.9, end: 2.2, text: "明け" },
  { start: 2.2, end: 2.4, text: "に" },
];

test("karaoke style renders one span per word with delay/duration timed off the range start, wrapped at the character budget", () => {
  const fragment = renderStyledCaptionFragment(SAMPLE_WORDS, "karaoke", { maximum: 13, rangeStart: 1.0 });

  assert.match(fragment, /class="akari-caption akari-caption--karaoke"/);
  // 13 文字予算: これ(2)+ゴールデンウィーク(9)+明け(2) = 13 で 1 行目、に は 2 行目へ折り返る
  const lines = [...fragment.matchAll(/<p class="akari-caption__line">(.*?)<\/p>/gs)].map((m) => m[1]);
  assert.equal(lines.length, 2);
  assert.equal((lines[0].match(/<span/g) ?? []).length, 3);
  assert.equal((lines[1].match(/<span/g) ?? []).length, 1);

  assert.match(
    fragment,
    /<span class="akari-caption__tok akari-caption__tok--karaoke" style="--akari-tok-delay: 0s; --akari-tok-dur: 0\.3s">これ<\/span>/,
  );
  assert.match(
    fragment,
    /<span class="akari-caption__tok akari-caption__tok--karaoke" style="--akari-tok-delay: 0\.3s; --akari-tok-dur: 0\.6s">ゴールデンウィーク<\/span>/,
  );
  assert.match(
    fragment,
    /<span class="akari-caption__tok akari-caption__tok--karaoke" style="--akari-tok-delay: 0\.9s; --akari-tok-dur: 0\.3s">明け<\/span>/,
  );
  assert.match(
    fragment,
    /<span class="akari-caption__tok akari-caption__tok--karaoke" style="--akari-tok-delay: 1\.2s; --akari-tok-dur: 0\.2s">に<\/span>/,
  );
  assert.match(fragment, /@keyframes akari-caption-karaoke-lit/);
  assert.match(fragment, /animation: akari-caption-karaoke-lit var\(--akari-tok-dur, 0\.2s\) var\(--akari-tok-delay, 0s\) linear both paused;/);
});

test("pop style renders delay-only spans (no --akari-tok-dur) using the pop keyframe", () => {
  const fragment = renderStyledCaptionFragment(SAMPLE_WORDS, "pop", { maximum: 13, rangeStart: 1.0 });

  assert.match(fragment, /class="akari-caption akari-caption--pop"/);
  assert.match(
    fragment,
    /<span class="akari-caption__tok akari-caption__tok--pop" style="--akari-tok-delay: 0\.3s">ゴールデンウィーク<\/span>/,
  );
  assert.doesNotMatch(fragment, /style="[^"]*--akari-tok-dur/);
  assert.match(fragment, /@keyframes akari-caption-pop/);
  assert.match(fragment, /animation: akari-caption-pop 0\.2s var\(--akari-tok-delay, 0s\) ease-out both paused;/);
});

test("styled fragment escapes word text", () => {
  const fragment = renderStyledCaptionFragment(
    [{ start: 0, end: 1, text: "<unsafe> & text" }],
    "karaoke",
    { rangeStart: 0 },
  );
  assert.match(fragment, /&lt;unsafe&gt; &amp; text/);
  assert.doesNotMatch(fragment, /<unsafe>/);
});

test("words are clipped per cut-split range and re-timed against each range's own local start", () => {
  const captions = [
    {
      id: "c-0001",
      start: 0,
      end: 4,
      text: "あいうえ",
      speaker: null,
      sourceRef: null,
      edited: false,
      style: "karaoke",
      words: [
        { start: 0, end: 1, text: "あ" },
        { start: 1, end: 2, text: "い" },
        { start: 2, end: 3, text: "う" },
        { start: 3, end: 4, text: "え" },
      ],
    },
  ];
  const cuts = [
    { in: 0, out: 2 },
    { in: 2, out: 4 },
  ];
  const overlays = generateCaptionOverlays(captions, cuts);

  assert.equal(overlays.length, 2);
  assert.match(overlays[0].html, /あ/);
  assert.match(overlays[0].html, /い/);
  assert.doesNotMatch(overlays[0].html, /う/);
  assert.doesNotMatch(overlays[0].html, /え/);
  assert.match(overlays[0].html, /--akari-tok-delay: 0s/);
  assert.match(overlays[0].html, /--akari-tok-delay: 1s/);

  assert.match(overlays[1].html, /う/);
  assert.match(overlays[1].html, /え/);
  assert.doesNotMatch(overlays[1].html, /あ/);
  assert.doesNotMatch(overlays[1].html, /い/);
  // 2 番目のレンジは source 2..4 が local 0..2 になる: う=delay 0 / え=delay 1
  assert.match(overlays[1].html, /--akari-tok-delay: 0s/);
  assert.match(overlays[1].html, /--akari-tok-delay: 1s/);
});

test("display_text mapping normalizes case without changing matched output", () => {
  const cuts = [{ in: 0, out: 2 }];
  const normalizedCaption = [
    {
      id: "c-0001",
      start: 0,
      end: 2,
      text: "akari OS",
      display_text: "Akari OS",
      speaker: null,
      sourceRef: null,
      edited: false,
      style: "karaoke",
      words: [
        { start: 0, end: 1, text: "akari" },
        { start: 1, end: 2, text: " OS" },
      ],
    },
  ];
  const exactCaption = [
    {
      ...normalizedCaption[0],
      text: "Akari OS",
      words: [
        { start: 0, end: 1, text: "Akari" },
        { start: 1, end: 2, text: " OS" },
      ],
    },
  ];
  const warnings = [];
  const normalized = generateCaptionOverlays(normalizedCaption, cuts, {
    onWarning: (warning) => warnings.push(warning),
  });

  assert.ok(
    warnings.every(
      (warning) =>
        !/display-mapping|used proportional timing fallback/.test(warning),
    ),
    warnings.join("\n"),
  );
  assert.deepEqual(normalized, generateCaptionOverlays(exactCaption, cuts));
});

test("display_text mapping normalizes full-width text without changing matched output", () => {
  const cuts = [{ in: 0, out: 1 }];
  const normalizedCaption = [
    {
      id: "c-0001",
      start: 0,
      end: 1,
      text: "ＡＫＡＲＩ",
      display_text: "AKARI",
      speaker: null,
      sourceRef: null,
      edited: false,
      style: "karaoke",
      words: [{ start: 0, end: 1, text: "ＡＫＡＲＩ" }],
    },
  ];
  const exactCaption = [
    {
      ...normalizedCaption[0],
      text: "AKARI",
      words: [{ start: 0, end: 1, text: "AKARI" }],
    },
  ];
  const warnings = [];
  const normalized = generateCaptionOverlays(normalizedCaption, cuts, {
    onWarning: (warning) => warnings.push(warning),
  });

  assert.ok(
    warnings.every(
      (warning) =>
        !/display-mapping|used proportional timing fallback/.test(warning),
    ),
    warnings.join("\n"),
  );
  assert.deepEqual(normalized, generateCaptionOverlays(exactCaption, cuts));
});
