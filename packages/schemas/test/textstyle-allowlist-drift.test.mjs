import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = path => readFileSync(new URL(path, import.meta.url), "utf8");
const schemaKeys = Object.keys(JSON.parse(readSource("../captions.schema.json")).$defs.textStyle.properties);

function extractKeys(source, identifier) {
  const block = source.match(new RegExp(`\\b${identifier}\\s*=\\s*new\\s+Set\\s*\\(\\s*\\[([\\s\\S]*?)\\]\\s*\\)`));
  assert.ok(block, `${identifier}: new Set([...]) block must be found`);
  const keys = new Set([...block[1].matchAll(/["']([^"']+)["']/gu)].map(match => match[1]));
  assert.ok(keys.size > 0, `${identifier}: extracted keys must not be empty`);
  return keys;
}

// A/B/D のどれか 1 か所から schema のキーを故意に消せば、この包含検査は落ちる。
// legacy キー等の余分なキーは許す（schema ⊆ allowlist の片方向包含）。
for (const [identifier, path] of [
  ["allowedKeys", "../bin/validate-captions.mjs"],
  ["CAPTION_STYLE_KEYS", "../../edit-store/src/caption-display.ts"],
  ["TEXT_STYLE_KEYS", "../../edit-store/src/caption-store.ts"],
]) {
  test(`${identifier} contains every schema textStyle key`, () => {
    const keys = extractKeys(readSource(path), identifier);
    for (const key of schemaKeys) assert.ok(keys.has(key), `${identifier} is missing ${key}`);
  });
}

test("edit-lint derives CAPTION_TEXT_STYLE_FIELDS directly from the schema", () => {
  // C は手書き Set ではない。schema からの導出が維持されることを固定する。
  assert.match(readSource("../../edit-lint/src/edit-lint.mjs"),
    /\bCAPTION_TEXT_STYLE_FIELDS\s*=\s*new\s+Set\s*\(\s*Object\.keys\(CAPTIONS_SCHEMA\.\$defs\.textStyle\.properties\),?\s*\)/u);
});
