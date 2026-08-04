import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { validateAndCountReview } from "../src/status-core/review.mjs";

const fixturesRoot = resolve(import.meta.dirname, "../../schemas/fixtures/review");

test("status review validation stays in parity with canonical shared fixtures", async () => {
  const fixtureNames = (await readdir(fixturesRoot)).sort((left, right) => left.localeCompare(right, "en"));
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
