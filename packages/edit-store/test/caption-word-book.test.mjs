import assert from "node:assert/strict";
import test from "node:test";

import { applyWordBookToCaptionsInSource } from "../lib/caption-store.js";

const base = (id, extra = {}) => ({
  id, start: 0, end: 2, text: "あかり ビデオ", speaker: null,
  sourceRef: null, edited: false, ...extra,
});

test("4 フィールドを同じ字幕レコードへ同時に書き換える", () => {
  const source = JSON.stringify([base("c-0001", {
    words: [{ start: 0, end: 1, text: "あかり" }, { start: 1, end: 2, text: "ビデオ" }],
    display_text: "あかり ビデオ",
    display_fragments: ["あかり ", "ビデオ"],
  })], null, 2);
  const words = [{ start: 0, end: 2, text: "AKARI Video" }];
  const result = JSON.parse(applyWordBookToCaptionsInSource(source, [{
    id: "c-0001", text: "AKARI Video", words,
    display_text: "AKARI Video", display_fragments: ["AKARI Video"],
  }]))[0];
  assert.equal(result.text, "AKARI Video");
  assert.deepEqual(result.words, words);
  assert.equal(result.display_text, "AKARI Video");
  assert.deepEqual(result.display_fragments, ["AKARI Video"]);
});

test("changes が空なら同じ文字列参照を返す", () => {
  const source = "[ ]\n";
  assert.equal(applyWordBookToCaptionsInSource(source, []), source);
});

test("words undefined は既存キーを削除する", () => {
  const source = JSON.stringify([base("c-0001", { words: [{ start: 0, end: 2, text: "旧" }] })]);
  const result = JSON.parse(applyWordBookToCaptionsInSource(source, [{ id: "c-0001", text: "新" }]))[0];
  assert.equal(Object.hasOwn(result, "words"), false);
});

test("display_text undefined は既存キーを削除する", () => {
  const source = JSON.stringify([base("c-0001", { display_text: "旧" })]);
  const result = JSON.parse(applyWordBookToCaptionsInSource(source, [{ id: "c-0001", text: "新" }]))[0];
  assert.equal(Object.hasOwn(result, "display_text"), false);
});

test("display_fragments undefined は既存キーを削除する", () => {
  const source = JSON.stringify([base("c-0001", { display_fragments: ["旧"] })]);
  const result = JSON.parse(applyWordBookToCaptionsInSource(source, [{ id: "c-0001", text: "新" }]))[0];
  assert.equal(Object.hasOwn(result, "display_fragments"), false);
});

test("存在しない optional フィールドを追加する", () => {
  const source = JSON.stringify([base("c-0001")]);
  const result = JSON.parse(applyWordBookToCaptionsInSource(source, [{
    id: "c-0001", text: "新", words: [], display_text: "表示", display_fragments: ["表示"],
  }]))[0];
  assert.deepEqual(result.words, []);
  assert.equal(result.display_text, "表示");
  assert.deepEqual(result.display_fragments, ["表示"]);
});

test("未知 id は throw する", () => {
  assert.throws(
    () => applyWordBookToCaptionsInSource(JSON.stringify([base("c-0001")]), [{ id: "c-9999", text: "新" }]),
    /字幕 c-9999 が字幕データにありません/u,
  );
});

test("配列ルートを更新する", () => {
  const result = JSON.parse(applyWordBookToCaptionsInSource(
    JSON.stringify([base("c-0001")]), [{ id: "c-0001", text: "新" }],
  ));
  assert.equal(result[0].text, "新");
});

test("object ルートの captions 配列を更新する", () => {
  const result = JSON.parse(applyWordBookToCaptionsInSource(
    JSON.stringify({ version: 0, captions: [base("c-0001")] }), [{ id: "c-0001", text: "新" }],
  ));
  assert.equal(result.captions[0].text, "新");
  assert.equal(result.version, 0);
});

test("複数レコードは毎回オフセットを取り直して順に更新する", () => {
  const source = JSON.stringify([base("c-0001"), base("c-0002"), base("c-0003")], null, 2);
  const result = JSON.parse(applyWordBookToCaptionsInSource(source, [
    { id: "c-0001", text: "非常に長い新しい本文" },
    { id: "c-0003", text: "短" },
  ]));
  assert.deepEqual(result.map(item => item.text), ["非常に長い新しい本文", "あかり ビデオ", "短"]);
});

test("変更対象外レコードと edited はバイト同一で残る", () => {
  const untouched = '{ "id": "c-0002", "start": 2, "end": 4, "text": "人の本文", "speaker": null, "sourceRef": null, "edited": true, "unknown": { "x": 1 } }';
  const source = `[\n  ${JSON.stringify(base("c-0001"))},\n  ${untouched}\n]\n`;
  const result = applyWordBookToCaptionsInSource(source, [{ id: "c-0001", text: "AKARI Video" }]);
  assert.ok(result.includes(untouched));
  assert.equal(JSON.parse(result)[1].edited, true);
});

test("変更対象レコードの未知キーと edited 値を保つ", () => {
  const source = JSON.stringify([base("c-0001", { edited: true, unknown: [1, 2] })]);
  const result = JSON.parse(applyWordBookToCaptionsInSource(source, [{ id: "c-0001", text: "新" }]))[0];
  assert.equal(result.edited, true);
  assert.deepEqual(result.unknown, [1, 2]);
});
