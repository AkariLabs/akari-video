import assert from "node:assert/strict";
import test from "node:test";

import {
  checkAvailability,
  parseArguments,
  prepareExecution,
} from "../person-matte/person-matte.mjs";

function successfulMediaProbe(command, args) {
  if (command === "/mock/ffmpeg" && args.includes("-encoders")) {
    return { status: 0, stdout: " V..... libvpx-vp9" };
  }
  return { status: 0, stdout: "" };
}

test("darwin availability requires a Vision helper source or built binary", () => {
  const result = checkAvailability({
    platform: "darwin",
    fileExists: () => false,
    runSync: () => assert.fail("missing helper must stop before probing tools"),
    resolveFfmpegBin: () => assert.fail("missing helper must stop before resolving tools"),
    resolveFfprobeBin: () => assert.fail("missing helper must stop before resolving tools"),
  });
  assert.equal(result.available, false);
  assert.match(result.reason, /Vision.*ヘルパー/u);
});

test("win32 availability reports unavailable when the RVM resolver was not loaded", () => {
  const result = checkAvailability({
    platform: "win32",
    runSync: successfulMediaProbe,
    resolveFfmpegBin: () => "/mock/ffmpeg",
    resolveFfprobeBin: () => "/mock/ffprobe",
  });
  assert.equal(result.available, false);
  assert.match(result.reason, /RVM.*入っていない/u);
});

test("prepareExecution needs an RVM resolver only on an RVM engine", () => {
  const vision = prepareExecution(parseArguments([]), {
    platform: "darwin",
    buildVisionHelper: () => null,
  });
  assert.equal(vision.engine, "vision");

  assert.throws(
    () => prepareExecution(parseArguments(["--quality", "best"]), { platform: "darwin" }),
    /RVM.*入っていない/u,
  );
});
