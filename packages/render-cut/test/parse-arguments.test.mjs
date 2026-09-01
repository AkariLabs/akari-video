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

test("parseArguments accepts --gpu-preference auto|off|force in both spellings", () => {
  assert.equal(parseArguments(["/project", "--gpu-preference", "auto"]).gpuPreference, "auto");
  assert.equal(parseArguments(["/project", "--gpu-preference", "off"]).gpuPreference, "off");
  assert.equal(parseArguments(["/project", "--gpu-preference=force"]).gpuPreference, "force");
  assert.equal(parseArguments(["/project", "--engine", "gpu", "--gpu-preference", "force"]).engine, "gpu");
});

test("parseArguments rejects an unknown --gpu-preference value and a missing value", () => {
  assert.throws(() => parseArguments(["/project", "--gpu-preference", "always"]), /--gpu-preference must be one of auto\|off\|force, got: always/u);
  assert.throws(() => parseArguments(["/project", "--gpu-preference=1"]), /--gpu-preference must be one of auto\|off\|force, got: 1/u);
  assert.throws(() => parseArguments(["/project", "--gpu-preference"]), /--gpu-preference requires a value/u);
});

test("parseArguments leaves gpuPreference undefined when the flag is omitted (env → auto downstream)", () => {
  const options = parseArguments(["/project", "--engine", "gpu"]);
  assert.equal(Object.hasOwn(options, "gpuPreference"), true);
  assert.equal(options.gpuPreference, undefined);
});
