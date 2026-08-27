import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { selectRenderEngineExecution } from "../../render-cut/src/render-cut.mjs";
import { findForbiddenIntermediates } from "../scripts/assert-no-intermediates.mjs";

test("OSR 分岐は legacy track/layers/rasterize を実行しない", () => {
  assert.deepEqual(selectRenderEngineExecution("osr", { tier: 2 }), {
    useOsr: true,
    engine: "osr",
    engineFallback: undefined,
    runLegacyTrackStack: false,
    runLegacyLayers: false,
    runLegacyRasterize: false,
  });
  assert.equal(selectRenderEngineExecution("osr", { tier: 3 }).runLegacyRasterize, true);
  assert.equal(selectRenderEngineExecution("legacy", null).runLegacyRasterize, true);
});

test("廃止確認は PNG・MOV・frames ディレクトリを列挙する", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-no-intermediates-"));
  try {
    const run = join(root, ".akari", "render-tmp", "run-1");
    await mkdir(join(run, "frames"), { recursive: true });
    await writeFile(join(run, "frame-0001.png"), "x");
    await writeFile(join(run, "overlay.mov"), "x");
    assert.deepEqual(await findForbiddenIntermediates(root), [
      "run-1/frame-0001.png",
      "run-1/frames/",
      "run-1/overlay.mov",
    ]);
    await rm(join(root, ".akari"), { recursive: true, force: true });
    assert.deepEqual(await findForbiddenIntermediates(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
