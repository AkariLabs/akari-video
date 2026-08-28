import assert from "node:assert/strict";
import test from "node:test";

import {
  PROXY_RECIPE_VERSION,
  parseFrameRate,
  previewProxyGopArgs,
  previewProxyVideoArgs,
  proxyRecipeGopFrames,
} from "../src/proxy-recipe.mjs";

test("preview proxy video arguments use the shared one-second GOP recipe", () => {
  assert.deepEqual(previewProxyVideoArgs({
    fps: 30000 / 1001,
    pixFmt: "yuv420p",
    preset: "fast",
    crf: 23,
  }), [
    "-c:v", "libx264",
    "-profile:v", "high",
    "-preset", "fast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-g", "30",
    "-keyint_min", "30",
    "-sc_threshold", "0",
    "-bf", "0",
  ]);
});

test("GOP frames round the source rate and fall back to 30 fps", () => {
  assert.equal(proxyRecipeGopFrames(29.97), "30");
  assert.equal(proxyRecipeGopFrames(59.94), "60");
  assert.equal(proxyRecipeGopFrames(0), "30");
  assert.equal(proxyRecipeGopFrames(undefined), "30");
  assert.deepEqual(previewProxyGopArgs({ fps: 59.94 }), [
    "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-bf", "0",
  ]);
});

test("frame-rate parsing accepts fractions and numeric strings", () => {
  assert.equal(parseFrameRate("30000/1001"), 30000 / 1001);
  assert.equal(parseFrameRate("29.97"), 29.97);
  assert.equal(parseFrameRate("0/0"), undefined);
  assert.equal(parseFrameRate("invalid"), undefined);
});

test("proxy recipe version invalidates prior proxy caches", () => {
  assert.equal(PROXY_RECIPE_VERSION, "gop1s-v1");
});
