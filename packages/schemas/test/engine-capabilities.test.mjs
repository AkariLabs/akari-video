import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const table = JSON.parse(readFileSync(join(packageRoot, "engine-capabilities.json"), "utf8"));
const require = createRequire(import.meta.url);
const {
  ITEM_V2_KEYS,
  ITEM_SOURCE_V2_KEYS,
  KEYFRAME_V2_KEYS,
} = require("../../edit-store/lib/generated/edit-v2-keys.js");

const canonicalPaths = new Set([
  ...ITEM_V2_KEYS.map((key) => `tracks[].items[].${key}`),
  ...ITEM_SOURCE_V2_KEYS.map((key) => `tracks[].items[].source.${key}`),
  ...KEYFRAME_V2_KEYS.map((key) => `tracks[].items[].keyframes[].${key}`),
]);
const appliesToVocabulary = new Set(["cuts", "layers", "overlays", "baked", "audio", "captions", "group"]);

test("engine capability table declares the version, engines, and status vocabulary", () => {
  assert.equal(table.version, 1);
  assert.deepEqual(table.engines, ["gpu", "osr"]);
  assert.deepEqual(table.statuses, ["consumed", "partial", "ignored", "other-subsystem"]);
});

test("all 56 generated item, source, and keyframe keys have a capability row", () => {
  assert.equal(canonicalPaths.size, 56);
  const covered = new Set(table.fields.map((field) => field.path));
  assert.deepEqual([...canonicalPaths].filter((path) => !covered.has(path)), []);
});

test("capability rows cannot invent paths outside the generated v2 key inventory", () => {
  assert.deepEqual(table.fields.filter((field) => !canonicalPaths.has(field.path)), []);
});

test("every capability row uses only declared engine status values", () => {
  const statuses = new Set(table.statuses);
  for (const [index, field] of table.fields.entries()) {
    for (const engine of table.engines) {
      assert.ok(statuses.has(field[engine]), `fields[${index}].${engine}: ${String(field[engine])}`);
    }
  }
});

test("every capability row has evidence and a non-empty valid applies_to list", () => {
  for (const [index, field] of table.fields.entries()) {
    assert.equal(typeof field.evidence, "string", `fields[${index}].evidence`);
    assert.notEqual(field.evidence.trim(), "", `fields[${index}].evidence`);
    assert.ok(Array.isArray(field.applies_to) && field.applies_to.length > 0, `fields[${index}].applies_to`);
    assert.equal(new Set(field.applies_to).size, field.applies_to.length, `fields[${index}].applies_to duplicates`);
    for (const value of field.applies_to) {
      assert.ok(appliesToVocabulary.has(value), `fields[${index}].applies_to: ${String(value)}`);
    }
  }
});

test("path and applies_to pairs are unambiguous for lint lookup", () => {
  const seen = new Set();
  for (const field of table.fields) {
    for (const appliesTo of field.applies_to) {
      const key = `${field.path}\0${appliesTo}`;
      assert.equal(seen.has(key), false, `${field.path} has duplicate ${appliesTo} rows`);
      seen.add(key);
    }
  }
  assert.deepEqual(new Set(table.fields.flatMap((field) => field.applies_to)), appliesToVocabulary);
});
