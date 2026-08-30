import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { captureFramesWithOsr } from "../src/index.mjs";
import { encodeBgraPng, encodeRgbaPng } from "../src/png.mjs";

test("OSR capture launches one page session for every requested frame and preserves stamp receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-capture-api-"));
  try {
    let launchCount = 0;
    let launched;
    const result = await captureFramesWithOsr({
      projectRoot: root,
      editPath: join(root, "alternate-edit.json"),
      outputDirectory: join(root, "frames"),
      frameNumbers: [90, 0, 90],
      fps: 30,
      width: 320,
      height: 180,
      duration: 4,
      frames: 120,
      launcher: { tier: 2, executable: "/electron" },
      launcherRunner: async (_launcher, options) => {
        launchCount += 1;
        launched = options;
        const outputs = [0, 90].map((frameNumber) => ({
          frameNumber,
          path: join(options.extraArgs.at(-1), `frame-${frameNumber}.png`),
        }));
        await writeFile(options.out, JSON.stringify({
          status: "completed",
          operation: "capture",
          verify: { mode: "stamp", matched: true, frames: [0, 90].map((frameNumber) => ({ frameNumber, matched: true })) },
          outputs,
          page: { layers: ["engine-canvas", "dom-captions"] },
          elapsedMs: 12,
        }));
      },
    });
    assert.equal(launchCount, 1);
    assert.equal(launched.extraArgs[launched.extraArgs.indexOf("--capture-frames") + 1], "0,90");
    assert.equal(launched.extraArgs[launched.extraArgs.indexOf("--edit") + 1], join(root, "alternate-edit.json"));
    assert.equal(result.receipt.verify.matched, true);
    assert.deepEqual(result.run.outputs.map((entry) => entry.frameNumber), [0, 90]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capture PNG encoder writes deterministic RGBA and BGRA PNGs", async () => {
  const rgba = Uint8Array.from([255, 0, 0, 0, 0, 255, 0, 127]);
  const bgra = Uint8Array.from([0, 0, 255, 255, 0, 255, 0, 1]);
  const first = encodeRgbaPng(rgba, 2, 1);
  const second = encodeBgraPng(bgra, 2, 1);
  assert.deepEqual(first, second);
  assert.equal(first.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(first.readUInt32BE(16), 2);
  assert.equal(first.readUInt32BE(20), 1);
  assert.equal(first[24], 8);
  assert.equal(first[25], 2);
});

test("OSR capture is fail-closed when no v2 Electron launcher is available", async () => {
  await assert.rejects(captureFramesWithOsr({
    projectRoot: "/project",
    outputDirectory: "/unused",
    frameNumbers: [0],
    fps: 30,
    width: 16,
    height: 16,
    duration: 1,
    launcher: { tier: 3, reason: "missing" },
  }), /OSR capture unavailable: missing/u);
});
