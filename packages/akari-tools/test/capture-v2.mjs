import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { encodeRgbaPng } from "../../osr-export/src/png.mjs";
import { generateCaptureFixture } from "../../render-cut/test/fixtures/capture-parity/generate.mjs";
import { runCapture } from "../src/capture/run.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixtureRoot = join(repoRoot, "packages", "render-cut", "test", "fixtures", "capture-parity");

test("capture v2 manifest records the resolved OSR renderer and one multi-frame receipt", async () => {
  const project = await mkdtemp(join(tmpdir(), "capture-v2-manifest-"));
  try {
    await copyFile(join(fixtureRoot, "edit.json"), join(project, "edit.json"));
    await copyFile(join(fixtureRoot, "captions.json"), join(project, "captions.json"));
    await copyFile(join(fixtureRoot, "overlay.html"), join(project, "overlay.html"));
    await generateCaptureFixture(project, { ffmpeg: "ffmpeg" });
    let launches = 0;
    const out = join(project, "capture-out");
    const result = await runCapture([
      "-p", project, "-t", "0", "3", "6", "--engine", "osr", "--full", "--out", out,
    ], {
      resolveOsrLauncher: async () => ({ tier: 2, executable: "/electron" }),
      osrLauncherRunner: async (_launcher, options) => {
        launches += 1;
        const frames = options.extraArgs[options.extraArgs.indexOf("--capture-frames") + 1]
          .split(",").map(Number);
        const outputDirectory = options.extraArgs[options.extraArgs.indexOf("--capture-output-dir") + 1];
        const pixels = new Uint8Array(options.width * options.height * 4);
        for (let offset = 0; offset < pixels.length; offset += 4) pixels[offset + 3] = 255;
        const outputs = [];
        for (const frameNumber of frames) {
          const path = join(outputDirectory, `frame-${frameNumber}.png`);
          await writeFile(path, encodeRgbaPng(pixels, options.width, options.height));
          outputs.push({ frameNumber, path });
        }
        await writeFile(options.out, JSON.stringify({
          status: "completed",
          operation: "capture",
          outputs,
          verify: {
            mode: "stamp",
            matched: true,
            frames: frames.map((frameNumber) => ({ frameNumber, matched: true })),
          },
          page: { layers: ["engine-canvas", "dom-captions", "html-overlays", "three-canvas"] },
          elapsedMs: 10,
        }));
      },
    });
    assert.equal(launches, 1);
    assert.equal(result.records.length, 3);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    assert.deepEqual(manifest.engine, { requested: "osr", resolved: "osr" });
    assert.match(manifest.renderer, /^osr-export@/u);
    assert.equal(manifest.verify.mode, "stamp");
    assert.equal(manifest.verify.frames.length, 3);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
