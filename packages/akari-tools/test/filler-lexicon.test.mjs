import assert from "node:assert/strict";
import test from "node:test";
import { countFillerHits, FILLER_LEXICON, findFillerSpans } from "../src/media/filler-lexicon.mjs";

test("findFillerSpans は最長一致でえーとを 1 span にする", () => {
  assert.deepEqual(findFillerSpans("えーと"), [{ from: 0, to: 3, filler: "えーと" }]);
});

test("findFillerSpans は文中のフィラーと直後の読点だけを含める", () => {
  const text = "前、あの、後";
  const spans = findFillerSpans(text);
  assert.deepEqual(spans, [{ from: 2, to: 5, filler: "あの" }]);
  assert.equal(text.slice(spans[0].from, spans[0].to), "あの、");
});

test("findFillerSpans の to は直後の連続する読点を含み、他の文字で止まる", () => {
  for (const suffix of ["、", ",", "、,,、"]) {
    assert.deepEqual(findFillerSpans(`あの${suffix}後`), [{ from: 0, to: 2 + suffix.length, filler: "あの" }]);
  }
  for (const suffix of ["", "後", "。", "！", " 、"]) {
    assert.deepEqual(findFillerSpans(`あの${suffix}`), [{ from: 0, to: 2, filler: "あの" }]);
  }
});

test("findFillerSpans は連続同一も 2 span を返す（除外は候補抽出側）", () => {
  assert.deepEqual(findFillerSpans("あの、あの"), [
    { from: 0, to: 3, filler: "あの" }, { from: 3, to: 5, filler: "あの" },
  ]);
});

test("findFillerSpans は正規化本文のヒットを読点・空白を跨ぐ元区間へ戻す", () => {
  assert.deepEqual(findFillerSpans("あ、の"), [{ from: 0, to: 3, filler: "あの" }]);
  assert.deepEqual(findFillerSpans("説明。あ、の まあ！"), [
    { from: 3, to: 6, filler: "あの" }, { from: 7, to: 9, filler: "まあ" },
  ]);
  assert.deepEqual(findFillerSpans("😀、あ の、後"), [{ from: 3, to: 7, filler: "あの" }]);
});

test("findFillerSpans は語彙のない本文・空文字列で 0 件", () => {
  for (const text of ["説明です。", "", "、 ,。！？"]) assert.deepEqual(findFillerSpans(text), []);
});

test("countFillerHits は既存 3 テストの全入力で spans.length と一致する", () => {
  for (const text of ["あのー", "あのーそのーえーとうーん", ...FILLER_LEXICON,
    "あの、まあ", "説明。あ、の まあ！", "説明です。", ""]) {
    assert.equal(countFillerHits(text), findFillerSpans(text).length, text);
  }
});
