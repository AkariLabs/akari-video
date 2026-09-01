import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOsrLauncherAvailable,
  buildEngineProvenance,
  parseArguments,
  RefusalError,
  resolveEngineChoice,
} from "../../render-cut/src/render-cut.mjs";

test("render-cut --engine accepts auto/gpu/osr and rejects the retired value", () => {
  for (const engine of ["auto", "gpu", "osr"]) {
    assert.equal(parseArguments(["proj", "--engine", engine]).engine, engine);
  }
  assert.throws(
    () => parseArguments(["proj", "--engine", "legacy"]),
    (error) => error instanceof RefusalError && error.exitCode === 2 && /廃止/.test(error.message),
  );
});

test("three platforms resolve auto/gpu/osr identically", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    assert.equal(resolveEngineChoice("auto", platform, { eligible: true }), "gpu");
    assert.equal(resolveEngineChoice("auto", platform, { eligible: false }), "osr");
    assert.equal(resolveEngineChoice("gpu", platform, { eligible: false }), "gpu");
    assert.equal(resolveEngineChoice("osr", platform, { eligible: true }), "osr");
  }
});

test("provenance has no OSR fallback form", () => {
  assert.deepEqual(
    buildEngineProvenance("auto", "linux", undefined, { eligible: false }),
    { engine_requested: "auto", engine: "osr" },
  );
});

test("tier 3 refusal names all three Electron acquisition paths", () => {
  assert.throws(
    () => assertOsrLauncherAvailable({ tier: 3, reason: "missing" }),
    (error) => error instanceof RefusalError
      && error.exitCode === 2
      && /インストール済み AKARI Video/.test(error.message)
      && /npm install electron/.test(error.message)
      && /AKARI_OSR_ELECTRON=<path>/.test(error.message),
  );
});
