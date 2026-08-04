import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("webview bundle exposes selection only and never ships the Node caption resolver", async () => {
  const [entry, bundle] = await Promise.all([
    readFile(join(packageRoot, "src", "webview-kernel.ts"), "utf8"),
    readFile(join(packageRoot, "lib", "webview-kernel.js"), "utf8"),
  ]);
  for (const value of [entry, bundle]) {
    assert.doesNotMatch(value, /resolveCaptionDisplay/u);
    assert.doesNotMatch(value, /Intl\.Segmenter/u);
    assert.doesNotMatch(value, /a4-ja-two-fragment-v1/u);
  }
  assert.match(bundle, /findActiveResolvedCaption/u);
});
