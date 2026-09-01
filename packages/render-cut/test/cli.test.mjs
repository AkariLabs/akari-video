import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments, RefusalError, resolveEngineChoice } from "../src/render-cut.mjs";

test("CLI arguments default to auto and accept both v2 engines", () => {
  assert.equal(parseArguments(["project"]).engine, "auto");
  assert.equal(parseArguments(["project", "--engine", "gpu"]).engine, "gpu");
  assert.equal(parseArguments(["project", "--engine=osr"]).engine, "osr");
});

test("the retired engine is refused with exit code 2", () => {
  assert.throws(
    () => parseArguments(["project", "--engine", "legacy"]),
    (error) => error instanceof RefusalError && error.exitCode === 2 && /廃止/.test(error.message),
  );
});

test("auto resolution is platform-independent", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    assert.equal(resolveEngineChoice("auto", platform, { eligible: true }), "gpu");
    assert.equal(resolveEngineChoice("auto", platform, { eligible: false }), "osr");
  }
});
