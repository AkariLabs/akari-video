import assert from "node:assert/strict";
import test from "node:test";

import { renderCaptionFragment, renderStyledCaptionFragment } from "../src/captions.mjs";

const DEFAULT_SHADOW = "text-shadow: var(--caption-text-shadow, -1.5px -1.5px 0 rgba(0,0,0,.85), 1.5px -1.5px 0 rgba(0,0,0,.85), -1.5px 1.5px 0 rgba(0,0,0,.85), 1.5px 1.5px 0 rgba(0,0,0,.85), 0 0 8px rgba(0,0,0,.6));";
const WORDS = [
  { start: 0, end: 0.5, text: "字幕" },
  { start: 0.5, end: 1, text: "表示" },
];

function assertDefaultStyle(fragment) {
  assert.match(fragment, /background: var\(--plate-bg, transparent\);/);
  assert.ok(fragment.includes(DEFAULT_SHADOW));
  assert.match(fragment, /color: var\(--caption-color, #fff\);/);
}

test("plain captions default to transparent plates with outlined white text", () => {
  assertDefaultStyle(renderCaptionFragment("字幕表示"));
});

test("karaoke captions share the transparent plate and text outline defaults", () => {
  const fragment = renderStyledCaptionFragment(WORDS, "karaoke");
  assertDefaultStyle(fragment);
  assert.match(fragment, /color: var\(--caption-highlight-color, #ffd94a\);/);
});

test("pop captions share the transparent plate and text outline defaults", () => {
  assertDefaultStyle(renderStyledCaptionFragment(WORDS, "pop"));
});

test("the plate remains opt-in through the overridable CSS custom property", () => {
  for (const fragment of [renderCaptionFragment("字幕表示"), renderStyledCaptionFragment(WORDS, "karaoke")]) {
    assert.equal((fragment.match(/var\(--plate-bg, transparent\)/g) ?? []).length, 1);
    assert.doesNotMatch(fragment, /background: transparent;/);
  }
});
