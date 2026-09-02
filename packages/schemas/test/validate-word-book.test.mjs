import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  normalizeWordBookKey,
  runValidateWordBookCli,
  validateWordBook,
} from "../bin/validate-word-book.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const example = (name) => JSON.parse(readFileSync(path.join(root, "examples", name, "word-book.json"), "utf8"));

test("valid 実例を受理する", () => {
  assert.equal(validateWordBook(example("word-book-v0-valid")).valid, true);
});

test("variant 正規化キーの entry 間衝突を拒否する", () => {
  assert.match(validateWordBook(example("word-book-v0-invalid-variant-conflict")).errors.join("\n"), /衝突/);
});

test("reading-only の variants を拒否する", () => {
  assert.match(validateWordBook(example("word-book-v0-invalid-reading-only-variants")).errors.join("\n"), /reading-only では空/);
});

test("version 1 は更新案内つきで停止する", () => {
  const result = validateWordBook(example("word-book-v0-invalid-version-1"));
  assert.equal(result.tooNew, true);
  assert.match(result.errors[0], /このファイルは新しい形式です。スキル \/ アプリを更新してください/);
});

test("surface は trim 済み NFC を要求する", () => {
  const spaced = validateWordBook({ version: 0, entries: [{ surface: " 語", kind: "term" }] });
  const decomposed = validateWordBook({ version: 0, entries: [{ surface: "ガ", kind: "term" }] });
  assert.match(spaced.errors.join("\n"), /前後空白/);
  assert.match(decomposed.errors.join("\n"), /NFC/);
});

test("surface の正規化キーは一意である", () => {
  const result = validateWordBook({
    version: 0,
    entries: [{ surface: "AKARI Video", kind: "term" }, { surface: "ａｋａｒｉ　ｖｉｄｅｏ", kind: "term" }],
  });
  assert.match(result.errors.join("\n"), /重複/);
});

test("variant は自 entry の surface と同じキーでもよい", () => {
  const result = validateWordBook({ version: 0, entries: [{ surface: "AKARI", variants: ["ａｋａｒｉ"], kind: "term" }] });
  assert.equal(result.valid, true);
});

test("notation は variant を 1 件以上要求する", () => {
  assert.match(validateWordBook({ version: 0, entries: [{ surface: "動画", kind: "notation" }] }).errors.join("\n"), /1 件以上/);
});

test("reading はかなと長音だけを受理する", () => {
  assert.equal(validateWordBook({ version: 0, entries: [{ surface: "語", reading: "ゴー", kind: "term" }] }).valid, true);
  assert.match(validateWordBook({ version: 0, entries: [{ surface: "語", reading: "go", kind: "term" }] }).errors.join("\n"), /ひらがな/);
});

test("未知 entry フィールドは info に留めて保持可能にする", () => {
  const result = validateWordBook({ version: 0, entries: [{ surface: "語", kind: "term", future: { keep: true } }] });
  assert.equal(result.valid, true);
  assert.match(result.info.join("\n"), /word-book.unknown-field/);
});

test("normalizeWordBookKey は純関数パッケージと同じ規則を使う", async () => {
  const { normalizeKey } = await import("../../word-book/src/index.mjs");
  for (const value of ["ＡＫＡＲＩ Video", "A\u030A K A R I", " 明かり\tビデオ "]) {
    assert.equal(normalizeWordBookKey(value), normalizeKey(value));
  }
});

test("CLI は valid=0 / invalid=1 を返す", () => {
  const output = [];
  const valid = runValidateWordBookCli([path.join(root, "examples", "word-book-v0-valid", "word-book.json")], { stdout: (line) => output.push(line), stderr: () => {} });
  const invalid = runValidateWordBookCli([path.join(root, "examples", "word-book-v0-invalid-version-1", "word-book.json")], { stdout: () => {}, stderr: () => {} });
  assert.equal(valid, 0);
  assert.equal(invalid, 1);
  assert.match(output[0], /^OK:/);
});
