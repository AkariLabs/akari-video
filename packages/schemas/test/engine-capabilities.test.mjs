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
const { readInternalEdit } = require("../../edit-store/lib/internal-model.js");
const { readEditV2 } = require("../../edit-store/lib/edit-v2.js");

const canonicalPaths = new Set([
  ...ITEM_V2_KEYS.map((key) => `tracks[].items[].${key}`),
  ...ITEM_SOURCE_V2_KEYS.map((key) => `tracks[].items[].source.${key}`),
  ...KEYFRAME_V2_KEYS.map((key) => `tracks[].items[].keyframes[].${key}`),
]);
// Spatial effects have a dedicated nested capability below the generated item-level adjust key.
const capabilityPaths = new Set([...canonicalPaths, 'tracks[].items[].adjust.fx']);
const appliesToVocabulary = new Set(["cuts", "layers", "overlays", "baked", "audio", "captions", "group"]);

test("engine capability table declares the version, engines, and status vocabulary", () => {
  assert.equal(table.version, 1);
  assert.deepEqual(table.engines, ["gpu", "osr"]);
  assert.deepEqual(table.statuses, ["consumed", "partial", "ignored", "other-subsystem"]);
});

test("generated keys have capability rows or the explicit cut-audio runtime rejection", () => {
  assert.equal(canonicalPaths.size, 71);
  const covered = new Set(table.fields.map((field) => field.path));
  assert.ok(covered.has('tracks[].items[].adjust.fx'));
  // contract-2026-09-06-cut-audio-split-v0.md, first task: these three added keys
  // cannot reach an engine yet. Preserve coverage for all 68 executable keys and
  // require an actual default-reader rejection for each temporarily uncovered key.
  const gated = [
    [0, 'audio', false], [1, 'link', 'cut'], [1, 'mute', false],
  ];
  assert.deepEqual([...canonicalPaths].filter((path) => !covered.has(path)).sort(),
    gated.map(([, key]) => `tracks[].items[].${key}`).sort());
  for (const [track, key, value] of gated) {
    const doc = JSON.parse(readFileSync(join(packageRoot, 'examples/edit-v2-cut-audio-split-valid/edit.json'), 'utf8'));
    delete doc.tracks[0].items[0].audio;
    for (const field of ['role', 'link', 'mute']) delete doc.tracks[1].items[0][field];
    doc.tracks[track].items[0][key] = value;
    assert.doesNotThrow(() => readEditV2(doc));
    assert.throws(() => readInternalEdit(doc), /未対応: 本編音声の分離.*次の便/u);
  }
});

test("capability rows cannot invent paths outside the generated v2 key inventory", () => {
  assert.deepEqual(table.fields.filter((field) => !capabilityPaths.has(field.path)), []);
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
