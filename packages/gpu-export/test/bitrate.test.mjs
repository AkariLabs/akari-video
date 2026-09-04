import assert from "node:assert/strict";
import test from "node:test";

import { parsePresetBitrate, resolveGpuEncoding } from "../src/bitrate.mjs";

test("GPU quality uses the existing VideoToolbox bitrate presets", () => {
  assert.deepEqual(resolveGpuEncoding({ quality: "high" }), {
    quality: "high", bitrate: 12_000_000, bitrateSource: "quality-preset", quantizer: 18, rateControl: "quantizer",
  });
  assert.deepEqual(resolveGpuEncoding({ quality: "standard" }), {
    quality: "standard", bitrate: 8_000_000, bitrateSource: "quality-preset", quantizer: 26, rateControl: "quantizer",
  });
  assert.deepEqual(resolveGpuEncoding({ quality: "light" }), {
    quality: "light", bitrate: 5_000_000, bitrateSource: "quality-preset", quantizer: 30, rateControl: "quantizer",
  });
  assert.equal(parsePresetBitrate("12M"), 12_000_000);
});

test("GPU master quality requires an explicit bitrate", () => {
  assert.throws(() => resolveGpuEncoding({ quality: "master" }), /master は GPU 出口では --bitrate の明示が必要/);
});

test("an explicit bitrate overrides every quality preset including master", () => {
  assert.deepEqual(resolveGpuEncoding({ quality: "high", bitrate: 60_000_000 }), {
    quality: "high", bitrate: 60_000_000, bitrateSource: "explicit", quantizer: null, rateControl: "bitrate",
  });
  assert.deepEqual(resolveGpuEncoding({ quality: "master", bitrate: 80_000_000 }), {
    quality: "master", bitrate: 80_000_000, bitrateSource: "explicit", quantizer: null, rateControl: "bitrate",
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
    quality: "high", bitrate: 12_000_000, bitrateSource: "quality-preset", quantizer: 18, rateControl: "quantizer",
  });
  assert.deepEqual(resolveGpuEncoding({ quality: "high", width: 3840, height: 2160 }), {
    quality: "high", bitrate: 48_000_000, bitrateSource: "quality-preset-scaled", baseBitrate: 12_000_000, bitrateScale: 4,
    quantizer: 18, rateControl: "quantizer",
  });
  assert.deepEqual(resolveGpuEncoding({ quality: "standard", width: 2560, height: 1440 }), {
    quality: "standard", bitrate: 14_200_000, bitrateSource: "quality-preset-scaled", baseBitrate: 8_000_000, bitrateScale: 1.7778,
    quantizer: 26, rateControl: "quantizer",
  });
  assert.equal(resolveGpuEncoding({ quality: "light", width: 2160, height: 3840 }).bitrate, 20_000_000);
  // 明示値は解像度に関係なく無変換
  assert.deepEqual(resolveGpuEncoding({ quality: "high", bitrate: 9_000_000, width: 3840, height: 2160 }), {
    quality: "high", bitrate: 9_000_000, bitrateSource: "explicit", quantizer: null, rateControl: "bitrate",
  });
});

test("HEVC quality presets use 0.6x bitrate while an explicit bitrate stays unchanged", () => {
  assert.deepEqual(resolveGpuEncoding({ quality: "standard", codec: "hevc" }), {
    quality: "standard",
    bitrate: 4_800_000,
    bitrateSource: "quality-preset-codec-scaled",
    baseBitrate: 8_000_000,
    codecFactor: 0.6,
    quantizer: 24,
    rateControl: "quantizer",
  });
  assert.deepEqual(resolveGpuEncoding({ quality: "standard", codec: "hevc", bitrate: 7_654_321 }), {
    quality: "standard", bitrate: 7_654_321, bitrateSource: "explicit", quantizer: null, rateControl: "bitrate",
  });
});

test("H.264 and HEVC quality tiers expose codec-specific quantizers", () => {
  const expected = {
    h264: { high: 18, standard: 26, light: 30 },
    hevc: { high: 16, standard: 24, light: 30 },
  };
  for (const [codec, qualities] of Object.entries(expected)) {
    for (const [quality, quantizer] of Object.entries(qualities)) {
      const encoding = resolveGpuEncoding({ quality, codec });
      assert.equal(encoding.quantizer, quantizer);
      assert.equal(encoding.rateControl, "quantizer");
    }
  }
});

test("quantizer stays resolution-independent while the compatibility bitrate scales", () => {
  for (const codec of ["h264", "hevc"]) {
    const hd = resolveGpuEncoding({ quality: "standard", codec, width: 1920, height: 1080 });
    const uhd = resolveGpuEncoding({ quality: "standard", codec, width: 3840, height: 2160 });
    assert.equal(uhd.quantizer, hd.quantizer);
    assert.equal(uhd.bitrate, hd.bitrate * 4);
  }
});
