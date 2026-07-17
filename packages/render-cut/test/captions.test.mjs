import assert from "node:assert/strict";
import test from "node:test";

import {
  generateCaptionOverlays,
  renderCaptionFragment,
  sourceRangeToTimeline,
} from "../src/captions.mjs";

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
