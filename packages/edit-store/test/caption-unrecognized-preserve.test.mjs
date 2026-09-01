import assert from "node:assert/strict";
import test from "node:test";

import { updateCaptionFieldsInSource } from "../lib/caption-store.js";
import {
  applyCaptionTextEdit,
  rederiveCaptionWords,
} from "../lib/caption-words-rederive.js";

const unrecognized = [{ start: 0.7, end: 0.8 }, { start: 1.6, end: 1.7 }];
const words = [
  { start: 0.1, end: 0.7, text: "alpha" },
  { start: 0.8, end: 1.6, text: "beta" },
  { start: 1.7, end: 2.9, text: "gamma" },
];

test("applyCaptionTextEdit は 1 語修正後も unrecognized をバイト同一で保つ", () => {
  const before = JSON.stringify(unrecognized);
  const record = {
    id: "c-0001", start: 0, end: 3, text: "alpha beta gamma", words,
    unrecognized, speaker: null, sourceRef: null, edited: false,
  };
  const updated = applyCaptionTextEdit(record, "alpha delta gamma").record;
  assert.equal(JSON.stringify(updated.unrecognized), before);
  assert.deepEqual(updated.words[0], words[0]);
  assert.deepEqual(updated.words[2], words[2]);
});

test("updateCaptionFieldsInSource はフィールド更新後も unrecognized をバイト同一で保つ", () => {
  const record = {
    id: "c-0001", start: 0, end: 3, text: "alpha beta gamma", words,
    unrecognized, speaker: null, sourceRef: null, edited: false,
  };
  const source = `[\n  ${JSON.stringify(record)}\n]\n`;
  const updated = updateCaptionFieldsInSource(source, "c-0001", { text: "alpha delta gamma" });
  assert.equal(JSON.stringify(JSON.parse(updated)[0].unrecognized), JSON.stringify(unrecognized));
});

test("rederiveCaptionWords の語出力へ unrecognized は混ざらない", () => {
  const result = rederiveCaptionWords({
    oldText: "alpha beta gamma",
    newText: "alpha delta gamma",
    words,
    start: 0,
    end: 3,
  });
  assert.ok(result.words.every((word) => Object.keys(word).sort().join(",") === "end,start,text"));
  assert.ok(result.words.every((word) => !Object.hasOwn(word, "unrecognized")));
});
