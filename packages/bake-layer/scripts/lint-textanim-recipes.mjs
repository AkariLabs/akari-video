#!/usr/bin/env node
// bake-layer 数値レシピと presets/textanim 語彙正本の id / slot 1:1 を検査する。
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { TEXTANIM_RECIPE_SLOTS } from "../vendor/telop/atf/textanim-recipes.mjs"

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..")
const INDEX_PATH = join(REPO_ROOT, "presets", "textanim", "index.jsonl")
const catalog = (await readFile(INDEX_PATH, "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line))

const expected = new Map(catalog.map((entry) => [entry.id, entry.slot]))
const actual = new Map(Object.entries(TEXTANIM_RECIPE_SLOTS))
const errors = []

for (const [id, slot] of expected) {
  if (!actual.has(id)) errors.push(`${id}: bake-layer レシピがありません`)
  else if (actual.get(id) !== slot) errors.push(`${id}: slot=${actual.get(id)}（期待 ${slot}）`)
}
for (const id of actual.keys()) {
  if (!expected.has(id)) errors.push(`${id}: textanim カタログに無い余剰レシピです`)
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[lint-textanim-recipes] ${error}`)
  console.error(`[lint-textanim-recipes] FAIL ${errors.length} 件`)
  process.exitCode = 1
} else {
  console.log(`[lint-textanim-recipes] PASS ${actual.size}/${expected.size}`)
}
