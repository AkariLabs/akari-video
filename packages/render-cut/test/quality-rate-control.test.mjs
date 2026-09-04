import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVideoEncodeArgs,
  isVideotoolboxQualityModeAvailable,
  QUALITY_PRESETS,
  resetVideotoolboxCacheForTests,
  resolveEncodingPolicy,
} from "../src/encode-preset.mjs";

const EXPECTED_QUALITY_VALUES = {
  master: [null, null, null, null],
  high: [66, 76, 18, 16],
  standard: [55, 62, 26, 24],
  light: [47, 53, 30, 30],
};

const COLOR_OPTIONS = ["-colorspace", "-color_primaries", "-color_trc", "-color_range"];

function valueAfter(args, option) {
  return args[args.indexOf(option) + 1];
}

function assertColorMetadata(args, codec) {
  for (const option of COLOR_OPTIONS) assert.ok(args.includes(option), `${option} must remain present`);
  assert.equal(valueAfter(args, "-colorspace"), "bt709");
  assert.equal(
    valueAfter(args, "-bsf:v"),
    codec === "hevc"
      ? "hevc_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1"
      : "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1",
  );
}

test("quality presets expose the measured VideoToolbox and WebCodecs values", () => {
  for (const [quality, expected] of Object.entries(EXPECTED_QUALITY_VALUES)) {
    assert.deepEqual([
      QUALITY_PRESETS[quality].videotoolboxQuality,
      QUALITY_PRESETS[quality].videotoolboxHevcQuality,
      QUALITY_PRESETS[quality].webcodecsQuantizer,
      QUALITY_PRESETS[quality].webcodecsHevcQuantizer,
    ], expected);
  }
});

test("quality values are monotonic in each encoder's scale direction", () => {
  for (const field of ["videotoolboxQuality", "videotoolboxHevcQuality"]) {
    assert.ok(QUALITY_PRESETS.light[field] < QUALITY_PRESETS.standard[field]);
    assert.ok(QUALITY_PRESETS.standard[field] < QUALITY_PRESETS.high[field]);
  }
  for (const field of ["webcodecsQuantizer", "webcodecsHevcQuantizer"]) {
    assert.ok(QUALITY_PRESETS.light[field] > QUALITY_PRESETS.standard[field]);
    assert.ok(QUALITY_PRESETS.standard[field] > QUALITY_PRESETS.high[field]);
  }
});

test("VideoToolbox builder keeps fixed bitrate by default and opts into quality mode", () => {
  for (const [codec, bitrate, qualityValue] of [["h264", "8M", "55"], ["hevc", "4.8M", "62"]]) {
    const options = {
      quality: "standard",
      encoderChoice: { engine: "videotoolbox" },
      codec,
      profile: codec === "hevc" ? "main" : "high",
    };
    const fixed = buildVideoEncodeArgs(options);
    const quality = buildVideoEncodeArgs({ ...options, videotoolboxRateControl: "quality" });
    assert.equal(valueAfter(fixed, "-b:v"), bitrate);
    assert.equal(fixed.includes("-q:v"), false);
    assert.equal(valueAfter(quality, "-q:v"), qualityValue);
    assert.equal(quality.includes("-b:v"), false);
    assertColorMetadata(fixed, codec);
    assertColorMetadata(quality, codec);
  }
});

test("VideoToolbox master remains unsupported in both rate-control modes", () => {
  for (const codec of ["h264", "hevc"]) {
    for (const videotoolboxRateControl of ["bitrate", "quality"]) {
      assert.throws(() => buildVideoEncodeArgs({
        quality: "master",
        encoderChoice: { engine: "videotoolbox" },
        codec,
        videotoolboxRateControl,
      }), /master quality does not support videotoolbox/u);
    }
  }
});

test("VideoToolbox quality-mode probe reports success/failure, honors force fallback, and caches", () => {
  resetVideotoolboxCacheForTests();
  const successfulArgs = [];
  const successfulSpawn = (_command, args) => {
    successfulArgs.push(args);
    return { status: 0 };
  };
  assert.equal(isVideotoolboxQualityModeAvailable({
    ffmpegCommand: "quality-probe-success",
    env: {},
    spawnSyncImpl: successfulSpawn,
  }), true);
  assert.equal(isVideotoolboxQualityModeAvailable({
    ffmpegCommand: "quality-probe-success",
    env: {},
    spawnSyncImpl: successfulSpawn,
  }), true);
  assert.equal(successfulArgs.length, 1);
  assert.equal(valueAfter(successfulArgs[0], "-q:v"), "55");

  assert.equal(isVideotoolboxQualityModeAvailable({
    ffmpegCommand: "quality-probe-failure",
    env: {},
    spawnSyncImpl: () => ({ status: 1 }),
  }), false);

  let forcedCalls = 0;
  assert.equal(isVideotoolboxQualityModeAvailable({
    ffmpegCommand: "quality-probe-forced",
    env: { AKARI_EXPORT_FORCE_FIXED_BITRATE: "1" },
    spawnSyncImpl: () => { forcedCalls += 1; return { status: 0 }; },
  }), false);
  assert.equal(forcedCalls, 0);
});

test("encoding policy records VideoToolbox quality mode and fixed-bitrate fallback", () => {
  resetVideotoolboxCacheForTests();
  const qualityPolicy = resolveEncodingPolicy({
    cli: { quality: "standard", encoder: "videotoolbox" },
    capabilities: { ffmpegCommand: "policy-quality-mode" },
    env: {},
    spawnSyncImpl: () => ({ status: 0 }),
  });
  assert.deepEqual(qualityPolicy.rate_control, {
    engine: "videotoolbox",
    mode: "quality",
    quality_value: 55,
    bitrate: null,
    fallback_reason: null,
  });
  assert.equal(valueAfter(qualityPolicy.video_encode_args, "-q:v"), "55");

  const warnings = [];
  const fallbackPolicy = resolveEncodingPolicy({
    cli: { quality: "standard", encoder: "videotoolbox" },
    capabilities: { ffmpegCommand: "policy-fixed-bitrate" },
    env: {},
    spawnSyncImpl: () => ({ status: 1 }),
    warn: (message) => warnings.push(message),
  });
  assert.deepEqual(fallbackPolicy.rate_control, {
    engine: "videotoolbox",
    mode: "fixed-bitrate",
    quality_value: null,
    bitrate: "8M",
    fallback_reason: "videotoolbox-quality-mode-unavailable",
  });
  assert.equal(valueAfter(fallbackPolicy.video_encode_args, "-b:v"), "8M");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\[encode\].*videotoolbox.*-q:v/u);
});

test("forced fixed bitrate is distinguished from a failed quality probe", () => {
  const warnings = [];
  const policy = resolveEncodingPolicy({
    cli: { quality: "standard", encoder: "videotoolbox" },
    capabilities: { ffmpegCommand: "policy-forced-fixed-bitrate" },
    env: { AKARI_EXPORT_FORCE_FIXED_BITRATE: "1" },
    spawnSyncImpl: () => { throw new Error("forced fallback must not probe"); },
    warn: (message) => warnings.push(message),
  });
  assert.equal(policy.rate_control.fallback_reason, "forced-fixed-bitrate");
  assert.equal(warnings.length, 1);
});

test("x264 policy records its effective CRF as quality rate control", () => {
  const policy = resolveEncodingPolicy({ cli: { quality: "standard", encoder: "x264" } });
  assert.deepEqual(policy.rate_control, {
    engine: "x264",
    mode: "quality",
    quality_value: 23,
    bitrate: null,
    fallback_reason: null,
  });
});
