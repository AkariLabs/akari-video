import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { validateAndCountReview } from "../src/status-core/review.mjs";

const fixturesRoot = resolve(import.meta.dirname, "../../schemas/fixtures/review");

test("status review validates absent, present, empty, and non-string content-rect sessionRef", async () => {
  const direct = JSON.parse(await readFile(resolve(fixturesRoot, "valid-strokes-direct", "review.json"), "utf8"));
  for (const [label, sessionRef, valid] of [
    ["absent", undefined, true],
    ["present", "s-0001/st-0001", true],
    ["empty", "", false],
    ["number", 5, false],
    ["null", null, false],
  ]) {
    const review = structuredClone(direct);
    if (label !== "absent") review.annotations[0].strokes[0].sessionRef = sessionRef;
    const result = validateAndCountReview(review);
    if (valid) assert.deepEqual(result.problems, [], label);
    else assert.match(result.problems.join("\n"), /sessionRef must be non-empty when present/, label);
  }
});

test("status review leaves non-monotonic content-rect points unchanged", async () => {
  const review = JSON.parse(await readFile(resolve(fixturesRoot, "valid-strokes-direct", "review.json"), "utf8"));
  review.annotations[0].strokes[0].points = [[0.8, 0.7], [0.2, 0.3], [0.6, 0.1], [0.4, 0.9]];
  const before = structuredClone(review);
  assert.deepEqual(validateAndCountReview(review).problems, []);
  assert.deepEqual(review, before);
});

test("status review validation stays in parity with canonical shared fixtures", async () => {
  const fixtureNames = (await readdir(fixturesRoot)).sort((left, right) => left.localeCompare(right, "en"));
  assert.ok(fixtureNames.includes("valid-strokes"));
  assert.ok(fixtureNames.includes("valid-strokes-direct"));
  assert.ok(fixtureNames.includes("invalid-strokes-content-rect-empty-sessionref"));
  for (const name of fixtureNames) {
    const review = JSON.parse(await readFile(resolve(fixturesRoot, name, "review.json"), "utf8"));
    const result = validateAndCountReview(review);
    if (name.startsWith("valid")) {
      assert.deepEqual(result.problems, [], `${name} should be valid`);
    } else if (name.startsWith("invalid")) {
      assert.ok(result.problems.length > 0, `${name} should fail closed`);
    }
  }
});
