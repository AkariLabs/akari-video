import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVideoEncodeArgs,
  isVideotoolboxAvailable,
  QUALITY_PRESETS,
  resetVideotoolboxCacheForTests,
  resolveEncoderChoice,
  resolveEncodingPolicy,
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

test("resolveEncodingPolicy keeps legacy null and records per-field CLI/edit precedence", () => {
  assert.equal(resolveEncodingPolicy({ edit: { output: {} } }), null);
  const policy = resolveEncodingPolicy({
    cli: { quality: "high" },
    edit: { output: { encoding: { quality: "light", encoder: "x264" } } },
    capabilities: { ffmpegCommand: "unused" },
  });
  assert.deepEqual(policy.requested.quality, { value: "high", origin: "cli" });
  assert.deepEqual(policy.requested.encoder, { value: "x264", origin: "edit" });
  assert.match(policy.video_encode_args.join(" "), /-crf 18/u);
});

test("only output.encoding opts in; an unknown root encoding field is never used as a policy backdoor", () => {
  assert.equal(resolveEncodingPolicy({
    edit: { encoding: { quality: "master", encoder: "x264" }, output: {} },
  }), null);
  const policy = resolveEncodingPolicy({
    edit: {
      encoding: { quality: "light", encoder: "videotoolbox" },
      output: { encoding: { quality: "master", encoder: "x264" } },
    },
  });
  assert.deepEqual(policy.requested, {
    quality: { value: "master", origin: "edit" },
    encoder: { value: "x264", origin: "edit" },
  });
  assert.deepEqual(policy.video_encode_args, ["-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "15", "-color_range", "tv"]);
});

test("master is x264 CRF15 slow and rejects explicit auto/videotoolbox", () => {
  const policy = resolveEncodingPolicy({ edit: { output: { encoding: { quality: "master" } } } });
  assert.deepEqual(policy.effective.encoder, { value: "x264", origin: "master-required" });
  assert.deepEqual(policy.video_encode_args, ["-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "15", "-color_range", "tv"]);
  for (const encoder of ["auto", "videotoolbox"]) {
    assert.throws(() => resolveEncodingPolicy({ cli: { quality: "master", encoder }, edit: { output: {} } }), /requires x264/u);
  }
});

test("buildVideoEncodeArgs standard quality matches libx264's own defaults (crf 23 / preset medium)", () => {
  assert.equal(QUALITY_PRESETS.standard.crf, 23);
  const args = buildVideoEncodeArgs({ quality: "standard", encoderChoice: null });
  assert.deepEqual(args, ["-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "23", "-color_range", "tv"]);
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
  assert.deepEqual(args, ["-c:v", "h264_videotoolbox", "-allow_sw", "1", "-b:v", "12M", "-profile:v", "high", "-color_range", "tv"]);
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
  assert.throws(() => resolveEncoderChoice({ requested: "future-encoder" }), RangeError);
});

test("resolveEncoderChoice auto picks videotoolbox when the encoder list and smoke test both pass", () => {
  resetVideotoolboxCacheForTests();
  const choice = resolveEncoderChoice({
    requested: "auto",
    ffmpegCommand: "fake-ffmpeg-auto-1",
    env: {},
    platform: "darwin",
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
    platform: "darwin",
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
    platform: "darwin",
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

test("HEVC software presets use libx265 with the H.264 CRF tiers and hvc1 tagging", () => {
  for (const [quality, crf] of [["master", 15], ["high", 18], ["standard", 23], ["light", 26]]) {
    const args = buildVideoEncodeArgs({ quality, encoderChoice: { engine: "x264" }, profile: "main", codec: "hevc" });
    assert.equal(args[args.indexOf("-c:v") + 1], "libx265");
    assert.equal(args[args.indexOf("-crf") + 1], String(crf));
    assert.equal(args[args.indexOf("-profile:v") + 1], "main");
    assert.equal(args[args.indexOf("-x265-params") + 1], "log-level=error");
    assert.equal(args[args.indexOf("-tag:v") + 1], "hvc1");
  }
});

test("HEVC hardware table maps all engines and VideoToolbox bitrate to 0.6x", () => {
  for (const [engine, ffmpegEncoder] of [
    ["videotoolbox", "hevc_videotoolbox"], ["nvenc", "hevc_nvenc"], ["qsv", "hevc_qsv"],
    ["amf", "hevc_amf"], ["mf", "hevc_mf"],
  ]) {
    const args = buildVideoEncodeArgs({ quality: "high", encoderChoice: { engine }, profile: "main", codec: "hevc" });
    assert.equal(args[args.indexOf("-c:v") + 1], ffmpegEncoder);
    assert.equal(args[args.indexOf("-tag:v") + 1], "hvc1");
    if (engine === "videotoolbox") assert.equal(args[args.indexOf("-b:v") + 1], "7.2M");
  }
});
