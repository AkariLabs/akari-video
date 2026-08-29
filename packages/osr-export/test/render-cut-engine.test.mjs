import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEngineProvenance,
  parseArguments,
  resolveEngineChoice,
  selectRenderEngineExecution,
} from "../../render-cut/src/render-cut.mjs";

test("render-cut --engine は未指定を auto とし明示値も解釈する", () => {
  assert.equal(parseArguments(["proj"]).engine, "auto");
  assert.equal(parseArguments(["proj", "--engine", "auto"]).engine, "auto");
  assert.equal(parseArguments(["proj", "--engine", "legacy"]).engine, "legacy");
  assert.equal(parseArguments(["proj", "--engine", "osr"]).engine, "osr");
  assert.throws(() => parseArguments(["proj", "--engine", "bogus"]), /--engine/);
});

test("resolveEngineChoice は platform × requested の 9 通りを解決する", () => {
  const expected = {
    darwin: { auto: "osr", legacy: "legacy", osr: "osr" },
    win32: { auto: "osr", legacy: "legacy", osr: "osr" },
    linux: { auto: "legacy", legacy: "legacy", osr: "osr" },
  };
  for (const [platform, choices] of Object.entries(expected)) {
    for (const [requested, resolved] of Object.entries(choices)) {
      assert.equal(resolveEngineChoice(requested, platform), resolved, `${platform}/${requested}`);
    }
  }
  assert.deepEqual(buildEngineProvenance("auto", "darwin"), {
    engine_requested: "auto",
    engine: "osr",
  });
  const win32Provenance = buildEngineProvenance("auto", "win32");
  assert.deepEqual(win32Provenance, { engine_requested: "auto", engine: "osr" });
  assert.equal(selectRenderEngineExecution(win32Provenance.engine, null).engineFallback, undefined);

  const linuxProvenance = buildEngineProvenance("auto", "linux");
  assert.deepEqual(linuxProvenance, { engine_requested: "auto", engine: "legacy" });
  assert.equal(selectRenderEngineExecution(linuxProvenance.engine, null).engineFallback, undefined);
});

test("tier 3 は legacy 実走と fallback provenance を選ぶ", () => {
  assert.deepEqual(
    selectRenderEngineExecution("osr", { tier: 3, reason: "Electron launcher unavailable" }),
    {
      useOsr: false,
      engine: "legacy",
      engineFallback: { from: "osr", reason: "Electron launcher unavailable" },
      runLegacyTrackStack: true,
      runLegacyLayers: true,
      runLegacyRasterize: true,
    },
  );
  assert.deepEqual(
    buildEngineProvenance("auto", "darwin", {
      tier: 3,
      reason: "Electron launcher unavailable",
    }),
    {
      engine_requested: "auto",
      engine: "legacy",
      engine_fallback: { from: "osr", reason: "Electron launcher unavailable" },
    },
  );
});
