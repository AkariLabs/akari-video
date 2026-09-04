import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVideoEncodeArgs,
  resetEncoderProbeCacheForTests,
  resolveEncodingPolicy,
} from "../src/encode-preset.mjs";

const COLOR_TAGS = [
  ["-colorspace", "bt709"],
  ["-color_primaries", "bt709"],
  ["-color_trc", "bt709"],
  ["-color_range", "tv"],
];

const COLOR_TAG_BSF = {
  h264: "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1",
  hevc: "hevc_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1",
};

const CODEC_ENGINES = {
  h264: ["videotoolbox", "x264", "nvenc", "qsv", "amf", "mf"],
  hevc: ["videotoolbox", "x264", "nvenc", "qsv", "amf", "mf"],
};

function availableEncoderSpawn(_command, args) {
  if (args.includes("-encoders")) {
    return {
      status: 0,
      stdout: [
        " V..... h264_nvenc encoder",
        " V..... h264_qsv encoder",
        " V..... h264_amf encoder",
        " V..... h264_mf encoder",
        " V..... hevc_nvenc encoder",
        " V..... hevc_qsv encoder",
        " V..... hevc_amf encoder",
        " V..... hevc_mf encoder",
      ].join("\n"),
    };
  }
  return { status: 0, stdout: "" };
}

function assertColorTags(args, codec, label) {
  for (const [option, value] of COLOR_TAGS) {
    assert.equal(args.filter((arg) => arg === option).length, 1, `${label}: ${option} count`);
    assert.equal(args[args.indexOf(option) + 1], value, `${label}: ${option} value`);
  }
  assert.equal(args.filter((arg) => arg === "-bsf:v").length, 1, `${label}: -bsf:v count`);
  assert.equal(args[args.indexOf("-bsf:v") + 1], COLOR_TAG_BSF[codec], `${label}: -bsf:v value`);
  if (codec === "hevc") {
    assert.equal(args.indexOf("-bsf:v") + 2, args.indexOf("-tag:v"), `${label}: metadata filter precedes hvc1 tag`);
  } else {
    assert.equal(args.indexOf("-bsf:v"), args.length - 2, `${label}: metadata filter is the final option`);
  }
}

test("all H.264 and HEVC encoder branches emit the complete bt709 tags and metadata filter", () => {
  resetEncoderProbeCacheForTests();
  for (const [codec, engines] of Object.entries(CODEC_ENGINES)) {
    for (const engine of engines) {
      const profile = codec === "hevc" ? "main" : "high";
      const directArgs = buildVideoEncodeArgs({
        quality: "standard",
        encoderChoice: { engine },
        profile,
        codec,
      });
      const policy = resolveEncodingPolicy({
        cli: { quality: "standard", encoder: engine, codec },
        edit: { output: {} },
        capabilities: { ffmpegCommand: "fake-ffmpeg-color-tags" },
        env: {},
        platform: engine === "videotoolbox" ? "darwin" : "win32",
        spawnSyncImpl: availableEncoderSpawn,
      });
      const label = `${codec}/${codec === "hevc" && engine === "x264" ? "x265" : engine}`;
      assert.deepEqual(policy.video_encode_args, directArgs, `${label}: policy and builder args`);
      assertColorTags(policy.video_encode_args, codec, label);
    }
  }
});

test("ProRes and PNG branches do not receive H.264/HEVC color arguments", () => {
  for (const [codec, engine] of [["prores422", "x264"], ["prores422", "videotoolbox"], ["png", "x264"]]) {
    const args = buildVideoEncodeArgs({ quality: "standard", encoderChoice: { engine }, codec });
    for (const [option] of COLOR_TAGS) {
      assert.equal(args.includes(option), false, `${codec}/${engine}: ${option}`);
    }
    assert.equal(args.includes("-bsf:v"), false, `${codec}/${engine}: -bsf:v`);
  }
});
