import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVideoEncodeArgs,
  isVideotoolboxAvailable,
  QUALITY_PRESETS,
  resetVideotoolboxCacheForTests,
  resolveEncoderChoice,
} from "../src/encode-preset.mjs";

function fakeSpawnSync({ hasEncoder = true, smokeOk = true } = {}) {
  return (command, args) => {
    if (args.includes("-encoders")) {
      return {
        status: 0,
        stdout: hasEncoder
          ? " V..... h264_videotoolbox      VideoToolbox H.264 Encoder\n"
          : " V..... libx264                libx264 H.264\n",
      };
    }
    // 1-frame smoke test invocation.
    return { status: smokeOk ? 0 : 1 };
  };
}

test("buildVideoEncodeArgs returns null (keep legacy literal args) when neither quality nor encoder is requested", () => {
  assert.equal(buildVideoEncodeArgs({}), null);
  assert.equal(buildVideoEncodeArgs({ quality: undefined, encoderChoice: null }), null);
});

test("buildVideoEncodeArgs standard quality matches libx264's own defaults (crf 23 / preset medium)", () => {
  assert.equal(QUALITY_PRESETS.standard.crf, 23);
  const args = buildVideoEncodeArgs({ quality: "standard", encoderChoice: null });
  assert.deepEqual(args, ["-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "23"]);
});

test("buildVideoEncodeArgs high/light quality map to crf 18/26", () => {
  assert.equal(QUALITY_PRESETS.high.crf, 18);
  assert.equal(QUALITY_PRESETS.light.crf, 26);
  const high = buildVideoEncodeArgs({ quality: "high", encoderChoice: null });
  const light = buildVideoEncodeArgs({ quality: "light", encoderChoice: null });
  assert.match(high.join(" "), /-crf 18/);
  assert.match(light.join(" "), /-crf 26/);
});

test("buildVideoEncodeArgs videotoolbox engine uses bitrate instead of crf/preset", () => {
  const args = buildVideoEncodeArgs({ quality: "high", encoderChoice: { engine: "videotoolbox" } });
  assert.deepEqual(args, ["-c:v", "h264_videotoolbox", "-allow_sw", "1", "-b:v", "12M", "-profile:v", "high"]);
  assert.ok(!args.includes("-crf"));
  assert.ok(!args.includes("-preset"));
});

test("buildVideoEncodeArgs omits -profile:v when profile is falsy", () => {
  const args = buildVideoEncodeArgs({ quality: "standard", encoderChoice: null, profile: null });
  assert.ok(!args.includes("-profile:v"));
});

test("resolveEncoderChoice returns null (no override) when requested is undefined/null", () => {
  assert.equal(resolveEncoderChoice({ requested: undefined }), null);
  assert.equal(resolveEncoderChoice({ requested: null }), null);
});

test("resolveEncoderChoice x264/videotoolbox force the engine without probing ffmpeg", () => {
  const spawnSyncImpl = () => {
    throw new Error("must not probe ffmpeg for an explicit engine choice");
  };
  assert.deepEqual(resolveEncoderChoice({ requested: "x264", spawnSyncImpl }), { engine: "x264" });
  assert.deepEqual(resolveEncoderChoice({ requested: "videotoolbox", spawnSyncImpl }), { engine: "videotoolbox" });
});

test("resolveEncoderChoice rejects an unknown value", () => {
  assert.throws(() => resolveEncoderChoice({ requested: "nvenc" }), RangeError);
});

test("resolveEncoderChoice auto picks videotoolbox when the encoder list and smoke test both pass", () => {
  resetVideotoolboxCacheForTests();
  const choice = resolveEncoderChoice({
    requested: "auto",
    ffmpegCommand: "fake-ffmpeg-auto-1",
    env: {},
    spawnSyncImpl: fakeSpawnSync({ hasEncoder: true, smokeOk: true }),
  });
  assert.deepEqual(choice, { engine: "videotoolbox" });
});

test("resolveEncoderChoice auto falls back to x264 when the encoder is not listed", () => {
  resetVideotoolboxCacheForTests();
  const choice = resolveEncoderChoice({
    requested: "auto",
    ffmpegCommand: "fake-ffmpeg-auto-2",
    env: {},
    spawnSyncImpl: fakeSpawnSync({ hasEncoder: false }),
  });
  assert.deepEqual(choice, { engine: "x264" });
});

test("resolveEncoderChoice auto falls back to x264 when the smoke test fails despite being listed", () => {
  resetVideotoolboxCacheForTests();
  const choice = resolveEncoderChoice({
    requested: "auto",
    ffmpegCommand: "fake-ffmpeg-auto-3",
    env: {},
    spawnSyncImpl: fakeSpawnSync({ hasEncoder: true, smokeOk: false }),
  });
  assert.deepEqual(choice, { engine: "x264" });
});

test("isVideotoolboxAvailable honors AKARI_EXPORT_FORCE_X264=1 unconditionally, without probing", () => {
  resetVideotoolboxCacheForTests();
  const spawnSyncImpl = () => {
    throw new Error("must not probe ffmpeg when force-x264 is set");
  };
  assert.equal(
    isVideotoolboxAvailable({ ffmpegCommand: "fake-ffmpeg-force", env: { AKARI_EXPORT_FORCE_X264: "1" }, spawnSyncImpl }),
    false,
  );
});

test("isVideotoolboxAvailable caches its result per ffmpeg binary (process-wide, one probe)", () => {
  resetVideotoolboxCacheForTests();
  let calls = 0;
  const spawnSyncImpl = (...args) => {
    calls += 1;
    return fakeSpawnSync({ hasEncoder: true, smokeOk: true })(...args);
  };
  const ffmpegCommand = "fake-ffmpeg-cache";
  const first = isVideotoolboxAvailable({ ffmpegCommand, env: {}, spawnSyncImpl });
  const callsAfterFirst = calls;
  const second = isVideotoolboxAvailable({ ffmpegCommand, env: {}, spawnSyncImpl });
  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(calls, callsAfterFirst, "second call must hit the cache, not spawn again");
});
