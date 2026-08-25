import assert from "node:assert/strict";
import test from "node:test";

import {
  QUALITIES,
  checkAvailability,
  parseArguments,
  prepareExecution,
} from "../../../skills/analyze-footage/bin/person-matte/person-matte.mjs";

const installedModel = {
  model: "mobilenetv3",
  path: "/models/rvm_mobilenetv3_fp32.onnx",
  missing: false,
  fetchHint: "cd packages/matte-rvm && node scripts/fetch-models.mjs",
};

function successfulMediaProbe(command, args) {
  if (command === "/mock/ffmpeg" && args.includes("-encoders")) {
    return { status: 0, stdout: " V..... libvpx-vp9" };
  }
  return { status: 0, stdout: "" };
}

test("win32 maps every quality to RVM mobilenetv3 without building Vision", () => {
  let visionBuilds = 0;
  for (const quality of QUALITIES) {
    const prepared = prepareExecution(parseArguments(["--quality", quality]), {
      platform: "win32",
      resolveModel: () => installedModel,
      buildVisionHelper: () => {
        visionBuilds += 1;
        return null;
      },
    });
    assert.equal(prepared.quality, quality);
    assert.equal(prepared.engine, "rvm");
    assert.equal(prepared.model, "mobilenetv3");
    assert.equal(prepared.modelPath, installedModel.path);
  }
  assert.equal(visionBuilds, 0);
});

test("win32 availability probes only media tools and never swiftc", () => {
  const calls = [];
  const availability = checkAvailability({
    platform: "win32",
    runSync: (command, args) => {
      calls.push([command, args]);
      return successfulMediaProbe(command, args);
    },
    resolveFfmpegBin: () => "/mock/ffmpeg",
    resolveFfprobeBin: () => "/mock/ffprobe",
    resolveModel: () => installedModel,
  });
  assert.deepEqual(availability, { available: true });
  assert.deepEqual(calls, [
    ["/mock/ffmpeg", ["-version"]],
    ["/mock/ffprobe", ["-version"]],
    ["/mock/ffmpeg", ["-hide_banner", "-encoders"]],
  ]);
});

test("win32 availability requires the managed mobilenetv3 model", () => {
  const missingModel = {
    ...installedModel,
    missing: true,
    fetchHint: "FETCH_MNV3_MODEL",
  };
  const result = checkAvailability({
    platform: "win32",
    runSync: successfulMediaProbe,
    resolveFfmpegBin: () => "/mock/ffmpeg",
    resolveFfprobeBin: () => "/mock/ffprobe",
    resolveModel: () => missingModel,
  });
  assert.equal(result.available, false);
  assert.match(result.reason, /FETCH_MNV3_MODEL/);
});

test("availability converts a media-bin resolution error to the unavailable shape", () => {
  const ffmpegResult = checkAvailability({
    platform: "win32",
    resolveFfmpegBin: () => {
      throw new Error("media-bin could not resolve ffmpeg");
    },
  });
  assert.deepEqual(ffmpegResult, {
    available: false,
    reason: "media-bin could not resolve ffmpeg",
  });

  const ffprobeResult = checkAvailability({
    platform: "win32",
    resolveFfmpegBin: () => "/mock/ffmpeg",
    resolveFfprobeBin: () => {
      throw new Error("media-bin could not resolve ffprobe");
    },
  });
  assert.deepEqual(ffprobeResult, {
    available: false,
    reason: "media-bin could not resolve ffprobe",
  });
});

test("darwin keeps Vision for non-best, RVM for best, and does not require the RVM model", () => {
  let visionBuilds = 0;
  for (const quality of QUALITIES) {
    const prepared = prepareExecution(parseArguments(["--quality", quality]), {
      platform: "darwin",
      resolveModel: () => installedModel,
      buildVisionHelper: () => {
        visionBuilds += 1;
        return null;
      },
    });
    assert.equal(prepared.engine, quality === "best" ? "rvm" : "vision");
  }
  assert.equal(visionBuilds, 3);

  const calls = [];
  const availability = checkAvailability({
    platform: "darwin",
    runSync: (command, args) => {
      calls.push([command, args]);
      return successfulMediaProbe(command, args);
    },
    resolveFfmpegBin: () => "/mock/ffmpeg",
    resolveFfprobeBin: () => "/mock/ffprobe",
    resolveModel: () => ({ ...installedModel, missing: true }),
  });
  assert.deepEqual(availability, { available: true });
  assert.deepEqual(calls, [
    ["swiftc", ["-version"]],
    ["/mock/ffmpeg", ["-version"]],
    ["/mock/ffprobe", ["-version"]],
    ["/mock/ffmpeg", ["-hide_banner", "-encoders"]],
  ]);
});

test("linux remains unavailable", () => {
  const result = checkAvailability({
    platform: "linux",
    runSync: () => assert.fail("unsupported platforms must not probe tools"),
    resolveFfmpegBin: () => assert.fail("unsupported platforms must not resolve ffmpeg"),
    resolveFfprobeBin: () => assert.fail("unsupported platforms must not resolve ffprobe"),
  });
  assert.equal(result.available, false);
  assert.match(result.reason, /未対応/);
});
