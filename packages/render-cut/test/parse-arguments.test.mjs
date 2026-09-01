import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments, RefusalError } from "../src/render-cut.mjs";

test("parseArguments preserves export options and defaults engine to auto", () => {
  const options = parseArguments(["/project", "--quality", "high", "--encoder=x264", "--fps", "24", "--progress"]);
  assert.equal(options.engine, "auto");
  assert.equal(options.quality, "high");
  assert.equal(options.encoder, "x264");
  assert.equal(options.fps, 24);
  assert.equal(options.progress, true);
});

test("parseArguments accepts gpu and osr", () => {
  assert.equal(parseArguments(["/project", "--engine=gpu"]).engine, "gpu");
  assert.equal(parseArguments(["/project", "--engine", "osr"]).engine, "osr");
});

test("parseArguments rejects the retired engine", () => {
  assert.throws(
    () => parseArguments(["/project", "--engine", "legacy"]),
    (error) => error instanceof RefusalError && error.exitCode === 2,
  );
});
