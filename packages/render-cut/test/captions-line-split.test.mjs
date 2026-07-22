import assert from "node:assert/strict";
import test from "node:test";

import { splitCaptionLines } from "../src/captions.mjs";

test("punctuation creates a line boundary before the character limit", () => {
  const text = "こう、まあAIエージェントっていうのがあって";
  const lines = splitCaptionLines(text, 20);

  assert.deepEqual(lines, ["こう、", "まあAIエージェントっていうのがあって"]);
  assert.equal(lines.join(""), text);
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
