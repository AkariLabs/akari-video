import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("GPU 3D drives threeRuntime directly without the overlay-sheet seek path", async () => {
  const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
  assert.doesNotMatch(source, /contentWindow\.__akariSeek/);
  assert.match(source, /threeRuntime\.render\(record\.container, seconds - value\.start\)/);
  assert.match(source, /const stages = \{ evaluate: \[\], three: \[\]/);
  assert.match(source, /threeRuntime\.inspect\(container\)/);
  assert.match(source, /status === "error"/);
  assert.match(source, /style\.visibility = "visible"/);
});
