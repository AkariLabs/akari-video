import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  audioArgsForCodec,
  buildVideoEncodeArgs,
  containerForCodec,
} from "../src/encode-preset.mjs";
import { buildVideoPreset } from "../src/plan.mjs";
import { assertCodecEngine, RefusalError, sha256PngDirectory, verifyArtifact } from "../src/render-cut.mjs";

test("containerForCodec stays identical to the shell container table", () => {
  const shellSettingsPath = fileURLToPath(new URL(
    "../../../apps/shell/extensions/akari-shell-strip/src/common/export-settings.ts",
    import.meta.url,
  ));
  const shellSource = readFileSync(shellSettingsPath, "utf8");
  for (const [codec, expected] of Object.entries({
    h264: { ext: "mp4", kind: "file" },
    hevc: { ext: "mp4", kind: "file" },
    prores422: { ext: "mov", kind: "file" },
    png: { ext: null, kind: "directory" },
  })) {
    assert.deepEqual(containerForCodec(codec), expected);
    const ext = expected.ext === null ? "null" : `'${expected.ext}' as const`;
    assert.match(shellSource, new RegExp(`${codec}: Object\\.freeze\\(\\{ ext: ${ext}, kind: '${expected.kind}' as const \\}\\)`));
  }
});

test("ProRes high software args are the fixed 422 HQ sequence", () => {
  assert.deepEqual(buildVideoEncodeArgs({ quality: "high", encoderChoice: { engine: "x264" }, codec: "prores422" }), [
    "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le",
    "-vendor", "apl0", "-qscale:v", "9",
  ]);
});

for (const [quality, qscale] of [["master", "5"], ["standard", "11"], ["light", "13"]]) {
  test(`ProRes ${quality} maps to qscale ${qscale}`, () => {
    const args = buildVideoEncodeArgs({ quality, encoderChoice: { engine: "x264" }, codec: "prores422" });
    assert.equal(args[args.indexOf("-qscale:v") + 1], qscale);
  });
}

test("ProRes VideoToolbox args select the HQ profile", () => {
  assert.deepEqual(buildVideoEncodeArgs({ quality: "high", encoderChoice: { engine: "videotoolbox" }, codec: "prores422" }), [
    "-c:v", "prores_videotoolbox", "-profile:v", "hq", "-allow_sw", "1", "-pix_fmt", "yuv422p10le",
  ]);
});

test("all VideoToolbox codec args keep software fallback enabled", () => {
  for (const codec of ["h264", "hevc", "prores422"]) {
    const args = buildVideoEncodeArgs({
      quality: "high",
      encoderChoice: { engine: "videotoolbox" },
      codec,
      profile: codec === "hevc" ? "main" : "high",
    });
    const allowSoftwareIndex = args.indexOf("-allow_sw");
    assert.notEqual(allowSoftwareIndex, -1, codec);
    assert.equal(args[allowSoftwareIndex + 1], "1", codec);
  }
});

test("PNG video and PCM audio args are fixed", () => {
  assert.deepEqual(buildVideoEncodeArgs({ quality: "high", encoderChoice: { engine: "x264" }, codec: "png" }), ["-c:v", "png"]);
  assert.deepEqual(audioArgsForCodec("png"), ["-c:a", "pcm_s16le", "-ar", "48000"]);
  assert.deepEqual(audioArgsForCodec("prores422"), ["-c:a", "pcm_s16le", "-ar", "48000"]);
  assert.deepEqual(audioArgsForCodec("h264"), ["-c:a", "aac", "-ar", "48000"]);
});

for (const codec of ["prores422", "png"]) {
  test(`${codec} refuses explicit GPU direct export`, () => {
    assert.throws(() => assertCodecEngine(codec, "gpu"), error => error instanceof RefusalError
      && error.message === "この形式は GPU 直結では出せません");
    assert.doesNotThrow(() => assertCodecEngine(codec, "auto"));
  });
}

test("ProRes and PNG plan presets carry their format-specific container and audio codec", () => {
  assert.deepEqual(buildVideoPreset({ codec: "prores422", width: 1920, height: 1080, fps: 30 }), {
    video_codec: "prores", profile: 3, pixel_format: "yuv422p10le", color_range: "tv",
    container: "mov", audio_codec: "pcm_s16le", width: 1920, height: 1080, fps: 30,
  });
  assert.deepEqual(buildVideoPreset({ codec: "png", width: 640, height: 360, fps: 30 }), {
    video_codec: "png", profile: null, pixel_format: "rgba", color_range: "tv",
    container: "directory", audio_codec: "pcm_s16le", width: 640, height: 360, fps: 30,
  });
});

