import { test } from "node:test";
import assert from "node:assert/strict";

import { findAlphaModeTag } from "../bin/person-matte/alpha-tag.mjs";

test("小文字の alpha_mode タグからアルファ値を取得する（Vision 経路）", () => {
  assert.equal(findAlphaModeTag({ alpha_mode: "1" }), "1");
});

test("大文字の ALPHA_MODE タグからアルファ値を取得する（明示メタデータ経路）", () => {
  assert.equal(findAlphaModeTag({ ALPHA_MODE: "1" }), "1");
});

test("alpha_mode 系のタグが無い場合はアルファ値を返さない", () => {
  assert.equal(findAlphaModeTag({ ENCODER: "Lavf" }), undefined);
});

test("tags が無い場合も例外を投げずアルファ値を返さない", () => {
  assert.equal(findAlphaModeTag(undefined), undefined);
  assert.equal(findAlphaModeTag({}), undefined);
});
