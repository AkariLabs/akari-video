import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { exportWithOsr, resolveOsrRuntimeOptions } from "../src/index.mjs";

test("OSR 環境変数を renderer オプションへ正規化する", () => {
  assert.deepEqual(resolveOsrRuntimeOptions({ env: {
    AKARI_OSR_SOFT: "1",
    AKARI_OSR_VERIFY: "hash",
    AKARI_OSR_QUEUE_DEPTH: "2",
    AKARI_OSR_DUMP_FRAMES: "359,0,150,150",
  } }), { soft: true, verify: "hash", queueDepth: 2, dumpFrames: [0, 150, 359] });
  assert.throws(() => resolveOsrRuntimeOptions({ env: { AKARI_OSR_QUEUE_DEPTH: "0" } }), /positive integer/);
  assert.throws(() => resolveOsrRuntimeOptions({ env: { AKARI_OSR_VERIFY: "bad" } }), /stamp\|hash\|off/);
});

test("成功 run.json を .akari/osr-run.json へ永続化して receipt に記録する", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "osr-index-"));
  const out = join(projectRoot, "render-tmp", "composite.mp4");
  let launchedOptions;
  try {
    await mkdir(join(projectRoot, "render-tmp"), { recursive: true });
    const result = await exportWithOsr({
      projectRoot, out, fps: 30, width: 16, height: 16, duration: 1, frames: 30,
      env: { AKARI_OSR_SOFT: "1", AKARI_OSR_DUMP_FRAMES: "0,29" },
      launcherResolver: async () => ({ tier: 2, kind: "npm-electron", executable: "/electron" }),
      launcherRunner: async (_launcher, options) => {
        launchedOptions = options;
        await writeFile(options.out, "video");
        await writeFile(join(projectRoot, "render-tmp", "run.json"), JSON.stringify({ status: "completed", memory: { peakBytes: 10 } }));
      },
    });
    assert.equal(launchedOptions.soft, true);
    assert.deepEqual(launchedOptions.dumpFrames, [0, 29]);
    assert.equal(result.receipt.run, ".akari/osr-run.json");
    assert.equal(JSON.parse(await readFile(join(projectRoot, ".akari", "osr-run.json"), "utf8")).status, "completed");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
