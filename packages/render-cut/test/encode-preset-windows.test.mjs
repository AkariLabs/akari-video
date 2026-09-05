import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVideoEncodeArgs,
  ENCODER_CHOICES,
  isHardwareEncoderAvailable,
  QUALITY_PRESETS,
  resetEncoderProbeCacheForTests,
  resolveEncoderChoice,
  resolveEncodingPolicy,
} from "../src/encode-preset.mjs";

const FFMPEG_ENCODERS = {
  videotoolbox: "h264_videotoolbox",
  nvenc: "h264_nvenc",
  qsv: "h264_qsv",
  amf: "h264_amf",
  mf: "h264_mf",
};

const H264_COLOR_TAG_BSF = ["-bsf:v", "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1"];

function probeSpawn({ listed = [], smokePasses = listed } = {}) {
  const calls = [];
  const spawnSyncImpl = (command, args) => {
    calls.push({ command, args });
    if (args.includes("-encoders")) {
      return {
        status: 0,
        stdout: `${listed.map((encoder) => ` V..... ${FFMPEG_ENCODERS[encoder]} encoder`).join("\n")}\n`,
      };
    }
    const ffmpegEncoder = args[args.indexOf("-c:v") + 1];
    const encoder = Object.entries(FFMPEG_ENCODERS).find(([, value]) => value === ffmpegEncoder)?.[0];
    return { status: smokePasses.includes(encoder) ? 0 : 1, stdout: "" };
  };
  return { calls, spawnSyncImpl };
}

function captureArgs(quality, engine) {
  try {
    return buildVideoEncodeArgs({ quality, encoderChoice: { engine } });
  } catch (error) {
    return { error: error.message };
  }
}

