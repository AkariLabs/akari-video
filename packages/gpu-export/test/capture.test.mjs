import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { captureFramesWithGpu } from "../src/index.mjs";
import { buildGpuElectronArguments } from "../src/runner.mjs";

test("GPU capture launches one page runtime and carries frame/readback flags", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpu-capture-api-"));
  try {
    let launchCount = 0;
    let launched;
    const eligibility = { eligible: true, entries: [] };
    const result = await captureFramesWithGpu({
      projectRoot: root,
      editPath: join(root, "edit-v2.json"),
      outputDirectory: join(root, "frames"),
      frameNumbers: [180, 0, 90],
      fps: 30,
      width: 320,
      height: 180,
      duration: 7,
      frames: 210,
      eligibility,
      launcher: { tier: 2, executable: "/electron" },
      launcherRunner: async (_launcher, options) => {
        launchCount += 1;
        launched = options;
        await writeFile(options.out, JSON.stringify({
          status: "completed",
          operation: "capture",
          verify: { mode: "frame-engine-readback", matched: true, frameNumbers: [0, 90, 180] },
          outputs: [0, 90, 180].map((frameNumber) => ({ frameNumber, path: join(options.captureOutputDirectory, `frame-${frameNumber}.png`) })),
          gpu: { uploadPath: "direct" },
          eligibility,
          elapsedMs: 15,
        }));
      },
    });
    assert.equal(launchCount, 1);
    assert.deepEqual(launched.captureFrames, [0, 90, 180]);
    assert.equal(launched.editPath, join(root, "edit-v2.json"));
    assert.equal(result.receipt.verify.mode, "frame-engine-readback");

    const args = buildGpuElectronArguments({ tier: 2 }, launched);
    assert.equal(args[args.indexOf("--capture-frames") + 1], "0,90,180");
    assert.equal(args[args.indexOf("--capture-output-dir") + 1], join(root, "frames"));
    assert.equal(args[args.indexOf("--edit") + 1], join(root, "edit-v2.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GPU capture readback is isolated from export and delegates to frame-engine readbackFrame", async () => {
  const runtime = await readFile(new URL("../src/page-runtime.js", import.meta.url), "utf8");
  const readback = await readFile(new URL("../src/verify-readback.js", import.meta.url), "utf8");
  assert.match(runtime, /captureMode[\s\S]+captureFrame\(FE, frame, finalCanvas\)/u);
  assert.doesNotMatch(runtime, /\.readPixels\s*\(/u);
  assert.match(readback, /FE\.readbackFrame/u);
});

test("GPU dump readback is verification-only and immediately precedes encoder input", async () => {
  const runtime = await readFile(new URL("../src/page-runtime.js", import.meta.url), "utf8");
  const dumpBranch = runtime.slice(
    runtime.indexOf("if (dumpFrameNumbers.has(frameNumber))"),
    runtime.indexOf("stages.encode.push", runtime.indexOf("if (dumpFrameNumbers.has(frameNumber))")),
  );
  assert.match(dumpBranch, /captureFrame\(FE, frame, finalCanvas\)/u);
  assert.match(dumpBranch, /bridge\.writeDumpFrame/u);
  assert.ok(dumpBranch.indexOf("writeDumpFrame") < dumpBranch.indexOf("encoder.encode"));
  assert.match(runtime, /if \(config\.verifyFrames \|\| captureMode \|\| dumpFrameNumbers\.size > 0\)/u);
});
