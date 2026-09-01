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

test("quality presets scale with output pixels above 1080p and stay put at or below it", async () => {
  const { gpuBitrateScale } = await import("../src/bitrate.mjs");
  assert.equal(gpuBitrateScale({ width: 1920, height: 1080 }), 1);
  assert.equal(gpuBitrateScale({ width: 1080, height: 1920 }), 1); // 縦型 1080p は同じピクセル数
  assert.equal(gpuBitrateScale({ width: 1280, height: 720 }), 1); // 基準未満は下げない
  assert.equal(gpuBitrateScale({ width: 3840, height: 2160 }), 4);
  assert.equal(gpuBitrateScale({}), 1);
  assert.deepEqual(resolveGpuEncoding({ quality: "high", width: 1920, height: 1080 }), {
    quality: "high", bitrate: 12_000_000, bitrateSource: "quality-preset",
  });
  assert.deepEqual(resolveGpuEncoding({ quality: "high", width: 3840, height: 2160 }), {
    quality: "high", bitrate: 48_000_000, bitrateSource: "quality-preset-scaled", baseBitrate: 12_000_000, bitrateScale: 4,
  });
  assert.deepEqual(resolveGpuEncoding({ quality: "standard", width: 2560, height: 1440 }), {
    quality: "standard", bitrate: 14_200_000, bitrateSource: "quality-preset-scaled", baseBitrate: 8_000_000, bitrateScale: 1.7778,
  });
  assert.equal(resolveGpuEncoding({ quality: "light", width: 2160, height: 3840 }).bitrate, 20_000_000);
  // 明示値は解像度に関係なく無変換
  assert.deepEqual(resolveGpuEncoding({ quality: "high", bitrate: 9_000_000, width: 3840, height: 2160 }), {
    quality: "high", bitrate: 9_000_000, bitrateSource: "explicit",
  });
});