test("encoder x quality argument snapshots preserve legacy bytes and fix every hardware mapping", () => {
  assert.deepEqual(ENCODER_CHOICES, ["auto", "videotoolbox", "nvenc", "qsv", "amf", "mf", "x264"]);
  const actual = Object.fromEntries(
    ["x264", "videotoolbox", "nvenc", "qsv", "amf", "mf"].map((engine) => [
      engine,
      Object.fromEntries(["master", "high", "standard", "light"].map((quality) => [quality, captureArgs(quality, engine)])),
    ]),
  );
  assert.deepEqual(actual, {
    x264: {
      master: ["-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "15", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
      high: ["-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "18", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
      standard: ["-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "23", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
      light: ["-c:v", "libx264", "-profile:v", "high", "-preset", "fast", "-crf", "26", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
    },
    videotoolbox: {
      master: { error: "master quality does not support videotoolbox" },
      high: ["-c:v", "h264_videotoolbox", "-allow_sw", "1", "-b:v", "12M", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
      standard: ["-c:v", "h264_videotoolbox", "-allow_sw", "1", "-b:v", "8M", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
      light: ["-c:v", "h264_videotoolbox", "-allow_sw", "1", "-b:v", "5M", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
    },
    nvenc: {
      master: { error: "master quality does not support nvenc; it requires x264" },
      high: ["-c:v", "h264_nvenc", "-rc", "vbr", "-cq", "18", "-b:v", "0", "-preset", "p6", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
      standard: ["-c:v", "h264_nvenc", "-rc", "vbr", "-cq", "23", "-b:v", "0", "-preset", "p5", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
      light: ["-c:v", "h264_nvenc", "-rc", "vbr", "-cq", "26", "-b:v", "0", "-preset", "p4", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
    },
    qsv: {
      master: { error: "master quality does not support qsv; it requires x264" },
      high: ["-c:v", "h264_qsv", "-global_quality", "18", "-preset", "slow", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
      standard: ["-c:v", "h264_qsv", "-global_quality", "23", "-preset", "medium", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
      light: ["-c:v", "h264_qsv", "-global_quality", "26", "-preset", "fast", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
    },
    amf: {
      master: { error: "master quality does not support amf; it requires x264" },
      high: ["-c:v", "h264_amf", "-rc", "cqp", "-qp_i", "18", "-qp_p", "18", "-quality", "quality", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
      standard: ["-c:v", "h264_amf", "-rc", "cqp", "-qp_i", "23", "-qp_p", "23", "-quality", "balanced", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
      light: ["-c:v", "h264_amf", "-rc", "cqp", "-qp_i", "26", "-qp_p", "26", "-quality", "speed", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
    },
    mf: {
      master: { error: "master quality does not support mf; it requires x264" },
      high: ["-c:v", "h264_mf", "-rate_control", "quality", "-quality", "85", "-hw_encoding", "1", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
      standard: ["-c:v", "h264_mf", "-rate_control", "quality", "-quality", "70", "-hw_encoding", "1", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
      light: ["-c:v", "h264_mf", "-rate_control", "quality", "-quality", "55", "-hw_encoding", "1", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", ...H264_COLOR_TAG_BSF],
    },
  });
  assert.equal(buildVideoEncodeArgs({}), null);
  assert.deepEqual(QUALITY_PRESETS.master, {
    crf: 15,
    preset: "slow",
    videotoolboxBitrate: null,
    nvencPreset: null,
    qsvPreset: null,
    amfQuality: null,
    mfQuality: null,
    videotoolboxQuality: null,
    videotoolboxHevcQuality: null,
    webcodecsQuantizer: null,
    webcodecsHevcQuantizer: null,
  });
});

test("auto resolution is platform-specific and preserves the Windows priority order", () => {
  const cases = [
    { name: "darwin-videotoolbox", platform: "darwin", listed: ["videotoolbox"], expected: "videotoolbox" },
    { name: "darwin-none", platform: "darwin", listed: [], expected: "x264" },
    { name: "windows-nvenc", platform: "win32", listed: ["nvenc"], expected: "nvenc" },
    { name: "windows-qsv", platform: "win32", listed: ["qsv"], expected: "qsv" },
    { name: "windows-amf", platform: "win32", listed: ["amf"], expected: "amf" },
    { name: "windows-mf", platform: "win32", listed: ["mf"], expected: "mf" },
    { name: "windows-none", platform: "win32", listed: [], expected: "x264" },
    { name: "windows-nvenc-before-qsv", platform: "win32", listed: ["nvenc", "qsv"], expected: "nvenc" },
  ];
  for (const fixture of cases) {
    resetEncoderProbeCacheForTests();
    const { spawnSyncImpl } = probeSpawn({ listed: fixture.listed });
    assert.deepEqual(resolveEncoderChoice({
      requested: "auto",
      ffmpegCommand: `fake-${fixture.name}`,
      env: {},
      platform: fixture.platform,
      spawnSyncImpl,
    }), { engine: fixture.expected }, fixture.name);
  }

  resetEncoderProbeCacheForTests();
  assert.deepEqual(resolveEncoderChoice({
    requested: "auto",
    platform: "linux",
    spawnSyncImpl: () => { throw new Error("Linux auto must not probe"); },
  }), { engine: "x264" });
});

test("resolveEncodingPolicy forwards the injected platform to Windows auto resolution", () => {
  resetEncoderProbeCacheForTests();
  const { spawnSyncImpl } = probeSpawn({ listed: ["qsv"] });
  const policy = resolveEncodingPolicy({
    cli: { encoder: "auto" },
    edit: { output: {} },
    capabilities: { ffmpegCommand: "fake-policy-win32" },
    env: {},
    platform: "win32",
    spawnSyncImpl,
  });
  assert.deepEqual(policy.effective.encoder, { value: "qsv", origin: "capability-resolution" });
});

test("resolveEncodingPolicy produces the complete NVENC args through Windows auto", () => {
  resetEncoderProbeCacheForTests();
  const { spawnSyncImpl } = probeSpawn({ listed: ["nvenc"] });
  const policy = resolveEncodingPolicy({
    cli: { quality: "high", encoder: "auto" },
    edit: { output: {} },
    capabilities: { ffmpegCommand: "fake-policy-nvenc" },
    env: {},
    platform: "win32",
    spawnSyncImpl,
  });
  assert.deepEqual(policy.video_encode_args, [
    "-c:v", "h264_nvenc",
    "-rc", "vbr",
    "-cq", "18",
    "-b:v", "0",
    "-preset", "p6",
    "-profile:v", "high",
    "-colorspace", "bt709",
    "-color_primaries", "bt709",
    "-color_trc", "bt709",
    "-color_range", "tv",
    ...H264_COLOR_TAG_BSF,
  ]);
});

test("master rejects every explicit hardware encoder before probing", () => {
  for (const encoder of ["videotoolbox", "nvenc", "qsv", "amf", "mf"]) {
    assert.throws(
      () => resolveEncodingPolicy({
        cli: { quality: "master", encoder },
        edit: { output: {} },
        spawnSyncImpl: () => { throw new Error("master rejection must not probe"); },
        platform: "win32",
      }),
      /requires x264/u,
    );
  }
});

test("an encoder listed by ffmpeg is rejected when its smoke test fails", () => {
  for (const encoder of ["videotoolbox", "nvenc", "qsv", "amf", "mf"]) {
    resetEncoderProbeCacheForTests();
    const { spawnSyncImpl } = probeSpawn({ listed: [encoder], smokePasses: [] });
    assert.equal(isHardwareEncoderAvailable({
      encoder,
      ffmpegCommand: `fake-listed-smoke-fail-${encoder}`,
      env: {},
      platform: encoder === "videotoolbox" ? "darwin" : "win32",
      spawnSyncImpl,
    }), false, encoder);
  }
});

test("AKARI_EXPORT_FORCE_X264 disables every hardware encoder without spawning", () => {
  resetEncoderProbeCacheForTests();
  let spawnCount = 0;
  for (const encoder of ["videotoolbox", "nvenc", "qsv", "amf", "mf"]) {
    assert.equal(isHardwareEncoderAvailable({
      encoder,
      env: { AKARI_EXPORT_FORCE_X264: "1" },
      platform: encoder === "videotoolbox" ? "darwin" : "win32",
      spawnSyncImpl: () => {
        spawnCount += 1;
        return { status: 0, stdout: "" };
      },
    }), false);
  }
  assert.equal(spawnCount, 0);
});

test("AKARI_EXPORT_FORCE_X264 makes explicit Windows hardware choices fail closed", () => {
  const env = { AKARI_EXPORT_FORCE_X264: "1" };
  let spawnCount = 0;
  const spawnSyncImpl = () => {
    spawnCount += 1;
    return { status: 0, stdout: "" };
  };
  for (const encoder of ["nvenc", "qsv", "amf", "mf"]) {
    assert.throws(
      () => resolveEncoderChoice({ requested: encoder, env, platform: "win32", spawnSyncImpl }),
      (error) => error.message.includes(encoder)
        && error.message.includes("--encoder auto")
        && error.message.includes("--encoder x264"),
    );
  }
  assert.deepEqual(resolveEncoderChoice({ requested: "x264", env, platform: "win32", spawnSyncImpl }), { engine: "x264" });
  assert.deepEqual(resolveEncoderChoice({ requested: "videotoolbox", env, platform: "win32", spawnSyncImpl }), { engine: "videotoolbox" });
  assert.equal(spawnCount, 0);
});

test("explicit Windows hardware choices fail closed while explicit x264/videotoolbox never probe", () => {
  for (const encoder of ["nvenc", "qsv", "amf", "mf"]) {
    resetEncoderProbeCacheForTests();
    const { spawnSyncImpl } = probeSpawn({ listed: [encoder], smokePasses: [] });
    assert.throws(
      () => resolveEncoderChoice({
        requested: encoder,
        ffmpegCommand: `fake-explicit-${encoder}`,
        env: {},
        platform: "win32",
        spawnSyncImpl,
      }),
      (error) => error.message.includes(encoder)
        && error.message.includes("--encoder auto")
        && error.message.includes("--encoder x264"),
    );
  }
  const spawnSyncImpl = () => { throw new Error("explicit legacy engines must not probe"); };
  assert.deepEqual(resolveEncoderChoice({ requested: "x264", spawnSyncImpl }), { engine: "x264" });
  assert.deepEqual(resolveEncoderChoice({ requested: "videotoolbox", spawnSyncImpl }), { engine: "videotoolbox" });
});

test("new hardware smoke tests use 256x144 while VideoToolbox keeps its legacy 64x64 probe", () => {
  for (const encoder of ["nvenc", "qsv", "amf", "mf"]) {
    resetEncoderProbeCacheForTests();
    const { calls, spawnSyncImpl } = probeSpawn({ listed: [encoder] });
    assert.equal(isHardwareEncoderAvailable({
      encoder,
      ffmpegCommand: `fake-dimensions-${encoder}`,
      env: {},
      platform: "win32",
      spawnSyncImpl,
    }), true);
    const smokeArgs = calls.find(({ args }) => args.includes("-frames:v")).args;
    const source = smokeArgs[smokeArgs.indexOf("-i") + 1];
    const [, width, height] = source.match(/s=(\d+)x(\d+)/u);
    assert.ok(Number(width) >= 256 && Number(height) >= 144, `${encoder}: ${source}`);
  }

  resetEncoderProbeCacheForTests();
  const { calls, spawnSyncImpl } = probeSpawn({ listed: ["videotoolbox"] });
  assert.equal(isHardwareEncoderAvailable({
    encoder: "videotoolbox",
    ffmpegCommand: "fake-dimensions-videotoolbox",
    env: {},
    platform: "darwin",
    spawnSyncImpl,
  }), true);
  const smokeArgs = calls.find(({ args }) => args.includes("-frames:v")).args;
  assert.equal(smokeArgs[smokeArgs.indexOf("-i") + 1], "color=c=black:s=64x64:r=24");
});

test("hardware availability cache is keyed by ffmpeg binary and encoder name", () => {
  resetEncoderProbeCacheForTests();
  const { calls, spawnSyncImpl } = probeSpawn({ listed: ["nvenc", "qsv"] });
  for (const encoder of ["nvenc", "qsv", "nvenc", "qsv"]) {
    assert.equal(isHardwareEncoderAvailable({
      encoder,
      ffmpegCommand: "fake-shared-binary",
      env: {},
      platform: "win32",
      spawnSyncImpl,
    }), true);
  }
  assert.equal(calls.length, 4, "each encoder probes list+smoke once, then uses its own cache entry");
});
