import assert from "node:assert/strict";
import test from "node:test";

import { parsePresetBitrate, resolveGpuEncoding } from "../src/bitrate.mjs";

test("GPU quality uses the existing VideoToolbox bitrate presets", () => {
  assert.deepEqual(resolveGpuEncoding({ quality: "high" }), {
    quality: "high", bitrate: 12_000_000, bitrateSource: "quality-preset",
  });
  assert.deepEqual(resolveGpuEncoding({ quality: "standard" }), {
    quality: "standard", bitrate: 8_000_000, bitrateSource: "quality-preset",
  });
  assert.deepEqual(resolveGpuEncoding({ quality: "light" }), {
    quality: "light", bitrate: 5_000_000, bitrateSource: "quality-preset",
  });
  assert.equal(parsePresetBitrate("12M"), 12_000_000);
});

test("GPU master quality requires an explicit bitrate", () => {
  assert.throws(() => resolveGpuEncoding({ quality: "master" }), /master は GPU 出口では --bitrate の明示が必要/);
});

test("an explicit bitrate overrides every quality preset including master", () => {
  assert.deepEqual(resolveGpuEncoding({ quality: "high", bitrate: 60_000_000 }), {
    quality: "high", bitrate: 60_000_000, bitrateSource: "explicit",
  });
  assert.deepEqual(resolveGpuEncoding({ quality: "master", bitrate: 80_000_000 }), {
    quality: "master", bitrate: 80_000_000, bitrateSource: "explicit",
  });
});

test("GPU bitrate preset errors use platform-neutral wording", () => {
  assert.throws(() => parsePresetBitrate("not-a-rate"), /invalid GPU bitrate preset/u);
  assert.throws(() => parsePresetBitrate("0"), /GPU bitrate preset must be a positive integer/u);
});