test("verifyArtifact accepts ProRes 422 HQ, yuv422p10le, PCM, and bt709", () => {
  const metadata = {
    streams: [
      { codec_type: "video", codec_name: "prores", profile: "HQ", width: 320, height: 180, pix_fmt: "yuv422p10le", color_range: "tv", color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709", avg_frame_rate: "10/1" },
      { codec_type: "audio", codec_name: "pcm_s16le" },
    ],
    format: { duration: "1" },
  };
  const verification = verifyArtifact({
    outputPath: "out.mov",
    plan: { predicted_duration_seconds: 1, duration_tolerance_seconds: 0.2, preset: buildVideoPreset({ codec: "prores422", width: 320, height: 180, fps: 10 }), commands: { audio_mix: { hasNarration: false, hasAudibleAudio: false } } },
    edit: { cuts: [] },
    ffprobeCommand: "ffprobe-test",
    ffmpegCommand: "ffmpeg-test",
    spawnSyncImpl: (command, args) => {
      if (command === "ffprobe-test") return { status: 0, stdout: JSON.stringify(metadata), stderr: "" };
      if (args.includes("-progress")) return { status: 0, stdout: "frame=10\nprogress=end\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "mean_volume: -21.0 dB\nmax_volume: -3.0 dB\n" };
    },
  });
  assert.equal(verification.verdict, "pass", JSON.stringify(verification.findings));
});

function pngProbe(metadataByName) {
  return (_command, args) => {
    const name = basename(args.at(-1));
    return { status: 0, stdout: JSON.stringify(metadataByName[name]), stderr: "" };
  };
}

test("verifyArtifact accepts an exact PNG sequence and one-frame-tolerant WAV", async () => {
  const directory = await mkdtemp(join(tmpdir(), "akari-png-verify-"));
  try {
    for (const name of ["frame-00001.png", "frame-00002.png", "audio.wav"]) await writeFile(join(directory, name), name);
    const image = { streams: [{ codec_type: "video", codec_name: "png", width: 320, height: 180, pix_fmt: "rgba" }], format: {} };
    const audio = { streams: [{ codec_type: "audio", codec_name: "pcm_s16le", duration: "0.2" }], format: { duration: "0.2" } };
    const verification = verifyArtifact({
      outputPath: directory,
      plan: { predicted_duration_seconds: 0.2, duration_tolerance_seconds: 0.2, preset: buildVideoPreset({ codec: "png", width: 320, height: 180, fps: 10 }), commands: { audio_mix: {} } },
      ffprobeCommand: "ffprobe-test",
      spawnSyncImpl: pngProbe({ "frame-00001.png": image, "frame-00002.png": image, "audio.wav": audio }),
    });
    assert.equal(verification.verdict, "pass", JSON.stringify(verification.findings));
    assert.equal(verification.measured.frame_count, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verifyArtifact rejects a PNG sequence with a missing frame", async () => {
  const directory = await mkdtemp(join(tmpdir(), "akari-png-verify-"));
  try {
    await writeFile(join(directory, "frame-00001.png"), "png");
    await writeFile(join(directory, "audio.wav"), "wav");
    const image = { streams: [{ codec_type: "video", width: 320, height: 180 }], format: {} };
    const audio = { streams: [{ codec_type: "audio", codec_name: "pcm_s16le" }], format: { duration: "0.2" } };
    const verification = verifyArtifact({
      outputPath: directory,
      plan: { predicted_duration_seconds: 0.2, duration_tolerance_seconds: 0.2, preset: buildVideoPreset({ codec: "png", width: 320, height: 180, fps: 10 }), commands: { audio_mix: {} } },
      ffprobeCommand: "ffprobe-test",
      spawnSyncImpl: pngProbe({ "frame-00001.png": image, "audio.wav": audio }),
    });
    assert.equal(verification.verdict, "fail");
    assert.equal(verification.findings.find(finding => finding.check === "verify.frame-count")?.severity, "error");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PNG directory digest hashes only first, last, and audio digests in order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "akari-png-digest-"));
  try {
    const contents = new Map([
      ["frame-00001.png", "first"], ["frame-00002.png", "middle"],
      ["frame-00003.png", "last"], ["audio.wav", "audio"],
    ]);
    for (const [name, value] of contents) await writeFile(join(directory, name), value);
    const digest = value => createHash("sha256").update(value).digest("hex");
    const expected = digest([digest("first"), digest("last"), digest("audio")].join("\n"));
    assert.equal(await sha256PngDirectory(directory), expected);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
