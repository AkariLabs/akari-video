import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("GPU backpressure uses dequeue with a MessageChannel fallback and records waits", async () => {
  const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
  assert.match(source, /waitForQueueBelow/);
  assert.match(source, /new MessageChannel\(\)/);
  assert.match(source, /queueWaits \+= 1/);
  assert.doesNotMatch(source, /setTimeout\s*\(/);
});
