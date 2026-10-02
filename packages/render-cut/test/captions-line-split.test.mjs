import assert from "node:assert/strict";
import test from "node:test";

import { generateCaptionOverlays, splitCaptionLines } from "../src/captions.mjs";

test("a comma stays on one line when the caption fits", () => {
  assert.deepEqual(splitCaptionLines("ほら、こんな感じで。", 20), ["ほら、こんな感じで。"]);
});

test("a long caption wraps after the last comma within the limit", () => {
  const text = "あいう、かきく、けこさしすせそ";
  const lines = splitCaptionLines(text, 9);
  assert.deepEqual(lines, ["あいう、かきく、", "けこさしすせそ"]);
  assert.equal(lines.join(""), text);
});

test("a comma takes priority over phrase and space boundaries", () => {
  assert.deepEqual(splitCaptionLines("今日は、とても良い天気なので散歩に行きましょう", 20),
    ["今日は、", "とても良い天気なので散歩に行きましょう"]);
  assert.deepEqual(splitCaptionLines("あいう、かきく けこさし", 8),
    ["あいう、", "かきく けこさし"]);
});

test("a leading comma does not form a line by itself", () => {
  assert.deepEqual(splitCaptionLines("、あいうえおかきくけこ", 5),
    ["、あいうえ", "おかきくけ", "こ"]);
});

test("a full stop creates a line boundary even when the caption fits", () => {
  assert.deepEqual(splitCaptionLines("ほら。こんな感じで。", 20), ["ほら。", "こんな感じで。"]);
});

test("a short caption without punctuation stays on one line", () => {
  assert.deepEqual(splitCaptionLines("これちょっと録画撮って", 20), ["これちょっと録画撮って"]);
});

test("long captions preserve every source character while splitting at natural boundaries", () => {
  const text = "字幕の内容を自然な文節のまとまりで読みやすく分割して表示します";
  const lines = splitCaptionLines(text, 20);

  assert.equal(lines.join(""), text);
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => Array.from(line).length <= 20));
});

test("explicit newlines remain paragraph boundaries", () => {
  assert.deepEqual(splitCaptionLines("短い一行\n次の一行", 20), ["短い一行", "次の一行"]);
});

test("the rendered caption uses one line for a short comma caption and two for an overflow", () => {
  const lineCount = text => {
    const [overlay] = generateCaptionOverlays(
      [{ id: "caption", start: 0, end: 2, text }], [],
      { output: { width: 1920, height: 1080, fps: 30 } },
    );
    return (overlay.html.match(/<p class="akari-caption__line">/gu) ?? []).length;
  };
  assert.equal(lineCount("ほら、こんな感じで。"), 1);
  assert.equal(lineCount("あいう、かきく、けこさしすせそたちつてとな"), 2);
});
